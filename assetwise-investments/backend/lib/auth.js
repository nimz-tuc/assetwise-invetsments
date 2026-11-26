const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { JWT_SECRET } = require('./config');

/** Verifies the bearer token, then re-loads the user so suspended / demoted accounts lose access immediately. */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Authentication required.' });
  let claims;
  try { claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' }); }
  const r = await db.query(
    `SELECT id, full_name, email, phone, role, status, referral_code, created_at FROM users WHERE id = $1`, [claims.sub]);
  const user = r.rows[0];
  if (!user || user.status !== 'active') return res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Administrator access required.' });
  next();
}

function signToken(user, expiresIn) {
  return jwt.sign({ role: user.role }, JWT_SECRET, { subject: String(user.id), expiresIn, algorithm: 'HS256' });
}

module.exports = { authenticate, requireAdmin, signToken };
