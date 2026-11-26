const crypto = require('crypto');
const { MAX_AMOUNT } = require('./config');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; this.expose = true; } // expose: message is safe to show customers
}

/** "1500", "1500.5", 1500.55 -> "1500.50" | null when invalid. Never uses float math for money. */
function parseAmount(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  if (!(n > 0) || n > MAX_AMOUNT) return null;
  return n.toFixed(2);
}

function publicRef() { return 'AW-' + crypto.randomBytes(5).toString('hex').toUpperCase(); }

/** 0712345678 / 0112345678 / +254712345678 / 254712345678 -> 254712345678 */
function normalizeKenyanPhone(p) {
  const m = String(p || '').replace(/[\s\-()]/g, '').match(/^(?:\+?254|0)([17]\d{8})$/);
  return m ? '254' + m[1] : null;
}

function validateDestination(method, value) {
  const v = String(value || '').trim();
  if (method === 'usdt_trc20') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v) ? v : null;
  if (method === 'usdt_erc20') return /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
  return null;
}

function rateLimit({ windowMs, max, keyFn, message = 'Too many attempts. Please wait and try again.' }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e); }
    if (++e.count > max) {
      res.set('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ success: false, message });
    }
    next();
  };
}

const METHODS = ['usdt_trc20', 'usdt_erc20'];

module.exports = { HttpError, parseAmount, publicRef, normalizeKenyanPhone, validateDestination, rateLimit, METHODS };
