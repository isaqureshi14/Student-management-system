const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/classes — all authenticated users can read
router.get('/', authenticate, (req, res) => {
  const classes = db.prepare('SELECT * FROM classes ORDER BY name ASC').all();
  return res.json(classes);
});

// POST /api/classes — owner only
router.post('/', authenticate, requireRole('OWNER'), (req, res) => {
  const { name, section } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Class name is required' });
  }
  const existing = db.prepare('SELECT id FROM classes WHERE name = ?').get(name.trim());
  if (existing) {
    return res.status(409).json({ error: `Class "${name.trim()}" already exists` });
  }
  const result = db.prepare('INSERT INTO classes (name, section) VALUES (?, ?)').run(name.trim(), section || null);
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(cls);
});

// DELETE /api/classes/:id — owner only
router.delete('/:id', authenticate, requireRole('OWNER'), (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Class not found' });
  db.prepare('DELETE FROM classes WHERE id = ?').run(req.params.id);
  return res.json({ message: 'Class deleted' });
});

module.exports = router;
