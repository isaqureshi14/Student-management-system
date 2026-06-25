const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { identifier, password, role } = req.body;

  if (!identifier || !password || !role) {
    return res.status(400).json({ error: 'identifier, password, and role are required' });
  }

  const roleUpper = role.toUpperCase();
  const validRoles = ['STUDENT', 'TEACHER', 'PARENT', 'OWNER'];
  if (!validRoles.includes(roleUpper)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE (username = ? OR username = ? OR username = ? OR username = ?) AND role = ?')
    .get(identifier, identifier + '@school.com', identifier.toLowerCase(), identifier.toLowerCase() + '@school.com', roleUpper);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials or role mismatch' });
  }

  const passwordMatch = bcrypt.compareSync(password, user.password);
  if (!passwordMatch) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = { id: user.id, role: user.role, linked_id: user.linked_id };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

  // Return user without password
  const { password: _pw, ...safeUser } = user;

  let name = 'User';
  try {
    if (user.role === 'STUDENT') {
      const student = db.prepare('SELECT first_name, last_name FROM students WHERE id = ?').get(user.linked_id);
      if (student) name = `${student.first_name} ${student.last_name}`;
    } else if (user.role === 'PARENT') {
      // For parent, try to get father_name or mother_name from the linked student record
      const student = db.prepare('SELECT father_name, mother_name FROM students WHERE id = ?').get(user.linked_id);
      if (student && student.father_name) name = student.father_name;
      else if (student && student.mother_name) name = student.mother_name;
      else name = 'Guardian';
    } else if (user.role === 'TEACHER') {
      const teacher = db.prepare('SELECT first_name, last_name FROM teachers WHERE id = ?').get(user.linked_id);
      if (teacher) name = `${teacher.first_name} ${teacher.last_name}`;
    } else if (user.role === 'OWNER') {
      name = 'Owner';
    }
  } catch (err) {
    console.error('Error fetching user name during login:', err);
  }

  return res.json({ token, user: { ...safeUser, name } });
});

// PUT /api/auth/update-credentials
router.put('/update-credentials', authenticate, (req, res) => {
  const { username, password } = req.body;
  const userId = req.user.id;

  if (!username) {
    return res.status(400).json({ error: 'username is required' });
  }

  const trimmedUsername = username.trim().toLowerCase();

  // Check if username is already taken by another user
  const existing = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?").get(trimmedUsername, userId);
  if (existing) {
    return res.status(409).json({ error: 'Username/Login ID is already taken by another account' });
  }

  if (password && password.trim()) {
    const hashedPassword = bcrypt.hashSync(password.trim(), 10);
    db.prepare("UPDATE users SET username = ?, password = ? WHERE id = ?").run(trimmedUsername, hashedPassword, userId);
  } else {
    db.prepare("UPDATE users SET username = ? WHERE id = ?").run(trimmedUsername, userId);
  }

  return res.json({ success: true, username: trimmedUsername, message: 'Credentials updated successfully' });
});

module.exports = router;
