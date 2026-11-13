const express = require('express');
const { db, tx } = require('../lib/db');
const { authenticate } = require('../lib/auth');
const cfg = require('../lib/config');
const { HttpError, parseAmount, validateDestination, rateLimit, METHODS, WITHDRAW_METHODS } = require('../lib/util');
const L = require('../services/ledger');

const router = express.Router();
router.use(authenticate);

const TX_COLS = `t.id, t.public_ref, t.type, t.amount, t.currency, t.status, t.method, t.reference, t.destination, t.note, t.created_at`;

async function unreadSupport(userId) {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM support_messages WHERE user_id = $1 AND sender_role = 'admin' AND read_at IS NULL`, [userId]);
  return r.rows[0].n;
}

/* ---------- Dashboard ---------- */
router.get('/dashboard', async (req, res) => {
  const uid = req.user.id;
  const [wallet, agg, active, recent, unread] = await Promise.all([
    db.query(`SELECT balance FROM wallets WHERE user_id = $1 AND currency = $2`, [uid, cfg.CURRENCY]),
    db.query(
      `SELECT COALESCE(SUM(amount),0) AS total_invested,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
              COALESCE(SUM(CASE WHEN status = 'matured' THEN expected_profit ELSE accrued END),0) AS total_earnings,
              COALESCE(SUM(CASE WHEN status = 'active' THEN amount + accrued END),0) AS active_value
       FROM (SELECT i.*, ${L.ACCRUED} AS accrued FROM investments i WHERE i.user_id = $1) i`, [uid]),
    db.query(
      `SELECT i.id, i.package_name, i.image_key, i.amount, i.return_rate, i.duration_days, i.expected_profit, i.status,
              i.started_at, i.matures_at, i.amount + ${L.ACCRUED} AS current_value, ${L.ACCRUED} AS profit_so_far
       FROM investments i WHERE i.user_id = $1 AND i.status = 'active' ORDER BY i.matures_at LIMIT 10`, [uid]),
    db.query(`SELECT ${TX_COLS} FROM transactions t WHERE t.user_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT 5`, [uid]),
    unreadSupport(uid),
  ]);
  const balance = Number(wallet.rows[0]?.balance || 0);
  const a = agg.rows[0];
  const invested = Number(a.total_invested);
  res.json({
    success: true, currency: cfg.CURRENCY,
    balance, active_value: Number(a.active_value),
    portfolio_value: balance + Number(a.active_value),
    total_earnings: Number(a.total_earnings),
    earnings_pct: invested > 0 ? (Number(a.total_earnings) / invested) * 100 : 0,
    active_count: a.active_count,
    active_investments: active.rows, recent_transactions: recent.rows, unread_support: unread,
  });
});

/* Portfolio performance: accrued return (% of capital invested) at the end of each day. */
router.get('/performance', async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const r = await db.query(
    `WITH d AS (SELECT generate_series(current_date - ($2::int - 1), current_date, interval '1 day')::date AS day)
     SELECT d.day,
            COALESCE(SUM(i.amount) FILTER (WHERE i.started_at < (d.day + 1)::timestamptz), 0) AS invested,
            COALESCE(SUM(i.expected_profit * LEAST(1, GREATEST(0,
              EXTRACT(EPOCH FROM (LEAST(now(), (d.day + 1)::timestamptz) - i.started_at)) / (i.duration_days * 86400.0)
            ))) FILTER (WHERE i.started_at < (d.day + 1)::timestamptz), 0) AS earned
     FROM d LEFT JOIN investments i ON i.user_id = $1
     GROUP BY d.day ORDER BY d.day`, [req.user.id, days]);
  const points = r.rows.map(p => ({
    day: p.day, invested: Number(p.invested), earned: Number(p.earned),
    pct: Number(p.invested) > 0 ? (Number(p.earned) / Number(p.invested)) * 100 : 0,
  }));
  res.json({ success: true, days, points, latest_pct: points.length ? points[points.length - 1].pct : 0 });
});

/* ---------- Transactions ---------- */
router.get('/transactions', async (req, res) => {
  const type = ['deposit', 'withdrawal', 'investment', 'payout'].includes(req.query.type) ? req.query.type : null;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const r = await db.query(
    `SELECT ${TX_COLS} FROM transactions t WHERE t.user_id = $1 AND ($2::text IS NULL OR t.type = $2)
     ORDER BY t.created_at DESC, t.id DESC LIMIT $3 OFFSET $4`, [req.user.id, type, limit, offset]);
  res.json({ success: true, transactions: r.rows });
});

/* ---------- Investments ---------- */
router.get('/investments', async (req, res) => {
  const status = ['active', 'matured'].includes(req.query.status) ? req.query.status : null;
  const r = await db.query(
    `SELECT i.id, i.package_name, i.image_key, i.amount, i.return_rate, i.duration_days, i.expected_profit, i.status,
            i.started_at, i.matures_at, i.paid_at,
            CASE WHEN i.status = 'matured' THEN i.amount + i.expected_profit ELSE i.amount + ${L.ACCRUED} END AS current_value,
            CASE WHEN i.status = 'matured' THEN i.expected_profit ELSE ${L.ACCRUED} END AS profit_so_far
     FROM investments i WHERE i.user_id = $1 AND ($2::text IS NULL OR i.status = $2)
     ORDER BY i.started_at DESC, i.id DESC`, [req.user.id, status]);
  res.json({ success: true, investments: r.rows });
});

router.post('/investments', rateLimit({ windowMs: 60_000, max: 20, keyFn: r => String(r.user?.id) }), async (req, res) => {
  const amount = parseAmount(req.body?.amount);
  if (!amount) throw new HttpError(400, 'Enter a valid amount.');
  const packageId = req.body?.package_id;
  if (packageId === undefined || packageId === null || packageId === '') throw new HttpError(400, 'Choose a package.');

  const investment = await tx(async client => {
    const p = await client.query(`SELECT * FROM investment_packages WHERE id = $1 AND is_active = TRUE`, [packageId]);
    const pkg = p.rows[0];
    if (!pkg) throw new HttpError(404, 'That package is not available.');
    if (Number(amount) < Number(pkg.minimum_amount)) throw new HttpError(400, `Minimum investment for ${pkg.name} is ${cfg.CURRENCY} ${Number(pkg.minimum_amount).toLocaleString('en-US')}.`);
    if (pkg.maximum_amount !== null && Number(amount) > Number(pkg.maximum_amount)) throw new HttpError(400, `Maximum investment for ${pkg.name} is ${cfg.CURRENCY} ${Number(pkg.maximum_amount).toLocaleString('en-US')}.`);

    await L.debit(client, req.user.id, amount);
    const profit = await client.query(`SELECT ROUND($1::numeric * $2::numeric / 100, 2) AS p`, [amount, pkg.projected_return_rate]);
    const inv = await client.query(
      `INSERT INTO investments (user_id, package_id, package_name, image_key, amount, return_rate, duration_days, expected_profit, matures_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($7::int * interval '1 day')) RETURNING *`,
      [req.user.id, pkg.id, pkg.name, pkg.image_key, amount, pkg.projected_return_rate, pkg.duration_days, profit.rows[0].p]);
    await L.insertTx(client, {
      user_id: req.user.id, type: 'investment', amount: `-${amount}`, status: 'completed', method: 'wallet',
      investment_id: inv.rows[0].id, note: `${pkg.name} investment`,
    });
    return inv.rows[0];
  });
  res.status(201).json({ success: true, message: 'Investment created.', investment });
});

/* ---------- Deposits ---------- */
// The customer sends USDT, then submits the transaction hash. Nothing is credited until the payment is confirmed by an admin.
router.post('/deposits', rateLimit({ windowMs: 60_000, max: 10, keyFn: r => String(r.user?.id) }), async (req, res) => {
  const method = req.body?.method;
  const amount = parseAmount(req.body?.amount);
  const reference = String(req.body?.reference || '').trim();
  if (!METHODS.includes(method)) throw new HttpError(400, 'Choose a payment method.');
  if (!amount) throw new HttpError(400, 'Enter a valid amount.');
  if (Number(amount) < cfg.MIN_DEPOSIT) throw new HttpError(400, `Minimum deposit is ${cfg.CURRENCY} ${cfg.MIN_DEPOSIT.toLocaleString('en-US')}.`);
  if (Number(amount) > cfg.MAX_DEPOSIT) throw new HttpError(400, `Maximum deposit is ${cfg.CURRENCY} ${cfg.MAX_DEPOSIT.toLocaleString('en-US')}.`);
  if (!/^[A-Za-z0-9]{6,120}$/.test(reference)) throw new HttpError(400, 'Enter the transaction hash of your transfer.');
  try {
    const t = await tx(client => L.insertTx(client, {
      user_id: req.user.id, type: 'deposit', amount, status: 'pending', method, reference,
      note: 'Awaiting payment confirmation',
    }));
    res.status(201).json({ success: true, message: 'Deposit submitted. Your wallet is credited as soon as the payment is confirmed.', transaction: t });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That payment reference has already been submitted.');
    throw e;
  }
});

/* ---------- Withdrawals ---------- */
// Funds are taken out of the wallet immediately and held; they are refunded if the request is rejected.
router.post('/withdrawals', rateLimit({ windowMs: 60_000, max: 5, keyFn: r => String(r.user?.id) }), async (req, res) => {
  const method = req.body?.method;
  const amount = parseAmount(req.body?.amount);
  if (!WITHDRAW_METHODS.includes(method)) throw new HttpError(400, 'Choose a withdrawal method.');
  if (!amount) throw new HttpError(400, 'Enter a valid amount.');
  if (Number(amount) < cfg.MIN_WITHDRAWAL) throw new HttpError(400, `Minimum withdrawal is ${cfg.CURRENCY} ${cfg.MIN_WITHDRAWAL.toLocaleString('en-US')}.`);
  const destination = validateDestination(method, req.body?.destination);
  if (!destination) throw new HttpError(400, method === 'paypal' ? 'Enter a valid PayPal email address.' : 'Enter a valid wallet address for that network.');
  const t = await tx(async client => {
    await L.debit(client, req.user.id, amount);
    return L.insertTx(client, {
      user_id: req.user.id, type: 'withdrawal', amount: `-${amount}`, status: 'pending', method, destination,
      note: 'Awaiting processing',
    });
  });
  res.status(201).json({ success: true, message: 'Withdrawal requested. Your balance has been reserved while we process it.', transaction: t });
});

/* ---------- Referrals ---------- */
router.get('/referrals', async (req, res) => {
  const r = await db.query(
    `SELECT split_part(full_name, ' ', 1) AS first_name, created_at FROM users WHERE referred_by = $1 ORDER BY created_at DESC LIMIT 200`, [req.user.id]);
  res.json({ success: true, code: req.user.referral_code, referred: r.rows, count: r.rowCount });
});

/* ---------- Notifications (bell) ---------- */
router.get('/notifications', async (req, res) => {
  res.json({ success: true, unread_support: await unreadSupport(req.user.id) });
});

module.exports = router;
