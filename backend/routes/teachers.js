const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, (req, res) => {
  const { role, linked_id } = req.user;
  if (role === 'OWNER') {
    return res.json(db.prepare('SELECT * FROM teachers ORDER BY created_at DESC').all());
  }
  if (role === 'TEACHER') {
    const t = db.prepare('SELECT * FROM teachers WHERE id = ?').get(linked_id);
    return res.json(t ? [t] : []);
  }
  return res.status(403).json({ error: 'Access denied' });
});

router.get('/:id', authenticate, requireRole('OWNER', 'TEACHER'), (req, res) => {
  const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Record not found' });
  return res.json(teacher);
});

router.post('/', authenticate, requireRole('OWNER'), (req, res) => {
  const { first_name, last_name, subject, email, phone, temp_password } = req.body;

  if (!first_name || !subject) {
    return res.status(400).json({ error: 'first_name and subject are required' });
  }
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'email is required for teacher login' });
  }
  if (!temp_password || !temp_password.trim()) {
    return res.status(400).json({ error: 'temp_password is required' });
  }

  const teacherEmail = email.trim();
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(teacherEmail)) {
    return res.status(409).json({ error: 'This email is already in use' });
  }

  const rawPassword = temp_password.trim();

  const finalLastName = (last_name !== undefined && last_name !== null) ? last_name : '';
  const result = db.prepare(
    'INSERT INTO teachers (first_name, last_name, subject, email, phone) VALUES (?, ?, ?, ?, ?)'
  ).run(first_name, finalLastName, subject, teacherEmail, phone || null);

  const teacherId = result.lastInsertRowid;
  db.prepare('INSERT INTO users (username, password, role, linked_id) VALUES (?, ?, ?, ?)')
    .run(teacherEmail, bcrypt.hashSync(rawPassword, 10), 'TEACHER', teacherId);

  return res.status(201).json({
    teacher: db.prepare('SELECT * FROM teachers WHERE id = ?').get(teacherId),
    account: { username: teacherEmail, password: rawPassword },
  });
});

router.put('/:id', authenticate, requireRole('OWNER'), (req, res) => {
  const teacher = db.prepare('SELECT id, first_name, last_name FROM teachers WHERE id = ?').get(req.params.id);
  if (!teacher) return res.status(404).json({ error: 'Record not found' });

  const oldFullName = `${teacher.first_name} ${teacher.last_name}`.trim();
  const { first_name, last_name, subject, email, phone } = req.body;

  if (email && email.trim()) {
    const trimmedEmail = email.trim();
    const existing = db.prepare("SELECT id FROM users WHERE username = ? AND NOT (role = 'TEACHER' AND linked_id = ?)")
      .get(trimmedEmail, req.params.id);
    if (existing) {
      return res.status(409).json({ error: 'This email is already in use' });
    }
    db.prepare("UPDATE users SET username = ? WHERE role = 'TEACHER' AND linked_id = ?")
      .run(trimmedEmail, req.params.id);
  }

  db.prepare(`UPDATE teachers SET
    first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name),
    subject = COALESCE(?, subject), email = COALESCE(?, email), phone = COALESCE(?, phone)
    WHERE id = ?
  `).run(
    first_name !== undefined ? first_name : null,
    last_name !== undefined ? last_name : null,
    subject !== undefined ? subject : null,
    email !== undefined ? email : null,
    phone !== undefined ? phone : null,
    req.params.id
  );

  const updatedTeacher = db.prepare('SELECT first_name, last_name FROM teachers WHERE id = ?').get(req.params.id);
  const newFullName = `${updatedTeacher.first_name} ${updatedTeacher.last_name}`.trim();
  if (oldFullName !== newFullName) {
    db.prepare("UPDATE timetable SET teacher_name = ? WHERE teacher_name = ?")
      .run(newFullName, oldFullName);
  }

  return res.json(db.prepare('SELECT * FROM teachers WHERE id = ?').get(req.params.id));
});

router.delete('/:id', authenticate, requireRole('OWNER'), (req, res) => {
  if (!db.prepare('SELECT id FROM teachers WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Teacher not found' });
  }
  db.prepare('DELETE FROM teachers WHERE id = ?').run(req.params.id);
  db.prepare("DELETE FROM users WHERE linked_id = ? AND role = 'TEACHER'").run(req.params.id);
  return res.json({ message: 'Teacher deleted' });
});

module.exports = router;
