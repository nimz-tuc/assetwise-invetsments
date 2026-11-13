const express = require('express');
const { db, tx } = require('../lib/db');
const { authenticate, requireAdmin } = require('../lib/auth');
const cfg = require('../lib/config');
const { HttpError, parseAmount } = require('../lib/util');
const L = require('../services/ledger');
const paystack = require('../services/paystack');
const paypal = require('../services/paypal');

const router = express.Router();
router.use(authenticate, requireAdmin);

/* ---------- Overview ---------- */
router.get('/stats', async (req, res) => {
  const q = (sql) => db.query(sql).then(r => r.rows[0]);
  const [users, money, pending, inv, support] = await Promise.all([
    q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS new_30d FROM users WHERE role <> 'admin'`),
    q(`SELECT COALESCE(SUM(amount) FILTER (WHERE type='deposit' AND status='completed'),0) AS deposits,
              COALESCE(-SUM(amount) FILTER (WHERE type='withdrawal' AND status='completed'),0) AS withdrawals FROM transactions`),
    q(`SELECT count(*) FILTER (WHERE type='deposit')::int AS deposits, count(*) FILTER (WHERE type='withdrawal')::int AS withdrawals
       FROM transactions WHERE status = 'pending'`),
    q(`SELECT count(*)::int AS active, COALESCE(SUM(amount),0) AS principal, COALESCE(SUM(expected_profit),0) AS liability
       FROM investments WHERE status = 'active'`),
    q(`SELECT count(*)::int AS awaiting FROM (
         SELECT DISTINCT ON (user_id) user_id, sender_role FROM support_messages ORDER BY user_id, id DESC) m WHERE sender_role = 'customer'`),
  ]);
  const wallets = await q(`SELECT COALESCE(SUM(balance),0) AS total FROM wallets`);
  res.json({
    success: true, currency: cfg.CURRENCY,
    users, deposits_total: Number(money.deposits), withdrawals_total: Number(money.withdrawals),
    pending_deposits: pending.deposits, pending_withdrawals: pending.withdrawals,
    active_investments: inv.active, active_principal: Number(inv.principal), pending_returns: Number(inv.liability),
    customer_wallet_total: Number(wallets.total), support_awaiting: support.awaiting,
  });
});

/* ---------- Users ---------- */
router.get('/users', async (req, res) => {
  const search = String(req.query.q || '').trim();
  const r = await db.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.created_at,
            COALESCE(w.balance, 0) AS balance,
            COALESCE((SELECT SUM(amount) FROM investments i WHERE i.user_id = u.id AND i.status = 'active'), 0) AS invested
     FROM users u LEFT JOIN wallets w ON w.user_id = u.id AND w.currency = $2
     WHERE ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%')
     ORDER BY u.created_at DESC LIMIT 200`, [search, cfg.CURRENCY]);
  res.json({ success: true, users: r.rows });
});

router.patch('/users/:id', async (req, res) => {
  const status = req.body?.status;
  if (!['active', 'suspended'].includes(status)) throw new HttpError(400, 'Status must be active or suspended.');
  if (String(req.params.id) === String(req.user.id)) throw new HttpError(400, 'You cannot change your own account status.');
  const r = await tx(async client => {
    const u = await client.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1 RETURNING id, full_name, email, status`, [req.params.id, status]);
    if (!u.rowCount) throw new HttpError(404, 'User not found.');
    await L.audit(client, req.user.id, 'user.' + status, 'user', req.params.id, null);
    return u.rows[0];
  });
  res.json({ success: true, user: r });
});

/* ---------- Deposits & withdrawals review ---------- */
router.get('/transactions', async (req, res) => {
  const type = ['deposit', 'withdrawal', 'investment', 'payout'].includes(req.query.type) ? req.query.type : null;
  const status = ['pending', 'completed', 'rejected', 'failed'].includes(req.query.status) ? req.query.status : null;
  const r = await db.query(
    `SELECT t.id, t.public_ref, t.type, t.amount, t.currency, t.status, t.method, t.reference, t.destination, t.note,
            t.created_at, t.reviewed_at, u.full_name, u.email, u.phone
     FROM transactions t JOIN users u ON u.id = t.user_id
     WHERE ($1::text IS NULL OR t.type = $1) AND ($2::text IS NULL OR t.status = $2)
     ORDER BY (t.status = 'pending') DESC, t.created_at DESC, t.id DESC LIMIT 300`, [type, status]);
  res.json({ success: true, transactions: r.rows });
});

router.post('/transactions/:id/approve', async (req, res) => {
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 200) : null;
  const pre = (await db.query(`SELECT type, method, reference, provider_ref FROM transactions WHERE id = $1`, [req.params.id])).rows[0];
  if (pre && pre.type === 'deposit' && pre.method === 'paystack') {
    // Online payments are only credited once Paystack itself confirms them.
    const r = await paystack.settle(pre.reference);
    return res.json({ success: r.status === 'completed', message: r.status === 'completed' ? 'Paystack confirmed the payment and the wallet was credited.' : `Paystack has not confirmed this payment (status: ${r.status}).` });
  }
  if (pre && pre.type === 'deposit' && pre.method === 'paypal') {
    // PayPal deposits are only credited once PayPal itself confirms them.
    const r = await paypal.settle(pre.provider_ref);
    return res.json({ success: r.status === 'completed', message: r.status === 'completed' ? 'PayPal confirmed the payment and the wallet was credited.' : `PayPal has not confirmed this payment (status: ${r.status}).` });
  }
  const done = await tx(async client => {
    const r = await client.query(`SELECT * FROM transactions WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const t = r.rows[0];
    if (!t) throw new HttpError(404, 'Transaction not found.');
    if (t.status !== 'pending') throw new HttpError(409, `This transaction is already ${t.status}.`);
    if (t.type === 'deposit') {
      await L.confirmDeposit(client, t.id, { reviewerId: req.user.id });
    } else if (t.type === 'withdrawal') {
      // Money has already left the wallet when the request was made; approving records that it was paid out.
      await client.query(
        `UPDATE transactions SET status = 'completed', reviewed_by = $2, reviewed_at = now(), updated_at = now(),
                provider_ref = COALESCE($3, provider_ref), note = 'Paid out' WHERE id = $1`, [t.id, req.user.id, note]);
    } else throw new HttpError(400, 'Only deposits and withdrawals can be reviewed.');
    await L.audit(client, req.user.id, `${t.type}.approve`, 'transaction', t.id, { amount: t.amount, user_id: t.user_id, note });
    return t;
  });
  res.json({ success: true, message: done.type === 'deposit' ? 'Deposit confirmed and wallet credited.' : 'Withdrawal marked as paid.' });
});

router.post('/transactions/:id/reject', async (req, res) => {
  const reason = req.body?.reason ? String(req.body.reason).trim().slice(0, 200) : 'Rejected by administrator';
  await tx(async client => {
    const r = await client.query(`SELECT * FROM transactions WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const t = r.rows[0];
    if (!t) throw new HttpError(404, 'Transaction not found.');
    if (t.status !== 'pending') throw new HttpError(409, `This transaction is already ${t.status}.`);
    if (!['deposit', 'withdrawal'].includes(t.type)) throw new HttpError(400, 'Only deposits and withdrawals can be reviewed.');
    if (t.type === 'withdrawal') await L.credit(client, t.user_id, (-Number(t.amount)).toFixed(2)); // refund the reserved funds
    await client.query(
      `UPDATE transactions SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), updated_at = now(), note = $3 WHERE id = $1`,
      [t.id, req.user.id, reason]);
    await L.audit(client, req.user.id, `${t.type}.reject`, 'transaction', t.id, { amount: t.amount, user_id: t.user_id, reason });
  });
  res.json({ success: true, message: 'Request rejected.' });
});

/* ---------- Customer support inbox ---------- */
router.get('/support/threads', async (req, res) => {
  const r = await db.query(
    `SELECT u.id AS user_id, u.full_name, u.email, m.body AS last_body, m.sender_role AS last_sender, m.created_at AS last_at,
            (SELECT count(*)::int FROM support_messages s WHERE s.user_id = u.id AND s.sender_role = 'customer' AND s.read_at IS NULL) AS unread
     FROM (SELECT DISTINCT ON (user_id) * FROM support_messages ORDER BY user_id, id DESC) m
     JOIN users u ON u.id = m.user_id
     ORDER BY (m.sender_role = 'customer') DESC, m.created_at DESC LIMIT 200`);
  res.json({ success: true, threads: r.rows });
});

router.get('/support/threads/:userId/messages', async (req, res) => {
  const after = Math.max(parseInt(req.query.after, 10) || 0, 0);
  const u = await db.query(`SELECT id, full_name, email, phone FROM users WHERE id = $1`, [req.params.userId]);
  if (!u.rowCount) throw new HttpError(404, 'Customer not found.');
  const r = await db.query(`SELECT id, sender_role, body, created_at FROM support_messages WHERE user_id = $1 AND id > $2 ORDER BY id LIMIT 500`, [req.params.userId, after]);
  await db.query(`UPDATE support_messages SET read_at = now() WHERE user_id = $1 AND sender_role = 'customer' AND read_at IS NULL`, [req.params.userId]);
  res.json({ success: true, customer: u.rows[0], messages: r.rows });
});

router.post('/support/threads/:userId/reply', async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) throw new HttpError(400, 'Type a reply first.');
  if (body.length > 2000) throw new HttpError(400, 'Replies can be up to 2,000 characters.');
  const u = await db.query(`SELECT id FROM users WHERE id = $1`, [req.params.userId]);
  if (!u.rowCount) throw new HttpError(404, 'Customer not found.');
  const r = await db.query(
    `INSERT INTO support_messages (user_id, sender_id, sender_role, body) VALUES ($1, $2, 'admin', $3) RETURNING id, sender_role, body, created_at`,
    [req.params.userId, req.user.id, body]);
  res.status(201).json({ success: true, message: r.rows[0] });
});

/* ---------- Packages ---------- */
router.get('/packages', async (req, res) => {
  const r = await db.query(`SELECT * FROM investment_packages ORDER BY sort_order, id`);
  res.json({ success: true, packages: r.rows });
});

router.put('/packages/:id', async (req, res) => {
  const b = req.body || {};
  const min = parseAmount(b.minimum_amount);
  const max = b.maximum_amount === '' || b.maximum_amount == null ? null : parseAmount(b.maximum_amount);
  const days = parseInt(b.duration_days, 10);
  const rate = Number(b.projected_return_rate);
  if (!min) throw new HttpError(400, 'Enter a valid minimum amount.');
  if (max !== null && (!max || Number(max) < Number(min))) throw new HttpError(400, 'Maximum must be greater than the minimum.');
  if (!(days >= 1 && days <= 365)) throw new HttpError(400, 'Duration must be between 1 and 365 days.');
  if (!(rate > 0 && rate <= 100)) throw new HttpError(400, 'Return rate must be between 0 and 100 percent.');
  const r = await tx(async client => {
    const u = await client.query(
      `UPDATE investment_packages SET minimum_amount = $2, maximum_amount = $3, duration_days = $4, projected_return_rate = $5, is_active = $6
       WHERE id = $1 RETURNING *`, [req.params.id, min, max, days, rate.toFixed(2), b.is_active !== false]);
    if (!u.rowCount) throw new HttpError(404, 'Package not found.');
    await L.audit(client, req.user.id, 'package.update', 'package', req.params.id, { min, max, days, rate, is_active: b.is_active !== false });
    return u.rows[0];
  });
  res.json({ success: true, package: r });
});

module.exports = router;
