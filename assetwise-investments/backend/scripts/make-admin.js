// Usage: node scripts/make-admin.js you@example.com   (promotes an existing account to admin)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');
const db = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) throw new Error('Usage: node scripts/make-admin.js you@example.com');
  const r = await db.query(`UPDATE users SET role = 'admin', updated_at = now() WHERE email = $1 RETURNING id, full_name, email`, [email]);
  if (!r.rowCount) throw new Error('No account found for ' + email + '. Register it first, then run this again.');
  console.log(`${r.rows[0].full_name} <${r.rows[0].email}> is now an admin.`);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.end());
