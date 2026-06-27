const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── Multer setup for notes file uploads ─────────────────────────────────────
const notesDir = path.join(__dirname, '..', 'uploads', 'notes');
if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });

const notesStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, notesDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = path.basename(file.originalname, ext).replace(/[^a-z0-9_\-]/gi, '_').slice(0, 80);
    cb(null, `${safeName}_${Date.now()}${ext}`);
  },
});

const ALLOWED_NOTE_TYPES = /pdf|doc|docx|txt|ppt|pptx|xls|xlsx|png|jpg|jpeg/;
const noteFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (ALLOWED_NOTE_TYPES.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error('File type not allowed. Permitted: pdf, doc, docx, txt, ppt, xls, png, jpg'));
  }
};
const uploadNote = multer({ storage: notesStorage, fileFilter: noteFileFilter, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── GET /api/notes ───────────────────────────────────────────────────────────
router.get('/', authenticate, (req, res) => {
  const { class: cls, subject } = req.query;

  let query = `
    SELECT n.*, u.username AS uploaded_by_username
    FROM notes n
    LEFT JOIN users u ON n.uploaded_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (cls) {
    query += ' AND n.class = ?';
    params.push(cls);
  }
  if (subject) {
    query += ' AND n.subject = ?';
    params.push(subject);
  }

  query += ' ORDER BY n.uploaded_at DESC';

  const notes = db.prepare(query).all(...params);
  return res.json(notes);
});

// ─── POST /api/notes ──────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('TEACHER', 'OWNER'), uploadNote.single('file'), (req, res) => {
  const { title, content, subject, class: cls } = req.body;

  if (!title || !subject || !cls) {
    return res.status(400).json({ error: 'title, subject, and class are required' });
  }

  let fileUrl = null;
  let fileName = null;
  if (req.file) {
    fileUrl = `/uploads/notes/${req.file.filename}`;
    fileName = req.file.originalname;
  }

  const result = db.prepare(`
    INSERT INTO notes (title, content, file_url, file_name, subject, class, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, content || null, fileUrl, fileName, subject, cls, req.user.id);

  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(note);
});

// ─── DELETE /api/notes/:id ────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('TEACHER', 'OWNER'), (req, res) => {
  const { id } = req.params;
  const { role, id: userId } = req.user;

  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
   if (!note) return res.status(404).json({ error: 'Record not found' });

  // TEACHER can only delete their own notes; OWNER can delete any
  if (role === 'TEACHER' && note.uploaded_by !== userId) {
    return res.status(403).json({ error: 'You can only delete your own notes' });
  }

  // Optionally delete the file from disk
  if (note.file_url) {
    const filePath = path.join(__dirname, '..', note.file_url);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }
  }

  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return res.json({ message: 'Note deleted successfully' });
});

module.exports = router;
