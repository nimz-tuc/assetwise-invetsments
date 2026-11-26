const express = require('express');
const { authenticate } = require('../lib/auth');
const { HttpError, rateLimit } = require('../lib/util');
const paypal = require('../services/paypal');

const router = express.Router();

const ORDER_ID = /^[A-Za-z0-9]{10,40}$/;

router.post('/deposits/paypal', authenticate, async () => {
  throw new HttpError(410, 'Online deposits are no longer available. Contact customer care for a crypto deposit address.');
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
