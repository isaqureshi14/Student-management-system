const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/leaves ──────────────────────────────────────────────────────────
router.get('/', authenticate, (req, res) => {
  const { student_id } = req.query;
  const { role, linked_id } = req.user;

  let query = `
    SELECT lr.*, s.first_name || ' ' || s.last_name AS student_name
    FROM leave_requests lr
    LEFT JOIN students s ON lr.student_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (role === 'OWNER') {
    // Owner can see all leaves, optionally filtered by student_id
    if (student_id) {
      query += ' AND lr.student_id = ?';
      params.push(student_id);
    }
  } else if (role === 'PARENT') {
    // Parent can only see leaves for their linked student
    query += ' AND lr.student_id = ?';
    params.push(linked_id);
    if (student_id && parseInt(student_id) !== linked_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
  } else if (role === 'STUDENT') {
    // Student can only see their own leave requests
    query += ' AND lr.student_id = ?';
    params.push(linked_id);
    if (student_id && parseInt(student_id) !== linked_id) {
      return res.status(403).json({ error: 'Access denied' });
    }
  } else {
    return res.status(403).json({ error: 'Access denied' });
  }

  query += ' ORDER BY lr.submitted_at DESC';

  const leaves = db.prepare(query).all(...params);
  return res.json(leaves);
});

// ─── POST /api/leaves ─────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('PARENT'), (req, res) => {
  const { student_id, from_date, to_date, reason } = req.body;
  const { linked_id, id: parentUserId } = req.user;

  if (!student_id || !from_date || !to_date || !reason) {
    return res.status(400).json({ error: 'student_id, from_date, to_date, and reason are required' });
  }

  // Parent can only submit leave for their linked student
  if (parseInt(student_id) !== linked_id) {
    return res.status(403).json({ error: 'You can only submit leave requests for your linked student' });
  }

   const student = db.prepare('SELECT id FROM students WHERE id = ?').get(student_id);
   if (!student) return res.status(404).json({ error: 'Record not found' });

  const result = db.prepare(`
    INSERT INTO leave_requests (student_id, parent_user_id, from_date, to_date, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(student_id, parentUserId, from_date, to_date, reason);

  const leave = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(leave);
});

// ─── PUT /api/leaves/:id ──────────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('OWNER'), (req, res) => {
  const { id } = req.params;
   const leave = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
   if (!leave) return res.status(404).json({ error: 'Record not found' });

  const { status, owner_note } = req.body;

  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  const validStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
  if (!validStatuses.includes(status.toUpperCase())) {
    return res.status(400).json({ error: 'status must be PENDING, APPROVED, or REJECTED' });
  }

  db.prepare(`
    UPDATE leave_requests SET
      status = ?,
      owner_note = COALESCE(?, owner_note),
      reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status.toUpperCase(), owner_note || null, id);

  const updated = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
  return res.json(updated);
});

// ─── DELETE /api/leaves/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, id: userId, linked_id } = req.user;

   const leave = db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
   if (!leave) return res.status(404).json({ error: 'Record not found' });

  // Access control: OWNER can delete any leave request. PARENT can only delete requests for their linked student.
  if (role === 'OWNER') {
    // Allowed
  } else if (role === 'PARENT') {
    if (parseInt(leave.student_id) !== parseInt(linked_id)) {
      return res.status(403).json({ error: 'Access denied: You can only delete leave requests for your linked student' });
    }
  } else {
    return res.status(403).json({ error: 'Access denied' });
  }

  db.prepare('DELETE FROM leave_requests WHERE id = ?').run(id);
  return res.json({ success: true, message: 'Leave request deleted successfully' });
});

module.exports = router;
