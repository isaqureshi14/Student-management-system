const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function canAccessStudent(user, studentId) {
  const { role, linked_id } = user;
  if (role === 'OWNER' || role === 'TEACHER') return true;
  if ((role === 'STUDENT' || role === 'PARENT') && linked_id === parseInt(studentId)) return true;
  return false;
}

// ─── GET /api/attendance ──────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { student_id, subject, date } = req.query;
  if (!student_id) return res.status(400).json({ error: 'student_id query parameter is required' });
  if (!canAccessStudent(req.user, student_id)) return res.status(403).json({ error: 'Access denied' });

  try {
    const params = [student_id];
    let query = `SELECT a.*, u.username AS marked_by_username
                 FROM attendance a LEFT JOIN users u ON a.marked_by = u.id
                 WHERE a.student_id = $1`;
    if (subject) { params.push(subject); query += ` AND a.subject = $${params.length}`; }
    if (date)    { params.push(date);    query += ` AND a.date = $${params.length}`; }
    query += ' ORDER BY a.date DESC, a.subject';
    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── POST /api/attendance ─────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('TEACHER', 'OWNER'), async (req, res) => {
  const { student_id, subject, date, status } = req.body;
  if (!student_id || !subject || !date || !status)
    return res.status(400).json({ error: 'student_id, subject, date, and status are required' });

  const validStatuses = ['PRESENT', 'ABSENT', 'LATE'];
  if (!validStatuses.includes(status.toUpperCase()))
    return res.status(400).json({ error: 'status must be PRESENT, ABSENT, or LATE' });

  try {
    const s = await db.query('SELECT id FROM students WHERE id = $1', [student_id]);
    if (!s.rows[0]) return res.status(404).json({ error: 'Record not found' });

    // Upsert using ON CONFLICT
    const { rows: [record] } = await db.query(`
      INSERT INTO attendance (student_id, subject, date, status, marked_by)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (student_id, subject, date)
      DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by
      RETURNING *
    `, [student_id, subject, date, status.toUpperCase(), req.user.id]);

    return res.status(200).json(record);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/attendance/:id ──────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('TEACHER', 'OWNER'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM attendance WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Record not found' });

    const { subject, date, status } = req.body;
    if (status && !['PRESENT','ABSENT','LATE'].includes(status.toUpperCase()))
      return res.status(400).json({ error: 'status must be PRESENT, ABSENT, or LATE' });

    await db.query(`
      UPDATE attendance SET
        subject = COALESCE($1, subject),
        date    = COALESCE($2, date),
        status  = COALESCE($3, status)
      WHERE id = $4
    `, [subject||null, date||null, status?status.toUpperCase():null, id]);

    const updated = (await db.query('SELECT * FROM attendance WHERE id = $1', [id])).rows[0];
    return res.json(updated);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/attendance/bulk-reset
router.post('/bulk-reset', authenticate, requireRole('TEACHER', 'OWNER'), async (req, res) => {
  const { date, subject, class: cls } = req.body;
  if (!date || !subject || !cls)
    return res.status(400).json({ error: 'date, subject, and class are required' });
  try {
    const { rows: students } = await db.query('SELECT id FROM students WHERE class = $1', [cls]);
    if (students.length === 0) return res.json({ deleted: 0 });

    const ids = students.map(s => s.id);
    const placeholders = ids.map((_, i) => `$${i + 3}`).join(',');
    const result = await db.query(
      `DELETE FROM attendance WHERE date=$1 AND subject=$2 AND student_id IN (${placeholders})`,
      [date, subject, ...ids]
    );
    return res.json({ deleted: result.rowCount });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
