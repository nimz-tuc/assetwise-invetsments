// Usage: node scripts/migrate.js   (or: npm run migrate)
// Applies db/base.sql, then every file in db/migrations/ exactly once.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');


const SQL_TYPES = { smallint: 'SMALLINT', integer: 'INTEGER', bigint: 'BIGINT', uuid: 'UUID' };

async function idType(db, table) {
  const r = await db.query(
    `SELECT data_type FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id' AND table_schema = current_schema()`,
    [table]);
  return SQL_TYPES[r.rows[0] && r.rows[0].data_type] || 'BIGINT';
}

async function run(db) {
  const dir = path.join(__dirname, '..', 'db');
  await db.query(fs.readFileSync(path.join(dir, 'base.sql'), 'utf8'));
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const uid = await idType(db, 'users');
  const pkg = await idType(db, 'investment_packages');
  const files = fs.readdirSync(path.join(dir, 'migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const done = await db.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) { console.log('skip   ', file); continue; }
    const sql = fs.readFileSync(path.join(dir, 'migrations', file), 'utf8').replaceAll('__UID__', uid).replaceAll('__PKG__', pkg);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log('applied', file);
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`${file} failed: ${e.message}`);
    } finally { client.release(); }
  }
  console.log('Database is up to date.');
}

module.exports = { run };

if (require.main === module) {
  const db = new Pool({
    host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  });
  run(db).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => db.end());
}
