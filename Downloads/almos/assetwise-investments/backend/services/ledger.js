const { db, tx } = require('../lib/db');
const { CURRENCY } = require('../lib/config');
const { HttpError, publicRef } = require('../lib/util');

/** SQL fragment: profit earned so far on an investment, accrued evenly over its term. */
const ACCRUED = `ROUND(i.expected_profit * LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM (now() - i.started_at)) / (i.duration_days * 86400.0))), 2)`;

async function ensureWallet(client, userId) {
  await client.query(
    `INSERT INTO wallets (user_id, currency, balance) VALUES ($1, $2, 0) ON CONFLICT (user_id, currency) DO NOTHING`,
    [userId, CURRENCY]);
}

/** Locks the wallet row for the rest of the transaction and returns the balance (string). */
async function lockWallet(client, userId) {
  await ensureWallet(client, userId);
  const r = await client.query(`SELECT balance FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE`, [userId, CURRENCY]);
  return r.rows[0].balance;
}

async function credit(client, userId, amount) {
  await ensureWallet(client, userId);
  const r = await client.query(
    `UPDATE wallets SET balance = balance + $3, updated_at = now() WHERE user_id = $1 AND currency = $2 RETURNING balance`,
    [userId, CURRENCY, amount]);
  return r.rows[0].balance;
}

/** Atomic debit. Throws 400 if the balance is too low; the CHECK constraint is a second line of defence. */
async function debit(client, userId, amount) {
  await ensureWallet(client, userId);
  const r = await client.query(
    `UPDATE wallets SET balance = balance - $3, updated_at = now() WHERE user_id = $1 AND currency = $2 AND balance >= $3 RETURNING balance`,
    [userId, CURRENCY, amount]);
  if (!r.rowCount) throw new HttpError(400, 'Insufficient wallet balance.');
  return r.rows[0].balance;
}

async function insertTx(client, t) {
  const r = await client.query(
    `INSERT INTO transactions (public_ref, user_id, type, amount, currency, status, method, reference, destination, provider_ref, investment_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [publicRef(), t.user_id, t.type, t.amount, CURRENCY, t.status, t.method || null, t.reference || null,
     t.destination || null, t.provider_ref || null, t.investment_id || null, t.note || null]);
  return r.rows[0];
}

async function audit(client, actorId, action, targetType, targetId, details) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, details) VALUES ($1,$2,$3,$4,$5)`,
    [actorId, action, targetType, String(targetId), details ? JSON.stringify(details) : null]);
}

/**
 * Confirms a pending deposit and credits the wallet. This is the ONE place deposits are credited:
 * the admin "Confirm" button calls it today, and the Paystack settlement calls it too.
 */
async function confirmDeposit(client, txId, { reviewerId = null, providerRef = null } = {}) {
  const r = await client.query(`SELECT * FROM transactions WHERE id = $1 AND type = 'deposit' FOR UPDATE`, [txId]);
  const t = r.rows[0];
  if (!t) throw new HttpError(404, 'Deposit not found.');
  if (t.status !== 'pending') throw new HttpError(409, `This deposit is already ${t.status}.`);
  await credit(client, t.user_id, t.amount);
  await client.query(
    `UPDATE transactions SET status = 'completed', reviewed_by = $2, reviewed_at = now(), updated_at = now(),
            provider_ref = COALESCE($3, provider_ref) WHERE id = $1`, [txId, reviewerId, providerRef]);
  return t;
}

/** Pays out every investment whose term has ended: principal + profit goes back to the wallet. */
async function matureDueInvestments() {
  let paid = 0;
  for (;;) {
    const n = await tx(async client => {
      const due = await client.query(
        `SELECT * FROM investments WHERE status = 'active' AND matures_at <= now()
         ORDER BY matures_at LIMIT 50 FOR UPDATE SKIP LOCKED`);
      for (const inv of due.rows) {
        const total = (Number(inv.amount) + Number(inv.expected_profit)).toFixed(2);
        await credit(client, inv.user_id, total);
        await insertTx(client, {
          user_id: inv.user_id, type: 'payout', amount: total, status: 'completed', method: 'wallet',
          investment_id: inv.id, note: `${inv.package_name} matured (principal + return)`,
        });
        await client.query(`UPDATE investments SET status = 'matured', paid_at = now() WHERE id = $1`, [inv.id]);
      }
      return due.rowCount;
    });
    paid += n;
    if (n < 50) break;
  }
  return paid;
}

module.exports = { ACCRUED, ensureWallet, lockWallet, credit, debit, insertTx, audit, confirmDeposit, matureDueInvestments };
