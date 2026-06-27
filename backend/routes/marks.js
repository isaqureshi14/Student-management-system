const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function canAccess(user, studentId) {
  const { role, linked_id } = user;
  if (role === 'OWNER' || role === 'TEACHER') return true;
  if ((role === 'STUDENT' || role === 'PARENT') && linked_id === parseInt(studentId)) return true;
  return false;
}

// GET /api/marks?student_id=&exam_name=
router.get('/', authenticate, async (req, res) => {
  const { student_id, exam_name } = req.query;
  if (!student_id) return res.status(400).json({ error: 'student_id is required' });
  if (!canAccess(req.user, student_id)) return res.status(403).json({ error: 'Access denied' });

  try {
    const params = [student_id];
    let query = `SELECT m.*, u.username AS uploaded_by_username
                 FROM marks m LEFT JOIN users u ON m.uploaded_by = u.id
                 WHERE m.student_id = $1`;
    if (exam_name) { params.push(exam_name); query += ` AND m.exam_name = $${params.length}`; }
    query += ' ORDER BY m.uploaded_at DESC';
    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// GET /api/marks/class-avg?class=
router.get('/class-avg', authenticate, async (req, res) => {
  const { class: cls } = req.query;
  if (!cls) return res.status(400).json({ error: 'class is required' });
  try {
    const { rows } = await db.query(`
      SELECT m.exam_name,
             AVG(m.score::REAL / m.max_score::REAL * 100) AS avg_pct
      FROM marks m JOIN students s ON m.student_id = s.id
      WHERE s.class = $1
      GROUP BY m.exam_name ORDER BY m.exam_name
    `, [cls]);
    return res.json(rows.map(r => ({ exam_name: r.exam_name, avg_pct: Math.round(r.avg_pct * 10) / 10 })));
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// GET /api/marks/exams
router.get('/exams', authenticate, async (req, res) => {
  const { class: cls } = req.query;
  try {
    const params = [];
    let query = `SELECT DISTINCT m.exam_name FROM marks m JOIN students s ON m.student_id = s.id`;
    if (cls) { params.push(cls); query += ` WHERE s.class = $1`; }
    query += ' ORDER BY m.exam_name';
    const { rows } = await db.query(query, params);
    return res.json(rows.map(r => r.exam_name));
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/marks
router.post('/', authenticate, requireRole('TEACHER', 'OWNER'), async (req, res) => {
  const { student_id, exam_name, subject, score, max_score, remarks } = req.body;
  if (!student_id || !exam_name || !subject || score === undefined)
    return res.status(400).json({ error: 'student_id, exam_name, subject, and score are required' });
  try {
    const s = await db.query('SELECT id FROM students WHERE id = $1', [student_id]);
    if (!s.rows[0]) return res.status(404).json({ error: 'Record not found' });

    const { rows: [mark] } = await db.query(`
      INSERT INTO marks (student_id, exam_name, subject, score, max_score, remarks, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [student_id, exam_name, subject, score, max_score??100, remarks||null, req.user.id]);

    return res.status(201).json(mark);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/marks/bulk
router.post('/bulk', authenticate, requireRole('TEACHER', 'OWNER'), async (req, res) => {
  const { exam_name, subject, max_score, entries } = req.body;
  if (!exam_name || !subject || !Array.isArray(entries) || entries.length === 0)
    return res.status(400).json({ error: 'exam_name, subject, and entries[] are required' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      const ex = await client.query(
        'SELECT id FROM marks WHERE student_id=$1 AND exam_name=$2 AND subject=$3',
        [e.student_id, exam_name, subject]
      );
      if (ex.rows[0]) {
        await client.query(
          'UPDATE marks SET score=$1, max_score=$2, remarks=$3, uploaded_by=$4 WHERE student_id=$5 AND exam_name=$6 AND subject=$7',
          [e.score??0, max_score??100, e.remarks||null, req.user.id, e.student_id, exam_name, subject]
        );
      } else {
        await client.query(
          'INSERT INTO marks (student_id,exam_name,subject,score,max_score,remarks,uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [e.student_id, exam_name, subject, e.score??0, max_score??100, e.remarks||null, req.user.id]
        );
      }
    }
    await client.query('COMMIT');
    return res.json({ saved: entries.length });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// PUT /api/marks/:id
router.put('/:id', authenticate, requireRole('TEACHER', 'OWNER'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM marks WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Record not found' });

    const { exam_name, subject, score, max_score, remarks } = req.body;
    await db.query(`
      UPDATE marks SET
        exam_name = COALESCE($1, exam_name),
        subject   = COALESCE($2, subject),
        score     = COALESCE($3, score),
        max_score = COALESCE($4, max_score),
        remarks   = COALESCE($5, remarks)
      WHERE id = $6
    `, [exam_name||null, subject||null,
        score!==undefined?score:null,
        max_score!==undefined?max_score:null,
        remarks!==undefined?remarks:null,
        req.params.id]);

    const updated = (await db.query('SELECT * FROM marks WHERE id = $1', [req.params.id])).rows[0];
    return res.json(updated);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/marks/bulk-reset
router.post('/bulk-reset', authenticate, requireRole('TEACHER', 'OWNER'), async (req, res) => {
  const { exam_name, subject, class: cls } = req.body;
  if (!exam_name || !subject || !cls)
    return res.status(400).json({ error: 'exam_name, subject, and class are required' });
  try {
    const { rows: students } = await db.query('SELECT id FROM students WHERE class = $1', [cls]);
    if (students.length === 0) return res.json({ deleted: 0 });

    const ids = students.map(s => s.id);
    const placeholders = ids.map((_, i) => `$${i + 3}`).join(',');
    const result = await db.query(
      `DELETE FROM marks WHERE exam_name=$1 AND subject=$2 AND student_id IN (${placeholders})`,
      [exam_name, subject, ...ids]
    );
    return res.json({ deleted: result.rowCount });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
