const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/classes
router.get('/', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM classes ORDER BY name ASC');
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/classes
router.post('/', authenticate, requireRole('OWNER'), async (req, res) => {
  const { name, section } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ error: 'Class name is required' });
  try {
    const ex = await db.query('SELECT id FROM classes WHERE name = $1', [name.trim()]);
    if (ex.rows[0]) return res.status(409).json({ error: 'A class with this name already exists' });

    const { rows: [cls] } = await db.query(
      'INSERT INTO classes (name, section) VALUES ($1,$2) RETURNING *',
      [name.trim(), section||null]
    );
    return res.status(201).json(cls);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// DELETE /api/classes/:id
router.delete('/:id', authenticate, requireRole('OWNER'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM classes WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Record not found' });
    await db.query('DELETE FROM classes WHERE id = $1', [req.params.id]);
    return res.json({ message: 'Class deleted' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
