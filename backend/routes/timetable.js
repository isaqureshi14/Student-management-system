const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const VALID_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// GET /api/timetable?class=
router.get('/', authenticate, (req, res) => {
  const { class: cls } = req.query;
  let query = 'SELECT * FROM timetable';
  const params = [];
  if (cls) { query += ' WHERE class = ?'; params.push(cls); }
  query += ' ORDER BY class, day, period';
  return res.json(db.prepare(query).all(...params));
});

// GET /api/timetable/classes — distinct classes that have timetable entries
router.get('/classes', authenticate, (req, res) => {
  const rows = db.prepare('SELECT DISTINCT class FROM timetable ORDER BY class').all();
  return res.json(rows.map(r => r.class));
});

// POST /api/timetable — UPSERT (owner only)
router.post('/', authenticate, requireRole('OWNER'), (req, res) => {
  const { class: cls, day, period, subject, teacher_name, start_time, end_time } = req.body;

  if (!cls || !day || period == null || !subject) {
    return res.status(400).json({ error: 'class, day, period, and subject are required' });
  }
  if (!VALID_DAYS.includes(day)) {
    return res.status(400).json({ error: `day must be one of: ${VALID_DAYS.join(', ')}` });
  }
  if (period < 1 || period > 8) {
    return res.status(400).json({ error: 'period must be between 1 and 8' });
  }

  // Resolve teacher name based on subject
  let resolvedTeacherName = teacher_name || null;
  if (!resolvedTeacherName && subject) {
    const teacher = db.prepare('SELECT first_name, last_name FROM teachers WHERE LOWER(subject) = LOWER(?)').get(subject.trim());
    if (teacher) {
      resolvedTeacherName = `${teacher.first_name} ${teacher.last_name}`.trim();
    }
  }

  // UPSERT — insert or replace existing slot
  db.prepare(`
    INSERT INTO timetable (class, day, period, subject, teacher_name, start_time, end_time, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class, day, period) DO UPDATE SET
      subject      = excluded.subject,
      teacher_name = excluded.teacher_name,
      start_time   = excluded.start_time,
      end_time     = excluded.end_time,
      updated_at   = CURRENT_TIMESTAMP
  `).run(cls, day, period, subject, resolvedTeacherName,
         start_time || null, end_time || null, req.user.id);

  const entry = db.prepare('SELECT * FROM timetable WHERE class=? AND day=? AND period=?').get(cls, day, period);
  return res.status(200).json(entry);
});

// POST /api/timetable/bulk — save entire grid for a class at once
router.post('/bulk', authenticate, requireRole('OWNER'), (req, res) => {
  const { class: cls, entries } = req.body;
  if (!cls || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'class and entries[] required' });
  }

  const upsert = db.prepare(`
    INSERT INTO timetable (class, day, period, subject, teacher_name, start_time, end_time, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class, day, period) DO UPDATE SET
      subject      = excluded.subject,
      teacher_name = excluded.teacher_name,
      start_time   = excluded.start_time,
      end_time     = excluded.end_time,
      updated_at   = CURRENT_TIMESTAMP
  `);

  const deleteSlot = db.prepare('DELETE FROM timetable WHERE class=? AND day=? AND period=?');

  const save = db.transaction(() => {
    for (const e of entries) {
      if (!e.subject || e.subject.trim() === '' || e.subject === 'N/A') {
        deleteSlot.run(cls, e.day, e.period);
      } else {
        let resolvedTeacherName = e.teacher_name || null;
        if (!resolvedTeacherName && e.subject) {
          const teacher = db.prepare('SELECT first_name, last_name FROM teachers WHERE LOWER(subject) = LOWER(?)').get(e.subject.trim());
          if (teacher) {
            resolvedTeacherName = `${teacher.first_name} ${teacher.last_name}`.trim();
          }
        }
        upsert.run(cls, e.day, e.period, e.subject.trim(),
                   resolvedTeacherName, e.start_time || null, e.end_time || null, req.user.id);
      }
    }
  });
  save();

  const updated = db.prepare('SELECT * FROM timetable WHERE class=? ORDER BY day,period').all(cls);
  return res.json({ saved: entries.length, entries: updated });
});

// DELETE /api/timetable/:id
router.delete('/:id', authenticate, requireRole('OWNER'), (req, res) => {
  if (!db.prepare('SELECT id FROM timetable WHERE id=?').get(req.params.id)) {
    return res.status(404).json({ error: 'Not found' });
  }
  db.prepare('DELETE FROM timetable WHERE id=?').run(req.params.id);
  return res.json({ message: 'Deleted' });
});

module.exports = router;
