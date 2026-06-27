const express = require('express');
const jwt = require('jsonwebtoken');
const { db, hashPassword, verifyPassword, needsRehash } = require('../db');
const { JWT_SECRET, authenticate } = require('../middleware/auth');
const { validate, loginSchema, updateCredentialsSchema, sanitizeObject } = require('../middleware/validation');
const { loginRateLimiter, accountLockoutMiddleware, applyProgressiveDelay, handleLoginResult } = require('../middleware/rateLimiter');

const router = express.Router();

const GENERIC_ERROR = 'Incorrect email or password';
const SERVER_ERROR = 'Authentication failed. Please try again.';

// POST /api/auth/login
router.post('/login', loginRateLimiter(), accountLockoutMiddleware, applyProgressiveDelay, validate(loginSchema), async (req, res) => {
  const { identifier, password, role } = req.body;
  const roleUpper = role.toUpperCase();
  const validRoles = ['STUDENT', 'TEACHER', 'PARENT', 'OWNER', 'MANAGER'];
  
  if (!validRoles.includes(roleUpper)) {
    console.warn(`Invalid role attempted: ${role} from IP: ${req.ip}`);
    return res.status(400).json({ error: GENERIC_ERROR });
  }

  const dbRole = roleUpper === 'MANAGER' ? 'OWNER' : roleUpper;

  try {
    const user = db
      .prepare('SELECT * FROM users WHERE (username = ? OR username = ? OR username = ? OR username = ?) AND role = ?')
      .get(identifier, identifier + '@school.com', identifier.toLowerCase(), identifier.toLowerCase() + '@school.com', dbRole);

    if (!user) {
      console.warn(`Login failed - user not found: ${identifier} (role: ${roleUpper}) from IP: ${req.ip}`);
      handleLoginResult(identifier, false);
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    const passwordMatch = verifyPassword(password, user.password);
    if (!passwordMatch) {
      console.warn(`Login failed - invalid password for: ${identifier} from IP: ${req.ip}`);
      handleLoginResult(identifier, false);
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    if (needsRehash(user.password)) {
      const newHash = hashPassword(password);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newHash, user.id);
      console.info(`Rehashed password for user: ${user.id} (was using weak rounds)`);
    }

    handleLoginResult(identifier, true);

    const payload = { id: user.id, role: user.role, linked_id: user.linked_id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

    const { password: _pw, ...safeUser } = user;

    let name = 'User';
    try {
      if (user.role === 'STUDENT') {
        const student = db.prepare('SELECT first_name, last_name FROM students WHERE id = ?').get(user.linked_id);
        if (student) name = `${student.first_name} ${student.last_name}`;
      } else if (user.role === 'PARENT') {
        const student = db.prepare('SELECT father_name, mother_name FROM students WHERE id = ?').get(user.linked_id);
        if (student && student.father_name) name = student.father_name;
        else if (student && student.mother_name) name = student.mother_name;
        else name = 'Guardian';
      } else if (user.role === 'TEACHER') {
        const teacher = db.prepare('SELECT first_name, last_name FROM teachers WHERE id = ?').get(user.linked_id);
        if (teacher) name = `${teacher.first_name} ${teacher.last_name}`;
      } else if (user.role === 'OWNER') {
        name = 'Manager';
      }
    } catch (err) {
      console.error('Error fetching user name during login:', err);
    }

    return res.json({ token, user: { ...safeUser, name } });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: SERVER_ERROR });
  }
});

// PUT /api/auth/update-credentials
router.put('/update-credentials', authenticate, validate(updateCredentialsSchema), (req, res) => {
  const { username, password } = req.body;
  const userId = req.user.id;

  const trimmedUsername = username.trim().toLowerCase();

  const existing = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?").get(trimmedUsername, userId);
  if (existing) {
    console.warn(`Username conflict: ${trimmedUsername} attempted by user ${userId}`);
    return res.status(409).json({ error: 'This username is already in use' });
  }

  try {
    if (password && password.trim()) {
      const hashedPassword = hashPassword(password.trim());
      db.prepare("UPDATE users SET username = ?, password = ? WHERE id = ?").run(trimmedUsername, hashedPassword, userId);
    } else {
      db.prepare("UPDATE users SET username = ? WHERE id = ?").run(trimmedUsername, userId);
    }

    console.info(`Credentials updated for user: ${userId}`);
    return res.json({ success: true, username: trimmedUsername, message: 'Credentials updated successfully' });
  } catch (err) {
    console.error('Update credentials error:', err);
    return res.status(500).json({ error: 'Failed to update credentials' });
  }
});

module.exports = router;