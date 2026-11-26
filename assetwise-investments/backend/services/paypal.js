const { db, tx } = require('../lib/db');
const cfg = require('../lib/config');
const { HttpError } = require('../lib/util');
const L = require('./ledger');

const STALE_NOTE = 'Payment not completed';

const enabled = () => !!(cfg.PAYPAL_CLIENT_ID && cfg.PAYPAL_CLIENT_SECRET);

/* ---------- low-level PayPal calls ---------- */
let tokenCache = { value: null, expires: 0 };

/** OAuth2 access token (client credentials). Cached until shortly before it expires. */
async function accessToken() {
  if (!enabled()) throw new HttpError(503, 'PayPal payments are not set up yet.');
  if (tokenCache.value && tokenCache.expires > Date.now() + 60_000) return tokenCache.value;
  let res, json = {};
  try {
    res = await fetch(cfg.PAYPAL_BASE_URL + '/v1/oauth2/token', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${cfg.PAYPAL_CLIENT_ID}:${cfg.PAYPAL_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    json = await res.json().catch(() => ({}));
  } catch (e) { console.error('PayPal auth request failed:', e.message); throw new HttpError(502, 'Could not reach PayPal. Please try again.'); }
  if (!res.ok || !json.access_token) {
    // Almost always: wrong client id/secret, or sandbox keys used with PAYPAL_ENV=live (or the reverse).
    console.error('PayPal auth error', res.status, json.error, json.error_description);
    throw new HttpError(502, 'PayPal could not process this request. Please try again.');
  }
  tokenCache = { value: json.access_token, expires: Date.now() + (Number(json.expires_in) || 300) * 1000 };
  return tokenCache.value;
}

/** Calls PayPal and returns { ok, status, json }. Does not throw on a PayPal error status, so callers can react to it. */
async function pp(path, { method = 'GET', body, requestId, rawBody } = {}) {
  const token = await accessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (requestId) headers['PayPal-Request-Id'] = requestId; // makes retries safe: PayPal returns the first result again
  let res, json = {};
  try {
    res = await fetch(cfg.PAYPAL_BASE_URL + path, {
      method, headers, signal: AbortSignal.timeout(25000),
      body: rawBody !== undefined ? rawBody : (body ? JSON.stringify(body) : undefined),
    });
    json = await res.json().catch(() => ({}));
  } catch (e) { console.error('PayPal request failed:', e.message); throw new HttpError(502, 'Could not reach PayPal. Please try again.'); }
  if (res.status === 401) tokenCache = { value: null, expires: 0 };
  return { ok: res.ok, status: res.status, json };
}

const issue = j => (j && j.details && j.details[0] && j.details[0].issue) || (j && j.name) || '';

/* ---------- orders ---------- */

/** Creates a PayPal order for a deposit. Returns { orderId, approveUrl }. */
async function createOrder({ amount, reference, baseUrl }) {
  const r = await pp('/v2/checkout/orders', {
    method: 'POST', requestId: reference,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: reference, custom_id: reference, invoice_id: reference,
        description: `${cfg.BRAND} wallet deposit`,
        amount: { currency_code: cfg.CURRENCY, value: amount },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: cfg.BRAND, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING',
            landing_page: 'LOGIN',
            return_url: baseUrl + '/?pp=return', cancel_url: baseUrl + '/?pp=cancel',
          },
        },
      },
    },
  });
  if (!r.ok || !r.json.id) {
    console.error('PayPal create order error', r.status, issue(r.json), r.json.message || '');
    throw new HttpError(502, 'PayPal could not process this request. Please try again.');
  }
  const link = (r.json.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
  let approveUrl = link && link.href;
  try { const u = new URL(approveUrl); if (u.protocol !== 'https:' || !/(^|\.)paypal\.com$/.test(u.hostname)) approveUrl = null; } catch { approveUrl = null; }
  if (!approveUrl) throw new HttpError(502, 'The payment provider returned an unexpected response.');
  return { orderId: r.json.id, approveUrl };
}

/**
 * Confirms with PayPal that an order was really paid (capturing it if the customer approved it but it is not captured yet),
 * then credits the wallet exactly once. Safe to call any number of times, from the return page, the webhook and the admin button.
 */
async function settle(orderId, expectedUserId = null) {
  const found = await db.query(
    `SELECT id, user_id, amount, status, note, reference FROM transactions WHERE type = 'deposit' AND method = 'paypal' AND provider_ref = $1`, [orderId]);
  const row = found.rows[0];
  if (!row || (expectedUserId && String(row.user_id) !== String(expectedUserId))) throw new HttpError(404, 'Payment not found.');
  if (row.status === 'completed') return { status: 'completed' };
  if (row.status === 'rejected' || (row.status === 'failed' && !String(row.note || '').startsWith(STALE_NOTE))) return { status: row.status };

  const path = '/v2/checkout/orders/' + encodeURIComponent(orderId);
  let o = await pp(path);
  if (!o.ok) { console.error('PayPal get order error', o.status, issue(o.json)); throw new HttpError(502, 'PayPal could not process this request. Please try again.'); }

  if (o.json.status === 'APPROVED') { // customer agreed to pay: take the money now
    const c = await pp(path + '/capture', { method: 'POST', requestId: 'cap-' + row.reference, body: {} });
    if (c.ok) o = c;
    else {
      console.error('PayPal capture error', c.status, issue(c.json));
      o = await pp(path); // maybe the webhook or another tab captured it a moment ago
      if (!o.ok) throw new HttpError(502, 'PayPal could not process this request. Please try again.');
    }
  }

  const status = o.json.status;
  if (status === 'VOIDED') return { status: 'failed' };
  if (status !== 'COMPLETED') return { status: 'pending' }; // CREATED / PAYER_ACTION_REQUIRED: not paid yet

  const unit = (o.json.purchase_units || [])[0] || {};
  const cap = ((unit.payments || {}).captures || [])[0] || {};
  const amt = cap.amount || {};
  const good = cap.status === 'COMPLETED'
    && String(amt.currency_code).toUpperCase() === cfg.CURRENCY
    && Math.round(Number(amt.value) * 100) === Math.round(Number(row.amount) * 100)
    && (unit.custom_id || unit.reference_id) === row.reference;
  if (cap.status === 'PENDING') return { status: 'pending' }; // e.g. eCheck / under review: credit only when it clears
  if (!good) {
    await tx(async client => {
      await client.query(`UPDATE transactions SET status = 'failed', note = 'Amount or currency did not match - contact support', updated_at = now() WHERE id = $1 AND status IN ('pending','failed')`, [row.id]);
      await L.audit(client, null, 'paypal.mismatch', 'transaction', row.id, { expected: row.amount, paid: amt.value, currency: amt.currency_code, capture: cap.status });
    });
    return { status: 'failed' };
  }

  await tx(async client => {
    const lock = await client.query(`SELECT status, note FROM transactions WHERE id = $1 FOR UPDATE`, [row.id]);
    const cur = lock.rows[0];
    if (cur.status === 'completed') return;
    if (cur.status === 'failed' && String(cur.note || '').startsWith(STALE_NOTE)) {
      await client.query(`UPDATE transactions SET status = 'pending' WHERE id = $1`, [row.id]); // paid after our 24h cut-off
    }
    await L.confirmDeposit(client, row.id); // provider_ref stays the PayPal order id so the order can always be found again
    await client.query(`UPDATE transactions SET note = $2 WHERE id = $1`, [row.id, `PayPal capture ${String(cap.id || '').slice(0, 40)}`]);
  }).catch(e => { if (!(e instanceof HttpError && e.status === 409)) throw e; });
  return { status: 'completed' };
}

/** PayPal webhook check, done by PayPal itself (the exact raw body is sent back to them). Needs PAYPAL_WEBHOOK_ID. */
async function validWebhook(req) {
  if (!enabled() || !cfg.PAYPAL_WEBHOOK_ID || !req.rawBody) return false;
  const h = n => req.get(n);
  const need = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (need.some(n => !h(n))) return false;
  const rawBody = `{"auth_algo":${JSON.stringify(h('paypal-auth-algo'))},"cert_url":${JSON.stringify(h('paypal-cert-url'))},`
    + `"transmission_id":${JSON.stringify(h('paypal-transmission-id'))},"transmission_sig":${JSON.stringify(h('paypal-transmission-sig'))},`
    + `"transmission_time":${JSON.stringify(h('paypal-transmission-time'))},"webhook_id":${JSON.stringify(cfg.PAYPAL_WEBHOOK_ID)},`
    + `"webhook_event":${req.rawBody.toString('utf8')}}`;
  const r = await pp('/v1/notifications/verify-webhook-signature', { method: 'POST', rawBody });
  return r.ok && r.json.verification_status === 'SUCCESS';
}

/** Checkouts the customer never finished are closed after 24 hours (a late payment is still honoured by settle). */
async function expireStalePayments() {
  await db.query(
    `UPDATE transactions SET status = 'failed', note = $1, updated_at = now()
     WHERE type = 'deposit' AND method = 'paypal' AND status = 'pending' AND created_at < now() - interval '24 hours'`, [STALE_NOTE]);
}

module.exports = { enabled, createOrder, settle, validWebhook, expireStalePayments };
