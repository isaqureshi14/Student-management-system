const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

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
  const { first_name, last_name, subject, email, phone, temp_password } = req.body;

  if (!first_name || !subject)
    return res.status(400).json({ error: 'first_name and subject are required' });
  if (!email || !email.trim())
    return res.status(400).json({ error: 'email is required for teacher login' });
  if (!temp_password || !temp_password.trim())
    return res.status(400).json({ error: 'temp_password is required' });

  const teacherEmail = email.trim();
  const rawPassword  = temp_password.trim();
  const finalLastName = (last_name !== undefined && last_name !== null) ? last_name : '';

  try {
    const ex = await db.query('SELECT id FROM users WHERE username = $1', [teacherEmail]);
    if (ex.rows[0]) return res.status(409).json({ error: 'This email is already in use' });

    const { rows: [teacher] } = await db.query(
      'INSERT INTO teachers (first_name, last_name, subject, email, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [first_name, finalLastName, subject, teacherEmail, phone||null]
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
    const { first_name, last_name, subject, email, phone } = req.body;

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

    await db.query(`
      UPDATE teachers SET
        first_name = COALESCE($1, first_name),
        last_name  = COALESCE($2, last_name),
        subject    = COALESCE($3, subject),
        email      = COALESCE($4, email),
        phone      = COALESCE($5, phone)
      WHERE id = $6
    `, [first_name!==undefined?first_name:null,
        last_name!==undefined?last_name:null,
        subject!==undefined?subject:null,
        email!==undefined?email:null,
        phone!==undefined?phone:null,
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
