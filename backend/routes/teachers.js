const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── Helper: normalise subjects input ────────────────────────────────────────
// Accepts either a subjects[] array or a legacy subject string.
// Always returns a non-empty array and a single primary subject string.
function normaliseSubjects(subjects, subject) {
  let arr = [];
  if (Array.isArray(subjects) && subjects.length > 0) {
    arr = subjects.map(s => String(s).trim()).filter(Boolean);
  } else if (subject && String(subject).trim()) {
    arr = [String(subject).trim()];
  }
  if (arr.length === 0) return null; // caller should validate
  return arr;
}

router.get('/', authenticate, async (req, res) => {
  const { role, linked_id } = req.user;
  try {
    if (role === 'OWNER') {
      const { rows } = await db.query('SELECT * FROM teachers ORDER BY created_at DESC');
      return res.json(rows);
    }
    if (role === 'TEACHER') {
      const { rows } = await db.query('SELECT * FROM teachers WHERE id = $1', [linked_id]);
      return res.json(rows);
    }
    return res.status(403).json({ error: 'Access denied' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, requireRole('OWNER', 'TEACHER'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM teachers WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Record not found' });
    return res.json(rows[0]);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

router.post('/', authenticate, requireRole('OWNER'), async (req, res) => {
  const { first_name, last_name, subjects, subject, email, phone, temp_password } = req.body;

  const subjectsArr = normaliseSubjects(subjects, subject);
  if (!first_name || !subjectsArr)
    return res.status(400).json({ error: 'first_name and at least one subject are required' });
  if (!email || !email.trim())
    return res.status(400).json({ error: 'email is required for teacher login' });
  if (!temp_password || !temp_password.trim())
    return res.status(400).json({ error: 'temp_password is required' });

  const teacherEmail   = email.trim();
  const rawPassword    = temp_password.trim();
  const primarySubject = subjectsArr[0];
  const finalLastName  = (last_name !== undefined && last_name !== null) ? last_name : '';

  try {
    const ex = await db.query('SELECT id FROM users WHERE username = $1', [teacherEmail]);
    if (ex.rows[0]) return res.status(409).json({ error: 'This email is already in use' });

    const { rows: [teacher] } = await db.query(
      'INSERT INTO teachers (first_name, last_name, subject, subjects, email, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [first_name, finalLastName, primarySubject, subjectsArr, teacherEmail, phone || null]
    );

    await db.query(
      'INSERT INTO users (username, password, role, linked_id) VALUES ($1,$2,$3,$4)',
      [teacherEmail, bcrypt.hashSync(rawPassword, 10), 'TEACHER', teacher.id]
    );

    return res.status(201).json({
      teacher,
      account: { username: teacherEmail, password: rawPassword },
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

router.put('/:id', authenticate, requireRole('OWNER'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, first_name, last_name FROM teachers WHERE id = $1', [req.params.id]);
    const teacher = rows[0];
    if (!teacher) return res.status(404).json({ error: 'Record not found' });

    const oldFullName = `${teacher.first_name} ${teacher.last_name}`.trim();
    const { first_name, last_name, subjects, subject, email, phone } = req.body;

    if (email && email.trim()) {
      const trimmedEmail = email.trim();
      const ex = await db.query(
        "SELECT id FROM users WHERE username = $1 AND NOT (role = 'TEACHER' AND linked_id = $2)",
        [trimmedEmail, req.params.id]
      );
      if (ex.rows[0]) return res.status(409).json({ error: 'This email is already in use' });
      await db.query("UPDATE users SET username = $1 WHERE role = 'TEACHER' AND linked_id = $2",
        [trimmedEmail, req.params.id]);
    }

    // Resolve subjects array — only update if either field is provided
    let subjectsArr    = null;
    let primarySubject = null;
    if (subjects !== undefined || subject !== undefined) {
      subjectsArr    = normaliseSubjects(subjects, subject);
      primarySubject = subjectsArr ? subjectsArr[0] : null;
    }

    await db.query(`
      UPDATE teachers SET
        first_name = COALESCE($1, first_name),
        last_name  = COALESCE($2, last_name),
        subject    = COALESCE($3, subject),
        subjects   = COALESCE($4, subjects),
        email      = COALESCE($5, email),
        phone      = COALESCE($6, phone)
      WHERE id = $7
    `, [first_name !== undefined ? first_name : null,
        last_name  !== undefined ? last_name  : null,
        primarySubject,
        subjectsArr,
        email      !== undefined ? email      : null,
        phone      !== undefined ? phone      : null,
        req.params.id]);

    const updated = (await db.query('SELECT first_name, last_name FROM teachers WHERE id = $1', [req.params.id])).rows[0];
    const newFullName = `${updated.first_name} ${updated.last_name}`.trim();
    if (oldFullName !== newFullName) {
      await db.query('UPDATE timetable SET teacher_name = $1 WHERE teacher_name = $2', [newFullName, oldFullName]);
    }

    const full = (await db.query('SELECT * FROM teachers WHERE id = $1', [req.params.id])).rows[0];
    return res.json(full);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, requireRole('OWNER'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id FROM teachers WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Teacher not found' });
    await db.query('DELETE FROM teachers WHERE id = $1', [req.params.id]);
    await db.query("DELETE FROM users WHERE linked_id = $1 AND role = 'TEACHER'", [req.params.id]);
    return res.json({ message: 'Teacher deleted' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
