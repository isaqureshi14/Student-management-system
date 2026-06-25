const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/owner/stats ─────────────────────────────────────────────────────
router.get('/stats', authenticate, requireRole('OWNER'), (req, res) => {
  // Total students
  const totalStudents = db.prepare('SELECT COUNT(*) AS count FROM students').get().count;

  // Total teachers
  const totalTeachers = db.prepare('SELECT COUNT(*) AS count FROM teachers').get().count;

  // Average marks score (as percentage)
  const marksRow = db.prepare(
    'SELECT AVG(CAST(score AS REAL) / CAST(max_score AS REAL) * 100) AS avg FROM marks'
  ).get();
  const avgMarks = marksRow.avg !== null ? Math.round(marksRow.avg * 100) / 100 : null;

  // Average attendance (% of PRESENT records)
  const attendanceRow = db.prepare(`
    SELECT
      CAST(SUM(CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END) AS REAL) /
      NULLIF(COUNT(*), 0) * 100 AS avg
    FROM attendance
  `).get();
  const avgAttendance = attendanceRow.avg !== null ? Math.round(attendanceRow.avg * 100) / 100 : null;

  // Pending leave requests
  const pendingLeaves = db.prepare(
    "SELECT COUNT(*) AS count FROM leave_requests WHERE status = 'PENDING'"
  ).get().count;

  // Pending profile approvals
  const pendingApprovals = db.prepare(
    "SELECT COUNT(*) AS count FROM students WHERE profile_status = 'PENDING'"
  ).get().count;

  return res.json({
    totalStudents,
    totalTeachers,
    avgMarks,
    avgAttendance,
    pendingLeaves,
    pendingApprovals,
  });
});

// ─── GET /api/owner/marks ─────────────────────────────────────────────────────
// Owner can view all marks with optional filters
router.get('/marks', authenticate, requireRole('OWNER'), (req, res) => {
  const { student_id, exam_name, class: cls } = req.query;

  let query = `
    SELECT m.*, s.first_name, s.last_name, s.class, s.roll_number,
           u.username AS uploaded_by_username
    FROM marks m
    JOIN students s ON m.student_id = s.id
    LEFT JOIN users u ON m.uploaded_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (student_id) {
    query += ' AND m.student_id = ?';
    params.push(student_id);
  }
  if (exam_name) {
    query += ' AND m.exam_name = ?';
    params.push(exam_name);
  }
  if (cls) {
    query += ' AND s.class = ?';
    params.push(cls);
  }

  query += ' ORDER BY m.uploaded_at DESC';

  return res.json(db.prepare(query).all(...params));
});

// ─── GET /api/owner/attendance ────────────────────────────────────────────────
// Owner can view all attendance with optional filters
router.get('/attendance', authenticate, requireRole('OWNER'), (req, res) => {
  const { student_id, subject, date, class: cls } = req.query;

  let query = `
    SELECT a.*, s.first_name, s.last_name, s.class, s.roll_number,
           u.username AS marked_by_username
    FROM attendance a
    JOIN students s ON a.student_id = s.id
    LEFT JOIN users u ON a.marked_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (student_id) {
    query += ' AND a.student_id = ?';
    params.push(student_id);
  }
  if (subject) {
    query += ' AND a.subject = ?';
    params.push(subject);
  }
  if (date) {
    query += ' AND a.date = ?';
    params.push(date);
  }
  if (cls) {
    query += ' AND s.class = ?';
    params.push(cls);
  }

  query += ' ORDER BY a.date DESC, a.subject';

  return res.json(db.prepare(query).all(...params));
});

// ─── GET /api/owner/students ──────────────────────────────────────────────────
// Get all students with their basic info for owner dashboard
router.get('/students', authenticate, requireRole('OWNER'), (req, res) => {
  const students = db.prepare(`
    SELECT id, first_name, last_name, class, section, roll_number,
           class_teacher, profile_status, photo_url
    FROM students
    ORDER BY class, roll_number
  `).all();
  return res.json(students);
});

// ─── POST /api/owner/reset-password ──────────────────────────────────────────
// Reset password for any student or teacher account by username
router.post('/reset-password', authenticate, requireRole('OWNER'), (req, res) => {
  const { username, new_password } = req.body;
  if (!username || !new_password) {
    return res.status(400).json({ error: 'username and new_password are required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR username = ?').get(username, username + '@school.com');
  if (!user) {
    return res.status(404).json({ error: 'User account not found' });
  }

  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync(new_password.trim(), 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, user.id);

  return res.json({ message: `Password for ${user.username} reset successfully.` });
});

module.exports = router;
