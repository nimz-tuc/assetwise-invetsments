const path = require('path');
const cfg = require('./lib/config');
const express = require('express');
const cors = require('cors');
const { db } = require('./lib/db');
const { matureDueInvestments } = require('./services/ledger');
const { expireStalePayments } = require('./services/paystack');

if (!cfg.JWT_SECRET || cfg.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is missing or too short (use at least 32 random characters). Refusing to start.');
  process.exit(1);
}

const app = express();
// Tunnels (ngrok, cloudflared) and a reverse proxy on this machine connect from loopback: trust only those, so
// phones are told apart by their real IP and https is detected. TRUST_PROXY=1 trusts one proxy hop elsewhere (e.g. a host's load balancer).
app.set('trust proxy', cfg.TRUST_PROXY ? 1 : 'loopback');
app.disable('x-powered-by');

// Security headers. The page only loads its own scripts and Google Fonts.
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  });
  if (cfg.IS_PROD) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

// Only needed when the page is opened from VS Code Live Server (a different origin than the API).
app.use('/api', cors({ origin: cfg.CORS_ORIGINS }));
app.use(express.json({ limit: '20kb', verify: (req, res, buf) => { req.rawBody = buf; } })); // raw body is needed to check Paystack's webhook signature
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.use('/api', require('./routes/public'));
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/paystack'));
app.use('/api', require('./routes/account'));
app.use('/api/support', require('./routes/support'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'Not found.' }));

// The website itself. Only these folders are served, never the backend folder or .env.
const root = path.join(__dirname, '..');
for (const dir of ['css', 'js', 'images']) app.use('/' + dir, express.static(path.join(root, dir), { maxAge: cfg.IS_PROD ? '1h' : 0 }));
app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.expose || (err.status && err.status < 500)) return res.status(err.status).json({ success: false, message: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid request body.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request too large.' });
  if (err.code === '22P02' || err.code === '22003') return res.status(400).json({ success: false, message: 'Invalid value in request.' });
  console.error(req.method, req.originalUrl, err.stack || err.message);
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

// Bring the database up to date (safe to repeat), then start serving and paying out matured investments.
require('./scripts/migrate').run(db).then(() => {
  console.log('Database connected and up to date.');
  const runMaturity = () => matureDueInvestments().then(n => n && console.log(`Paid out ${n} matured investment(s).`)).catch(e => console.error('Maturity job failed:', e.message));
  const runExpiry = () => expireStalePayments().catch(e => console.error('Payment expiry job failed:', e.message));
  runMaturity(); runExpiry();
  setInterval(() => { runMaturity(); runExpiry(); }, 60_000).unref();
  app.listen(cfg.PORT, '0.0.0.0', () => console.log(`${cfg.BRAND} running on http://localhost:${cfg.PORT}`));
}).catch(e => { console.error('Database setup failed:', e.message); process.exit(1); });
