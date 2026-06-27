const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/owner/stats ─────────────────────────────────────────────────────
router.get('/stats', authenticate, requireRole('OWNER'), async (req, res) => {
  try {
    const [students, teachers, marksRow, attendanceRow, pendingLeaves, pendingApprovals] = await Promise.all([
      db.query('SELECT COUNT(*) AS count FROM students'),
      db.query('SELECT COUNT(*) AS count FROM teachers'),
      db.query('SELECT AVG(score::REAL / max_score::REAL * 100) AS avg FROM marks'),
      db.query(`SELECT
                  SUM(CASE WHEN status='PRESENT' THEN 1 ELSE 0 END)::REAL /
                  NULLIF(COUNT(*),0) * 100 AS avg
                FROM attendance`),
      db.query("SELECT COUNT(*) AS count FROM leave_requests WHERE status='PENDING'"),
      db.query("SELECT COUNT(*) AS count FROM students WHERE profile_status='PENDING'"),
    ]);

    const avg = (row, key) => row.rows[0][key] !== null ? Math.round(row.rows[0][key] * 100) / 100 : null;

    return res.json({
      totalStudents:   parseInt(students.rows[0].count),
      totalTeachers:   parseInt(teachers.rows[0].count),
      avgMarks:        avg(marksRow, 'avg'),
      avgAttendance:   avg(attendanceRow, 'avg'),
      pendingLeaves:   parseInt(pendingLeaves.rows[0].count),
      pendingApprovals:parseInt(pendingApprovals.rows[0].count),
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── GET /api/owner/marks ─────────────────────────────────────────────────────
router.get('/marks', authenticate, requireRole('OWNER'), async (req, res) => {
  const { student_id, exam_name, class: cls } = req.query;
  try {
    const params = [];
    let query = `SELECT m.*, s.first_name, s.last_name, s.class, s.roll_number,
                        u.username AS uploaded_by_username
                 FROM marks m
                 JOIN students s ON m.student_id = s.id
                 LEFT JOIN users u ON m.uploaded_by = u.id
                 WHERE 1=1`;
    if (student_id) { params.push(student_id); query += ` AND m.student_id = $${params.length}`; }
    if (exam_name)  { params.push(exam_name);  query += ` AND m.exam_name = $${params.length}`; }
    if (cls)        { params.push(cls);         query += ` AND s.class = $${params.length}`; }
    query += ' ORDER BY m.uploaded_at DESC';
    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── GET /api/owner/attendance ────────────────────────────────────────────────
router.get('/attendance', authenticate, requireRole('OWNER'), async (req, res) => {
  const { student_id, subject, date, class: cls } = req.query;
  try {
    const params = [];
    let query = `SELECT a.*, s.first_name, s.last_name, s.class, s.roll_number,
                        u.username AS marked_by_username
                 FROM attendance a
                 JOIN students s ON a.student_id = s.id
                 LEFT JOIN users u ON a.marked_by = u.id
                 WHERE 1=1`;
    if (student_id) { params.push(student_id); query += ` AND a.student_id = $${params.length}`; }
    if (subject)    { params.push(subject);    query += ` AND a.subject = $${params.length}`; }
    if (date)       { params.push(date);        query += ` AND a.date = $${params.length}`; }
    if (cls)        { params.push(cls);         query += ` AND s.class = $${params.length}`; }
    query += ' ORDER BY a.date DESC, a.subject';
    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── GET /api/owner/students ──────────────────────────────────────────────────
router.get('/students', authenticate, requireRole('OWNER'), async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, first_name, last_name, class, section, roll_number,
             class_teacher, profile_status, photo_url
      FROM students ORDER BY class, roll_number
    `);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── POST /api/owner/reset-password ──────────────────────────────────────────
router.post('/reset-password', authenticate, requireRole('OWNER'), async (req, res) => {
  const { username, new_password } = req.body;
  if (!username || !new_password)
    return res.status(400).json({ error: 'username and new_password are required' });

  try {
    const { rows } = await db.query(
      'SELECT * FROM users WHERE username = $1 OR username = $2',
      [username, username + '@school.com']
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Record not found' });

    const passwordHash = bcrypt.hashSync(new_password.trim(), 10);
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [passwordHash, user.id]);

    return res.json({ message: `Password for ${user.username} reset successfully.` });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
