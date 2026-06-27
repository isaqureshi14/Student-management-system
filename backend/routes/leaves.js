const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/leaves ──────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  const { student_id } = req.query;
  const { role, linked_id } = req.user;

  try {
    const params = [];
    let query = `SELECT lr.*, s.first_name || ' ' || s.last_name AS student_name
                 FROM leave_requests lr
                 LEFT JOIN students s ON lr.student_id = s.id
                 WHERE 1=1`;

    if (role === 'OWNER') {
      if (student_id) { params.push(student_id); query += ` AND lr.student_id = $${params.length}`; }
    } else if (role === 'PARENT') {
      if (student_id && parseInt(student_id) !== linked_id)
        return res.status(403).json({ error: 'Access denied' });
      params.push(linked_id); query += ` AND lr.student_id = $${params.length}`;
    } else if (role === 'STUDENT') {
      if (student_id && parseInt(student_id) !== linked_id)
        return res.status(403).json({ error: 'Access denied' });
      params.push(linked_id); query += ` AND lr.student_id = $${params.length}`;
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    query += ' ORDER BY lr.submitted_at DESC';
    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── POST /api/leaves ─────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('PARENT'), async (req, res) => {
  const { student_id, from_date, to_date, reason } = req.body;
  const { linked_id, id: parentUserId } = req.user;

  if (!student_id || !from_date || !to_date || !reason)
    return res.status(400).json({ error: 'student_id, from_date, to_date, and reason are required' });
  if (parseInt(student_id) !== linked_id)
    return res.status(403).json({ error: 'You can only submit leave requests for your linked student' });

  try {
    const s = await db.query('SELECT id FROM students WHERE id = $1', [student_id]);
    if (!s.rows[0]) return res.status(404).json({ error: 'Record not found' });

    const { rows: [leave] } = await db.query(`
      INSERT INTO leave_requests (student_id, parent_user_id, from_date, to_date, reason)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [student_id, parentUserId, from_date, to_date, reason]);

    return res.status(201).json(leave);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/leaves/:id ──────────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('OWNER'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT * FROM leave_requests WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Record not found' });

    const { status, owner_note } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    if (!['PENDING','APPROVED','REJECTED'].includes(status.toUpperCase()))
      return res.status(400).json({ error: 'status must be PENDING, APPROVED, or REJECTED' });

    await db.query(`
      UPDATE leave_requests SET
        status      = $1,
        owner_note  = COALESCE($2, owner_note),
        reviewed_at = NOW()
      WHERE id = $3
    `, [status.toUpperCase(), owner_note||null, id]);

    const updated = (await db.query('SELECT * FROM leave_requests WHERE id = $1', [id])).rows[0];
    return res.json(updated);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/leaves/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { role, linked_id } = req.user;
  try {
    const { rows } = await db.query('SELECT * FROM leave_requests WHERE id = $1', [id]);
    const leave = rows[0];
    if (!leave) return res.status(404).json({ error: 'Record not found' });

    if (role === 'PARENT' && parseInt(leave.student_id) !== parseInt(linked_id))
      return res.status(403).json({ error: 'Access denied: You can only delete leave requests for your linked student' });
    if (role !== 'OWNER' && role !== 'PARENT')
      return res.status(403).json({ error: 'Access denied' });

    await db.query('DELETE FROM leave_requests WHERE id = $1', [id]);
    return res.json({ success: true, message: 'Leave request deleted successfully' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
