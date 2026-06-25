const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── Multer setup for photo uploads ──────────────────────────────────────────
const photoDir = path.join(__dirname, '..', 'uploads', 'photos');
if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photoDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `student_${req.params.id}_${Date.now()}${ext}`);
  },
});

const ALLOWED_IMAGE_TYPES = /jpeg|jpg|png|gif|webp/;
const photoFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  const mime = file.mimetype;
  if (ALLOWED_IMAGE_TYPES.test(ext) && ALLOWED_IMAGE_TYPES.test(mime)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
  }
};
const uploadPhoto = multer({ storage: photoStorage, fileFilter: photoFileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// ─── GET /api/students ────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('OWNER', 'TEACHER'), (req, res) => {
  const students = db.prepare('SELECT * FROM students ORDER BY created_at DESC').all();
  return res.json(students);
});

// ─── GET /api/students/:id ────────────────────────────────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, linked_id } = req.user;

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  if (role === 'OWNER' || role === 'TEACHER') {
    return res.json(student);
  }
  // Student can view their own record
  if (role === 'STUDENT' && linked_id === student.id) {
    return res.json(student);
  }
  // Parent can view their linked student's record
  if (role === 'PARENT' && linked_id === student.id) {
    return res.json(student);
  }

  return res.status(403).json({ error: 'Access denied' });
});

// ─── POST /api/students ───────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('OWNER'), (req, res) => {
  const {
    first_name, last_name, class: cls, section, roll_number,
    email, temp_password,
    father_name, father_phone, mother_name, mother_phone,
    address, class_teacher,
  } = req.body;

  if (!first_name || !last_name || !cls) {
    return res.status(400).json({ error: 'first_name, last_name, and class are required' });
  }

  // If email provided, make sure it isn't already taken
  if (email) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: `Email "${email}" is already registered to another account` });
    }
  }

  // Generate a random 8-char password if none supplied
  const rawPassword = (temp_password && temp_password.trim())
    ? temp_password.trim()
    : Math.random().toString(36).slice(-8).toUpperCase().replace(/[^A-Z0-9]/g, 'X').padEnd(8, '0');

  const insertStudent = db.prepare(`
    INSERT INTO students
      (first_name, last_name, class, section, roll_number, email,
       father_name, father_phone, mother_name, mother_phone, address, class_teacher)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const studentResult = insertStudent.run(
    first_name, last_name, cls, section || null, roll_number || null,
    email || null,
    father_name || null, father_phone || null, mother_name || null,
    mother_phone || null, address || null, class_teacher || null
  );

  const studentId = studentResult.lastInsertRowid;

  // Use provided email as username if given, otherwise fall back to generated one
  const studentUsername = email || `student_${studentId}@school.com`;
  const studentPasswordHash = bcrypt.hashSync(rawPassword, 10);
  db.prepare('INSERT INTO users (username, password, role, linked_id) VALUES (?, ?, ?, ?)')
    .run(studentUsername, studentPasswordHash, 'STUDENT', studentId);

  // Auto-create PARENT user account (always uses generated pattern)
  const parentUsername = `parent_${studentId}@school.com`;
  const parentPassword = bcrypt.hashSync('parent123', 10);
  db.prepare('INSERT INTO users (username, password, role, linked_id) VALUES (?, ?, ?, ?)')
    .run(parentUsername, parentPassword, 'PARENT', studentId);

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(studentId);

  return res.status(201).json({
    student,
    accounts: {
      student: { username: studentUsername, password: rawPassword },
      parent:  { username: parentUsername,  password: 'parent123' },
    },
  });
});

// ─── PUT /api/students/:id ────────────────────────────────────────────────────
router.put('/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { role, linked_id } = req.user;

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  // OWNER can update any field including profile_status
  if (role === 'OWNER') {
    const {
      first_name, last_name, class: cls, section, roll_number,
      email,
      father_name, father_phone, mother_name, mother_phone,
      address, class_teacher, profile_status,
    } = req.body;

    if (email && email.trim()) {
      const trimmedEmail = email.trim();
      const existing = db.prepare("SELECT id FROM users WHERE username = ? AND NOT (role = 'STUDENT' AND linked_id = ?)")
        .get(trimmedEmail, id);
      if (existing) {
        return res.status(409).json({ error: `Email "${trimmedEmail}" is already registered to another account` });
      }
      db.prepare("UPDATE users SET username = ? WHERE role = 'STUDENT' AND linked_id = ?")
        .run(trimmedEmail, id);
    }

    db.prepare(`
      UPDATE students SET
        first_name = COALESCE(?, first_name),
        last_name = COALESCE(?, last_name),
        class = COALESCE(?, class),
        section = COALESCE(?, section),
        roll_number = COALESCE(?, roll_number),
        email = COALESCE(?, email),
        father_name = COALESCE(?, father_name),
        father_phone = COALESCE(?, father_phone),
        mother_name = COALESCE(?, mother_name),
        mother_phone = COALESCE(?, mother_phone),
        address = COALESCE(?, address),
        class_teacher = COALESCE(?, class_teacher),
        profile_status = COALESCE(?, profile_status)
      WHERE id = ?
    `).run(
      first_name || null, last_name || null, cls || null,
      section !== undefined ? section : null,
      roll_number !== undefined ? roll_number : null,
      email !== undefined ? email : null,
      father_name !== undefined ? father_name : null,
      father_phone !== undefined ? father_phone : null,
      mother_name !== undefined ? mother_name : null,
      mother_phone !== undefined ? mother_phone : null,
      address !== undefined ? address : null,
      class_teacher !== undefined ? class_teacher : null,
      profile_status || null,
      id
    );

    const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    return res.json(updated);
  }

  // STUDENT can edit own profile, resets status to PENDING
  if (role === 'STUDENT' && linked_id === student.id) {
    const {
      father_name, father_phone, mother_name, mother_phone, address,
    } = req.body;

    db.prepare(`
      UPDATE students SET
        pending_father_name = ?,
        pending_father_phone = ?,
        pending_mother_name = ?,
        pending_mother_phone = ?,
        pending_address = ?,
        profile_status = 'PENDING'
      WHERE id = ?
    `).run(
      father_name !== undefined ? father_name : null,
      father_phone !== undefined ? father_phone : null,
      mother_name !== undefined ? mother_name : null,
      mother_phone !== undefined ? mother_phone : null,
      address !== undefined ? address : null,
      id
    );

    const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    return res.json(updated);
  }

  return res.status(403).json({ error: 'Access denied' });
});

// ─── POST /api/students/:id/approve ──────────────────────────────────────────
router.post('/:id/approve', authenticate, requireRole('OWNER'), (req, res) => {
  const { id } = req.params;
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  db.prepare(`
    UPDATE students SET
      father_name = COALESCE(pending_father_name, father_name),
      father_phone = COALESCE(pending_father_phone, father_phone),
      mother_name = COALESCE(pending_mother_name, mother_name),
      mother_phone = COALESCE(pending_mother_phone, mother_phone),
      address = COALESCE(pending_address, address),
      photo_url = COALESCE(pending_photo_url, photo_url),
      profile_status = 'APPROVED',
      pending_father_name = NULL,
      pending_father_phone = NULL,
      pending_mother_name = NULL,
      pending_mother_phone = NULL,
      pending_address = NULL,
      pending_photo_url = NULL
    WHERE id = ?
  `).run(id);

  const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  return res.json(updated);
});

// ─── DELETE /api/students/:id ─────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('OWNER'), (req, res) => {
  const { id } = req.params;
  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  db.prepare('DELETE FROM students WHERE id = ?').run(id);
  // Also remove linked user accounts
  db.prepare("DELETE FROM users WHERE linked_id = ? AND role IN ('STUDENT','PARENT')").run(id);
  return res.json({ message: 'Student deleted successfully' });
});

// ─── POST /api/students/:id/photo ─────────────────────────────────────────────
router.post('/:id/photo', authenticate, uploadPhoto.single('photo'), (req, res) => {
  const { id } = req.params;
  const { role, linked_id } = req.user;

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  // Only OWNER or the student themselves
  if (role !== 'OWNER' && !(role === 'STUDENT' && linked_id === student.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No photo file uploaded' });
  }

  const photoUrl = `/uploads/photos/${req.file.filename}`;
  if (role === 'OWNER') {
    db.prepare('UPDATE students SET photo_url = ? WHERE id = ?').run(photoUrl, id);
  } else {
    db.prepare('UPDATE students SET pending_photo_url = ?, profile_status = \'PENDING\' WHERE id = ?').run(photoUrl, id);
  }

  const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  return res.json(updated);
});

module.exports = router;
