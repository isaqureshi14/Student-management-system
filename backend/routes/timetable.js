const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
const VALID_DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// GET /api/timetable?class=
router.get('/', authenticate, async (req, res) => {
  const { class: cls } = req.query;
  try {
    const params = [];
    let query = 'SELECT * FROM timetable';
    if (cls) { params.push(cls); query += ' WHERE class = $1'; }
    query += ' ORDER BY class, day, period';
    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// GET /api/timetable/classes
router.get('/classes', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT DISTINCT class FROM timetable ORDER BY class');
    return res.json(rows.map(r => r.class));
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/timetable — UPSERT
router.post('/', authenticate, requireRole('OWNER'), async (req, res) => {
  const { class: cls, day, period, subject, teacher_name, start_time, end_time } = req.body;

  if (!cls || !day || period == null || !subject)
    return res.status(400).json({ error: 'class, day, period, and subject are required' });
  if (!VALID_DAYS.includes(day))
    return res.status(400).json({ error: `day must be one of: ${VALID_DAYS.join(', ')}` });
  if (period < 1 || period > 8)
    return res.status(400).json({ error: 'period must be between 1 and 8' });

  try {
    let resolvedTeacherName = teacher_name || null;
    if (!resolvedTeacherName && subject) {
      const r = await db.query('SELECT first_name, last_name FROM teachers WHERE LOWER(subject) = LOWER($1)', [subject.trim()]);
      if (r.rows[0]) resolvedTeacherName = `${r.rows[0].first_name} ${r.rows[0].last_name}`.trim();
    }

    // ── Conflict check: same teacher already assigned to a DIFFERENT class at this slot
    if (resolvedTeacherName) {
      const conflict = await db.query(
        'SELECT id, class FROM timetable WHERE teacher_name = $1 AND day = $2 AND period = $3 AND class != $4',
        [resolvedTeacherName, day, period, cls]
      );
      if (conflict.rows.length > 0) {
        const conflictClass = conflict.rows[0].class;
        return res.status(400).json({
          error: `Error: The teacher is not available at this time slot. Already assigned to class "${conflictClass}" on ${day}, Period ${period}.`
        });
      }
    }

    const { rows: [entry] } = await db.query(`
      INSERT INTO timetable (class, day, period, subject, teacher_name, start_time, end_time, created_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (class, day, period) DO UPDATE SET
        subject      = EXCLUDED.subject,
        teacher_name = EXCLUDED.teacher_name,
        start_time   = EXCLUDED.start_time,
        end_time     = EXCLUDED.end_time,
        updated_at   = NOW()
      RETURNING *
    `, [cls, day, period, subject, resolvedTeacherName, start_time||null, end_time||null, req.user.id]);

    return res.status(200).json(entry);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// POST /api/timetable/bulk
router.post('/bulk', authenticate, requireRole('OWNER'), async (req, res) => {
  const { class: cls, entries } = req.body;
  if (!cls || !Array.isArray(entries))
    return res.status(400).json({ error: 'class and entries[] required' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const e of entries) {
      if (!e.subject || e.subject.trim() === '' || e.subject === 'N/A') {
        await client.query('DELETE FROM timetable WHERE class=$1 AND day=$2 AND period=$3', [cls, e.day, e.period]);
      } else {
        let resolvedTeacherName = e.teacher_name || null;
        if (!resolvedTeacherName && e.subject) {
          const r = await client.query('SELECT first_name, last_name FROM teachers WHERE LOWER(subject) = LOWER($1)', [e.subject.trim()]);
          if (r.rows[0]) resolvedTeacherName = `${r.rows[0].first_name} ${r.rows[0].last_name}`.trim();
        }

        // ── Conflict check: same teacher already assigned to a DIFFERENT class at this slot
        if (resolvedTeacherName) {
          const conflict = await client.query(
            'SELECT id, class FROM timetable WHERE teacher_name = $1 AND day = $2 AND period = $3 AND class != $4',
            [resolvedTeacherName, e.day, e.period, cls]
          );
          if (conflict.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
              error: `Error: The teacher "${resolvedTeacherName}" is not available at this time slot. Already assigned to class "${conflict.rows[0].class}" on ${e.day}, Period ${e.period}.`
            });
          }
        }

        await client.query(`
          INSERT INTO timetable (class, day, period, subject, teacher_name, start_time, end_time, created_by, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
          ON CONFLICT (class, day, period) DO UPDATE SET
            subject      = EXCLUDED.subject,
            teacher_name = EXCLUDED.teacher_name,
            start_time   = EXCLUDED.start_time,
            end_time     = EXCLUDED.end_time,
            updated_at   = NOW()
        `, [cls, e.day, e.period, e.subject.trim(), resolvedTeacherName, e.start_time||null, e.end_time||null, req.user.id]);
      }
    }
    await client.query('COMMIT');
    const { rows } = await db.query('SELECT * FROM timetable WHERE class=$1 ORDER BY day,period', [cls]);
    return res.json({ saved: entries.length, entries: rows });
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// DELETE /api/timetable/:id
router.delete('/:id', authenticate, requireRole('OWNER'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id FROM timetable WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await db.query('DELETE FROM timetable WHERE id=$1', [req.params.id]);
    return res.json({ message: 'Deleted' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
