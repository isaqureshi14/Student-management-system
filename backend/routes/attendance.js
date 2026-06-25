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
router.get('/', authenticate, (req, res) => {
  const { student_id, subject, date } = req.query;

  if (!student_id) {
    return res.status(400).json({ error: 'student_id query parameter is required' });
  }

  if (!canAccessStudent(req.user, student_id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  let query = `
    SELECT a.*, u.username AS marked_by_username
    FROM attendance a
    LEFT JOIN users u ON a.marked_by = u.id
    WHERE a.student_id = ?
  `;
  const params = [student_id];

  if (subject) {
    query += ' AND a.subject = ?';
    params.push(subject);
  }
  if (date) {
    query += ' AND a.date = ?';
    params.push(date);
  }

  query += ' ORDER BY a.date DESC, a.subject';

  const records = db.prepare(query).all(...params);
  return res.json(records);
});

// ─── POST /api/attendance ─────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const { student_id, subject, date, status } = req.body;

  if (!student_id || !subject || !date || !status) {
    return res.status(400).json({ error: 'student_id, subject, date, and status are required' });
  }

  const validStatuses = ['PRESENT', 'ABSENT', 'LATE'];
  if (!validStatuses.includes(status.toUpperCase())) {
    return res.status(400).json({ error: 'status must be PRESENT, ABSENT, or LATE' });
  }

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(student_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  try {
    const existing = db.prepare('SELECT id FROM attendance WHERE student_id = ? AND subject = ? AND date = ?')
                       .get(student_id, subject, date);
    if (existing) {
      db.prepare('UPDATE attendance SET status = ?, marked_by = ? WHERE id = ?')
        .run(status.toUpperCase(), req.user.id, existing.id);
      const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(existing.id);
      return res.status(200).json(record);
    }

    const result = db.prepare(`
      INSERT INTO attendance (student_id, subject, date, status, marked_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(student_id, subject, date, status.toUpperCase(), req.user.id);

    const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(record);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      db.prepare('UPDATE attendance SET status = ?, marked_by = ? WHERE student_id = ? AND subject = ? AND date = ?')
        .run(status.toUpperCase(), req.user.id, student_id, subject, date);
      const record = db.prepare('SELECT * FROM attendance WHERE student_id = ? AND subject = ? AND date = ?')
                       .get(student_id, subject, date);
      return res.status(200).json(record);
    }
    throw err;
  }
});

// ─── PUT /api/attendance/:id ──────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const { id } = req.params;
  const record = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  if (!record) return res.status(404).json({ error: 'Attendance record not found' });

  const { subject, date, status } = req.body;

  if (status) {
    const validStatuses = ['PRESENT', 'ABSENT', 'LATE'];
    if (!validStatuses.includes(status.toUpperCase())) {
      return res.status(400).json({ error: 'status must be PRESENT, ABSENT, or LATE' });
    }
  }

  db.prepare(`
    UPDATE attendance SET
      subject = COALESCE(?, subject),
      date = COALESCE(?, date),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(
    subject || null,
    date || null,
    status ? status.toUpperCase() : null,
    id
  );

  const updated = db.prepare('SELECT * FROM attendance WHERE id = ?').get(id);
  return res.json(updated);
});

// POST /api/attendance/bulk-reset — reset/delete attendance for a subject, class, and date
router.post('/bulk-reset', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const { date, subject, class: cls } = req.body;
  if (!date || !subject || !cls) {
    return res.status(400).json({ error: 'date, subject, and class are required' });
  }
  const students = db.prepare('SELECT id FROM students WHERE class = ?').all(cls);
  const studentIds = students.map(s => s.id);
  if (studentIds.length === 0) return res.json({ deleted: 0 });

  const placeholders = studentIds.map(() => '?').join(',');
  const result = db.prepare(`
    DELETE FROM attendance
    WHERE date = ? AND subject = ? AND student_id IN (${placeholders})
  `).run(date, subject, ...studentIds);

  return res.json({ deleted: result.changes });
});

module.exports = router;
