const crypto = require('crypto');
const express = require('express');
const { db, tx } = require('../lib/db');
const { authenticate } = require('../lib/auth');
const cfg = require('../lib/config');
const { HttpError, parseAmount, rateLimit } = require('../lib/util');
const L = require('../services/ledger');
const paypal = require('../services/paypal');

const router = express.Router();

/** Where PayPal sends the customer back to: PUBLIC_URL if you set one, else the address they are browsing. */
function siteUrl(req) {
  if (cfg.PUBLIC_URL_SET) return cfg.PUBLIC_URL;
  const host = String(req.host || '');
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return cfg.PUBLIC_URL;
  return `${req.protocol}://${host}`;
}

const ORDER_ID = /^[A-Za-z0-9]{10,40}$/;

// Customer starts a PayPal deposit: we record it as pending, then send them to PayPal's secure page.
router.post('/deposits/paypal', authenticate, rateLimit({ windowMs: 60_000, max: 10, keyFn: r => String(r.user?.id) }), async (req, res) => {
  if (!paypal.enabled()) throw new HttpError(503, 'PayPal payments are not set up yet.');
  const amount = parseAmount(req.body?.amount);
  if (!amount) throw new HttpError(400, 'Enter a valid amount.');
  if (Number(amount) < cfg.MIN_DEPOSIT) throw new HttpError(400, `Minimum deposit is ${cfg.CURRENCY} ${cfg.MIN_DEPOSIT.toLocaleString('en-US')}.`);
  if (Number(amount) > cfg.MAX_DEPOSIT) throw new HttpError(400, `Maximum deposit is ${cfg.CURRENCY} ${cfg.MAX_DEPOSIT.toLocaleString('en-US')}.`);
  const reference = 'AWPP' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const t = await tx(client => L.insertTx(client, {
    user_id: req.user.id, type: 'deposit', amount, status: 'pending', method: 'paypal', reference, note: 'Awaiting payment on PayPal',
  }));
  try {
    const { orderId, approveUrl } = await paypal.createOrder({ amount, reference, baseUrl: siteUrl(req) });
    await db.query(`UPDATE transactions SET provider_ref = $2, updated_at = now() WHERE id = $1`, [t.id, orderId]);
    res.status(201).json({ success: true, approve_url: approveUrl, reference });
  } catch (e) {
    await db.query(`UPDATE transactions SET status = 'failed', note = 'Could not start payment', updated_at = now() WHERE id = $1`, [t.id]);
    throw e;
  }
});

// The customer lands back on the site after approving. We never trust the redirect: we ask PayPal (and capture the payment).
router.post('/deposits/paypal/capture', authenticate, rateLimit({ windowMs: 60_000, max: 30, keyFn: r => String(r.user?.id) }), async (req, res) => {
  const orderId = String(req.body?.order_id || '').trim();
  if (!ORDER_ID.test(orderId)) throw new HttpError(400, 'Invalid payment reference.');
  const r = await paypal.settle(orderId, req.user.id);
  res.json({ success: true, status: r.status });
});

// PayPal tells us an order was approved / a payment finished. PayPal itself verifies the signature; the order is then re-checked.
router.post('/webhooks/paypal', async (req, res) => {
  let ok = false;
  try { ok = await paypal.validWebhook(req); } catch (e) { console.error('PayPal webhook verify failed:', e.message); }
  if (!ok) return res.status(401).json({ success: false });
  res.sendStatus(200); // answer fast; PayPal retries if we don't
  const event = req.body || {};
  const data = event.resource || {};
  let orderId = null;
  if (event.event_type === 'CHECKOUT.ORDER.APPROVED') orderId = data.id;
  else if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') orderId = data.supplementary_data?.related_ids?.order_id;
  if (orderId && ORDER_ID.test(String(orderId))) {
    paypal.settle(String(orderId)).catch(e => { if (!(e instanceof HttpError && e.status === 404)) console.error('PayPal webhook settle failed:', e.message); });
  }
});

module.exports = router;
