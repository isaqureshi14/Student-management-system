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
router.get('/', authenticate, (req, res) => {
  const { student_id, exam_name } = req.query;
  if (!student_id) return res.status(400).json({ error: 'student_id is required' });
  if (!canAccess(req.user, student_id)) return res.status(403).json({ error: 'Access denied' });

  let query = `SELECT m.*, u.username AS uploaded_by_username
               FROM marks m LEFT JOIN users u ON m.uploaded_by = u.id
               WHERE m.student_id = ?`;
  const params = [student_id];
  if (exam_name) { query += ' AND m.exam_name = ?'; params.push(exam_name); }
  query += ' ORDER BY m.uploaded_at DESC';

  return res.json(db.prepare(query).all(...params));
});

// GET /api/marks/class-avg?class= — class average % per exam (accessible to PARENT/STUDENT/TEACHER/OWNER)
router.get('/class-avg', authenticate, (req, res) => {
  const { class: cls } = req.query;
  if (!cls) return res.status(400).json({ error: 'class is required' });

  const rows = db.prepare(`
    SELECT m.exam_name,
           AVG(CAST(m.score AS REAL) / CAST(m.max_score AS REAL) * 100) AS avg_pct
    FROM marks m
    JOIN students s ON m.student_id = s.id
    WHERE s.class = ?
    GROUP BY m.exam_name
    ORDER BY m.exam_name
  `).all(cls);

  return res.json(rows.map(r => ({
    exam_name: r.exam_name,
    avg_pct: Math.round(r.avg_pct * 10) / 10
  })));
});


router.get('/exams', authenticate, (req, res) => {
  const { class: cls } = req.query;
  let query = `SELECT DISTINCT m.exam_name FROM marks m
               JOIN students s ON m.student_id = s.id`;
  const params = [];
  if (cls) { query += ' WHERE s.class = ?'; params.push(cls); }
  query += ' ORDER BY m.exam_name';
  const rows = db.prepare(query).all(...params);
  return res.json(rows.map(r => r.exam_name));
});

// POST /api/marks
router.post('/', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const { student_id, exam_name, subject, score, max_score, remarks } = req.body;
  if (!student_id || !exam_name || !subject || score === undefined) {
    return res.status(400).json({ error: 'student_id, exam_name, subject, and score are required' });
  }
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(student_id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const result = db.prepare(`
    INSERT INTO marks (student_id, exam_name, subject, score, max_score, remarks, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(student_id, exam_name, subject, score, max_score ?? 100, remarks || null, req.user.id);

  return res.status(201).json(db.prepare('SELECT * FROM marks WHERE id = ?').get(result.lastInsertRowid));
});

// POST /api/marks/bulk — save marks for all students in one go
// Body: { exam_name, subject, max_score, entries: [{student_id, score, remarks}] }
router.post('/bulk', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const { exam_name, subject, max_score, entries } = req.body;
  if (!exam_name || !subject || !Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'exam_name, subject, and entries[] are required' });
  }

  const insert = db.prepare(`INSERT INTO marks (student_id,exam_name,subject,score,max_score,remarks,uploaded_by)
                              VALUES (?,?,?,?,?,?,?)`);
  const update = db.prepare(`UPDATE marks SET score=?,max_score=?,remarks=?,uploaded_by=?
                              WHERE student_id=? AND exam_name=? AND subject=?`);
  const find   = db.prepare(`SELECT id FROM marks WHERE student_id=? AND exam_name=? AND subject=?`);

  const save = db.transaction(() => {
    for (const e of entries) {
      const existing = find.get(e.student_id, exam_name, subject);
      if (existing) {
        update.run(e.score ?? 0, max_score ?? 100, e.remarks || null, req.user.id,
                   e.student_id, exam_name, subject);
      } else {
        insert.run(e.student_id, exam_name, subject, e.score ?? 0,
                   max_score ?? 100, e.remarks || null, req.user.id);
      }
    }
  });
  save();
  return res.json({ saved: entries.length });
});

// PUT /api/marks/:id
router.put('/:id', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const mark = db.prepare('SELECT * FROM marks WHERE id = ?').get(req.params.id);
  if (!mark) return res.status(404).json({ error: 'Mark not found' });

  const { exam_name, subject, score, max_score, remarks } = req.body;
  db.prepare(`UPDATE marks SET
    exam_name = COALESCE(?, exam_name), subject = COALESCE(?, subject),
    score = COALESCE(?, score), max_score = COALESCE(?, max_score),
    remarks = COALESCE(?, remarks) WHERE id = ?
  `).run(exam_name || null, subject || null,
         score !== undefined ? score : null,
         max_score !== undefined ? max_score : null,
         remarks !== undefined ? remarks : null, req.params.id);

  return res.json(db.prepare('SELECT * FROM marks WHERE id = ?').get(req.params.id));
});

// POST /api/marks/bulk-reset — reset/delete marks for a subject, class, and exam
router.post('/bulk-reset', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const { exam_name, subject, class: cls } = req.body;
  if (!exam_name || !subject || !cls) {
    return res.status(400).json({ error: 'exam_name, subject, and class are required' });
  }
  const students = db.prepare('SELECT id FROM students WHERE class = ?').all(cls);
  const studentIds = students.map(s => s.id);
  if (studentIds.length === 0) return res.json({ deleted: 0 });

  const placeholders = studentIds.map(() => '?').join(',');
  const result = db.prepare(`
    DELETE FROM marks
    WHERE exam_name = ? AND subject = ? AND student_id IN (${placeholders})
  `).run(exam_name, subject, ...studentIds);

  return res.json({ deleted: result.changes });
});

module.exports = router;
