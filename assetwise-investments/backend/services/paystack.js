const crypto = require('crypto');
const { db, tx } = require('../lib/db');
const cfg = require('../lib/config');
const { HttpError } = require('../lib/util');
const L = require('./ledger');

const STALE_NOTE = 'Payment not completed';

async function ps(path, { method = 'GET', body } = {}) {
  if (!cfg.PAYSTACK_SECRET_KEY) throw new HttpError(503, 'Online payments are not set up yet.');
  let res, json = {};
  try {
    res = await fetch(cfg.PAYSTACK_BASE_URL + path, {
      method, signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${cfg.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    json = await res.json().catch(() => ({}));
  } catch (e) { console.error('Paystack request failed:', e.message); throw new HttpError(502, 'Could not reach the payment provider. Please try again.'); }
  if (!res.ok || json.status === false) {
    console.error('Paystack error', res.status, json.message);
    throw new HttpError(502, 'The payment provider could not process this request. Please try again.');
  }
  return json.data;
}

/** Starts a hosted checkout. Amount is sent in the smallest unit (USD x 100, i.e. cents). */
const initialize = ({ email, amount, reference, baseUrl }) => ps('/transaction/initialize', {
  method: 'POST',
  body: { email, amount: Math.round(Number(amount) * 100), currency: cfg.CURRENCY, reference, callback_url: (baseUrl || cfg.PUBLIC_URL) + '/', channels: ['card'] },
});
const verify = reference => ps('/transaction/verify/' + encodeURIComponent(reference));

/** Paystack signs the RAW body with HMAC-SHA512 using the secret key. */
function validSignature(rawBody, signature) {
  if (!cfg.PAYSTACK_SECRET_KEY || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha512', cfg.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Confirms with Paystack that a payment really succeeded, then credits the wallet exactly once.
 * Safe to call any number of times, from the webhook, the return page and the admin button at once.
 */
async function settle(reference, expectedUserId = null) {
  const found = await db.query(
    `SELECT id, user_id, amount, status, note FROM transactions WHERE type = 'deposit' AND method = 'paystack' AND reference = $1`, [reference]);
  const row = found.rows[0];
  if (!row || (expectedUserId && String(row.user_id) !== String(expectedUserId))) throw new HttpError(404, 'Payment not found.');
  if (row.status === 'completed') return { status: 'completed' };
  if (row.status === 'rejected' || (row.status === 'failed' && !String(row.note || '').startsWith(STALE_NOTE))) return { status: row.status };

  const data = await verify(reference);
  if (data.status !== 'success') return { status: data.status === 'failed' ? 'failed' : 'pending' };

  if (String(data.currency).toUpperCase() !== cfg.CURRENCY || Number(data.amount) !== Math.round(Number(row.amount) * 100)) {
    await tx(async client => {
      await client.query(`UPDATE transactions SET status = 'failed', note = 'Amount or currency did not match - contact support', updated_at = now() WHERE id = $1 AND status IN ('pending','failed')`, [row.id]);
      await L.audit(client, null, 'paystack.mismatch', 'transaction', row.id, { expected: row.amount, paid: data.amount, currency: data.currency });
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
    await L.confirmDeposit(client, row.id, { providerRef: String(data.id || reference) });
  }).catch(e => { if (!(e instanceof HttpError && e.status === 409)) throw e; });
  return { status: 'completed' };
}

/** Checkouts the customer never finished are closed after 24 hours (a late payment is still honoured by settle). */
async function expireStalePayments() {
  await db.query(
    `UPDATE transactions SET status = 'failed', note = $1, updated_at = now()
     WHERE type = 'deposit' AND method = 'paystack' AND status = 'pending' AND created_at < now() - interval '24 hours'`, [STALE_NOTE]);
}

module.exports = { initialize, verify, validSignature, settle, expireStalePayments };
