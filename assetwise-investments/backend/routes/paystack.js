const express = require('express');
const { authenticate } = require('../lib/auth');
const { HttpError, rateLimit } = require('../lib/util');
const paystack = require('../services/paystack');

const router = express.Router();

router.post('/deposits/paystack', authenticate, async () => {
  throw new HttpError(410, 'Online deposits are no longer available. Contact customer care for a crypto deposit address.');
});

// The customer lands back on the site after paying. We never trust the redirect: we ask Paystack.
router.get('/deposits/paystack/verify', authenticate, async (req, res) => {
  const reference = String(req.query.reference || '').trim();
  if (!/^[A-Za-z0-9]{6,64}$/.test(reference)) throw new HttpError(400, 'Invalid payment reference.');
  const r = await paystack.settle(reference, req.user.id);
  res.json({ success: true, status: r.status });
});

// Paystack tells us a payment finished. Signature checked against the raw body; the payment is then re-verified.
router.post('/webhooks/paystack', async (req, res) => {
  if (!paystack.validSignature(req.rawBody, req.get('x-paystack-signature'))) return res.status(401).json({ success: false });
  res.sendStatus(200); // answer fast; Paystack retries if we don't
  const event = req.body || {};
  if (event.event === 'charge.success' && event.data && event.data.reference) {
    paystack.settle(String(event.data.reference)).catch(e => { if (!(e instanceof HttpError && e.status === 404)) console.error('Paystack webhook settle failed:', e.message); });
  }
});

module.exports = router;
