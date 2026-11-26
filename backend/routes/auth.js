const express = require('express');
const bcrypt = require('bcrypt');
const { db, tx } = require('../lib/db');
const { signToken, authenticate } = require('../lib/auth');
const { JWT_EXPIRES_IN, CURRENCY } = require('../lib/config');
const { HttpError, rateLimit } = require('../lib/util');
const { ensureWallet } = require('../services/ledger');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Used so unknown e-mails take as long to reject as real ones (no account enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  keyFn: req => `${req.ip}|${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
});
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: 'Too many sign-ups from this network. Please try again later.' });

router.post('/register', registerLimiter, async (req, res) => {
  const { full_name, email, password, phone, referral_code } = req.body || {};
  if (!full_name || !email || !password) throw new HttpError(400, 'Full name, email and password are required.');
  const name = String(full_name).trim();
  const mail = String(email).trim().toLowerCase();
  if (name.length < 2 || name.length > 120) throw new HttpError(400, 'Please provide a valid full name.');
  if (!EMAIL_RE.test(mail) || mail.length > 255) throw new HttpError(400, 'Please provide a valid email address.');
  if (String(password).length < 8 || String(password).length > 200) throw new HttpError(400, 'Password must contain at least 8 characters.');
  const phoneClean = phone ? String(phone).trim().slice(0, 30) : null;

  const hash = await bcrypt.hash(String(password), 12);
  try {
    const user = await tx(async client => {
      let referrer = null;
      if (referral_code) {
        const r = await client.query(`SELECT id FROM users WHERE referral_code = $1`, [String(referral_code).trim().toUpperCase()]);
        referrer = r.rows[0] ? r.rows[0].id : null;
      }
      const u = await client.query(
        `INSERT INTO users (full_name, email, password_hash, phone, referred_by, referral_code)
         VALUES ($1,$2,$3,$4,$5, upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)))
         RETURNING id, full_name, email, phone, role, referral_code, created_at`,
        [name, mail, hash, phoneClean, referrer]);
      await ensureWallet(client, u.rows[0].id);
      return u.rows[0];
    });
    res.status(201).json({ success: true, message: 'Account created successfully.', user });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'An account with this email already exists.');
    throw e;
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new HttpError(400, 'Email and password are required.');
  const r = await db.query(
    `SELECT id, full_name, email, password_hash, role, status FROM users WHERE email = $1`,
    [String(email).trim().toLowerCase()]);
  const user = r.rows[0];
  const ok = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid email or password.');
  if (user.status !== 'active') throw new HttpError(403, 'This account has been suspended. Please contact support.');
  res.json({
    success: true, message: 'Login successful!', token: signToken(user, JWT_EXPIRES_IN),
    user: { id: user.id, full_name: user.full_name, email: user.email, role: user.role },
  });
});

router.get('/me', authenticate, (req, res) => {
  const { status, ...user } = req.user;
  res.json({ success: true, user, currency: CURRENCY });
});

router.patch('/me', authenticate, async (req, res) => {
  const name = String(req.body?.full_name ?? req.user.full_name).trim();
  const phone = req.body?.phone ? String(req.body.phone).trim().slice(0, 30) : null;
  if (name.length < 2 || name.length > 120) throw new HttpError(400, 'Please provide a valid full name.');
  const r = await db.query(
    `UPDATE users SET full_name = $2, phone = $3, updated_at = now() WHERE id = $1
     RETURNING id, full_name, email, phone, role, referral_code, created_at`, [req.user.id, name, phone]);
  res.json({ success: true, user: r.rows[0] });
});

router.post('/me/password', authenticate, loginLimiter, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) throw new HttpError(400, 'Current and new password are required.');
  if (String(new_password).length < 8 || String(new_password).length > 200) throw new HttpError(400, 'New password must contain at least 8 characters.');
  const r = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!(await bcrypt.compare(String(current_password), r.rows[0].password_hash))) throw new HttpError(400, 'Your current password is incorrect.');
  const hash = await bcrypt.hash(String(new_password), 12);
  await db.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [req.user.id, hash]);
  res.json({ success: true, message: 'Password updated.' });
});

module.exports = router;
