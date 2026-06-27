const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, authenticate } = require('../middleware/auth');
const { validate, loginSchema, updateCredentialsSchema } = require('../middleware/validation');
const { loginRateLimiter, accountLockoutMiddleware, applyProgressiveDelay, handleLoginResult } = require('../middleware/rateLimiter');

const router = express.Router();

const GENERIC_ERROR = 'Incorrect email or password';
const SERVER_ERROR  = 'Authentication failed. Please try again.';

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
    const { rows } = await db.query(
      `SELECT * FROM users
       WHERE (username = $1 OR username = $2 OR username = $3 OR username = $4)
         AND role = $5`,
      [identifier, identifier + '@school.com',
       identifier.toLowerCase(), identifier.toLowerCase() + '@school.com',
       dbRole]
    );
    const user = rows[0];

    if (!user) {
      console.warn(`Login failed - user not found: ${identifier} (role: ${roleUpper}) from IP: ${req.ip}`);
      handleLoginResult(identifier, false);
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    const passwordMatch = db.verifyPassword(password, user.password);
    if (!passwordMatch) {
      console.warn(`Login failed - invalid password for: ${identifier} from IP: ${req.ip}`);
      handleLoginResult(identifier, false);
      return res.status(401).json({ error: GENERIC_ERROR });
    }

    if (db.needsRehash(user.password)) {
      const newHash = db.hashPassword(password);
      await db.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]);
      console.info(`Rehashed password for user: ${user.id}`);
    }

    handleLoginResult(identifier, true);

    const payload = { id: user.id, role: user.role, linked_id: user.linked_id };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

    const { password: _pw, ...safeUser } = user;

    let name = 'User';
    try {
      if (user.role === 'STUDENT') {
        const r = await db.query('SELECT first_name, last_name FROM students WHERE id = $1', [user.linked_id]);
        if (r.rows[0]) name = `${r.rows[0].first_name} ${r.rows[0].last_name}`;
      } else if (user.role === 'PARENT') {
        const r = await db.query('SELECT father_name, mother_name FROM students WHERE id = $1', [user.linked_id]);
        const s = r.rows[0];
        if (s && s.father_name) name = s.father_name;
        else if (s && s.mother_name) name = s.mother_name;
        else name = 'Guardian';
      } else if (user.role === 'TEACHER') {
        const r = await db.query('SELECT first_name, last_name FROM teachers WHERE id = $1', [user.linked_id]);
        if (r.rows[0]) name = `${r.rows[0].first_name} ${r.rows[0].last_name}`;
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
router.put('/update-credentials', authenticate, validate(updateCredentialsSchema), async (req, res) => {
  const { username, password } = req.body;
  const userId = req.user.id;
  const trimmedUsername = username.trim().toLowerCase();

  try {
    const existing = await db.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2',
      [trimmedUsername, userId]
    );
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'This username is already in use' });
    }

    if (password && password.trim()) {
      const hashedPassword = db.hashPassword(password.trim());
      await db.query('UPDATE users SET username = $1, password = $2 WHERE id = $3',
        [trimmedUsername, hashedPassword, userId]);
    } else {
      await db.query('UPDATE users SET username = $1 WHERE id = $2', [trimmedUsername, userId]);
    }

    console.info(`Credentials updated for user: ${userId}`);
    return res.json({ success: true, username: trimmedUsername, message: 'Credentials updated successfully' });
  } catch (err) {
    console.error('Update credentials error:', err);
    return res.status(500).json({ error: 'Failed to update credentials' });
  }
});

module.exports = router;