const express = require('express');
const { db } = require('../lib/db');
const { authenticate } = require('../lib/auth');
const { HttpError, rateLimit } = require('../lib/util');

const router = express.Router();
router.use(authenticate);

const COLS = `id, sender_role, body, created_at, read_at`;

// Poll for the conversation. ?after=<id> returns only newer messages. Opening the chat marks admin replies as read.
router.get('/messages', async (req, res) => {
  const after = Math.max(parseInt(req.query.after, 10) || 0, 0);
  const r = await db.query(`SELECT ${COLS} FROM support_messages WHERE user_id = $1 AND id > $2 ORDER BY id LIMIT 500`, [req.user.id, after]);
  if (req.query.mark_read === '1') {
    await db.query(`UPDATE support_messages SET read_at = now() WHERE user_id = $1 AND sender_role = 'admin' AND read_at IS NULL`, [req.user.id]);
  }
  const unread = await db.query(`SELECT count(*)::int AS n FROM support_messages WHERE user_id = $1 AND sender_role = 'admin' AND read_at IS NULL`, [req.user.id]);
  res.json({ success: true, messages: r.rows, unread: unread.rows[0].n });
});

router.post('/messages', rateLimit({ windowMs: 60_000, max: 20, keyFn: r => String(r.user?.id) }), async (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) throw new HttpError(400, 'Type a message first.');
  if (body.length > 2000) throw new HttpError(400, 'Messages can be up to 2,000 characters.');
  const r = await db.query(
    `INSERT INTO support_messages (user_id, sender_id, sender_role, body) VALUES ($1, $1, 'customer', $2) RETURNING ${COLS}`,
    [req.user.id, body]);
  res.status(201).json({ success: true, message: r.rows[0] });
});

module.exports = router;
