const express = require('express');
const { db } = require('../lib/db');
const cfg = require('../lib/config');
const router = express.Router();

router.get('/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ status: 'Connected' }); }
  catch { res.status(500).json({ status: 'Disconnected' }); }
});

// Non-secret settings the front end needs (brand, currency, where to send money).
router.get('/config', (req, res) => {
  res.json({
    brand: cfg.BRAND, currency: cfg.CURRENCY, support_email: cfg.SUPPORT_EMAIL,
    min_deposit: cfg.MIN_DEPOSIT, max_deposit: cfg.MAX_DEPOSIT, min_withdrawal: cfg.MIN_WITHDRAWAL,
    paystack: { enabled: !!cfg.PAYSTACK_SECRET_KEY },
    pay: {
      usdt_trc20: { address: cfg.PAY.usdt_trc20 },
      usdt_erc20: { address: cfg.PAY.usdt_erc20 },
    },
  });
});

router.get('/packages', async (req, res) => {
  const r = await db.query(
    `SELECT id, name, description, category, image_key, is_popular, minimum_amount, maximum_amount, duration_days,
            projected_return_rate FROM investment_packages WHERE is_active = TRUE ORDER BY sort_order, id`);
  res.json({ success: true, packages: r.rows });
});

module.exports = router;
