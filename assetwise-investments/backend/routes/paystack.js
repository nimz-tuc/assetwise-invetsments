const crypto = require('crypto');
const express = require('express');
const { db, tx } = require('../lib/db');
const { authenticate } = require('../lib/auth');
const cfg = require('../lib/config');
const { HttpError, parseAmount, rateLimit } = require('../lib/util');
const L = require('../services/ledger');
const paystack = require('../services/paystack');

const router = express.Router();

/** Where Paystack sends the customer back to: PUBLIC_URL if you set one, else the address they are browsing (e.g. your tunnel). */
function siteUrl(req) {
  if (cfg.PUBLIC_URL_SET) return cfg.PUBLIC_URL;
  const host = String(req.host || '');
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host)) return cfg.PUBLIC_URL;
  return `${req.protocol}://${host}`;
}

// Customer starts an online deposit: we record it as pending, then send them to Paystack's secure page.
router.post('/deposits/paystack', authenticate, rateLimit({ windowMs: 60_000, max: 10, keyFn: r => String(r.user?.id) }), async (req, res) => {
  if (!cfg.PAYSTACK_SECRET_KEY) throw new HttpError(503, 'Online payments are not set up yet.');
  const amount = parseAmount(req.body?.amount);
  if (!amount) throw new HttpError(400, 'Enter a valid amount.');
  if (Number(amount) < cfg.MIN_DEPOSIT) throw new HttpError(400, `Minimum deposit is ${cfg.CURRENCY} ${cfg.MIN_DEPOSIT.toLocaleString('en-US')}.`);
  if (Number(amount) > cfg.MAX_DEPOSIT) throw new HttpError(400, `Maximum deposit is ${cfg.CURRENCY} ${cfg.MAX_DEPOSIT.toLocaleString('en-US')}.`);
  const reference = 'AWPS' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const t = await tx(client => L.insertTx(client, {
    user_id: req.user.id, type: 'deposit', amount, status: 'pending', method: 'paystack', reference, note: 'Awaiting payment on Paystack',
  }));
  try {
    const data = await paystack.initialize({ email: req.user.email, amount, reference, baseUrl: siteUrl(req) });
    if (!data || !String(data.authorization_url || '').startsWith('https://')) throw new HttpError(502, 'The payment provider returned an unexpected response.');
    res.status(201).json({ success: true, authorization_url: data.authorization_url, reference });
  } catch (e) {
    await db.query(`UPDATE transactions SET status = 'failed', note = 'Could not start payment', updated_at = now() WHERE id = $1`, [t.id]);
    throw e;
  }
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
