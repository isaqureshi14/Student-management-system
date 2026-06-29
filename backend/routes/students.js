const express = require('express');
const bcrypt  = require('bcryptjs');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── Multer setup for photo uploads ──────────────────────────────────────────
const photoDir = path.join(__dirname, '..', 'uploads', 'photos');
if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, photoDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `student_${req.params.id}_${Date.now()}${ext}`);
  },
});
const ALLOWED_IMAGE_TYPES = /jpeg|jpg|png|gif|webp/;
const photoFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
  if (ALLOWED_IMAGE_TYPES.test(ext) && ALLOWED_IMAGE_TYPES.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (jpg, png, gif, webp) are allowed'));
  }
};
const uploadPhoto = multer({ storage: photoStorage, fileFilter: photoFileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

// ─── GET /api/students ────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('OWNER', 'TEACHER'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM students ORDER BY created_at DESC');
    return res.json(rows);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── GET /api/students/:id ────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { role, linked_id } = req.user;
  try {
    const { rows } = await db.query('SELECT * FROM students WHERE id = $1', [id]);
    const student = rows[0];
    if (!student) return res.status(404).json({ error: 'Record not found' });

    if (role === 'OWNER' || role === 'TEACHER') return res.json(student);
    if ((role === 'STUDENT' || role === 'PARENT') && linked_id === student.id) return res.json(student);
    return res.status(403).json({ error: 'Access denied' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── POST /api/students ───────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('OWNER'), async (req, res) => {
  const {
    first_name, last_name, class: cls, section, roll_number,
    email, temp_password,
    father_name, father_phone, mother_name, mother_phone,
    address, class_teacher,
  } = req.body;

  if (!first_name || !last_name || !cls)
    return res.status(400).json({ error: 'first_name, last_name, and class are required' });
  if (!temp_password || !temp_password.trim())
    return res.status(400).json({ error: 'temp_password is required' });

  try {
    if (email) {
      const ex = await db.query('SELECT id FROM users WHERE username = $1', [email]);
      if (ex.rows[0]) return res.status(409).json({ error: 'This email is already in use' });
    }

    const rawPassword = temp_password.trim();

    const { rows: [newStudent] } = await db.query(`
      INSERT INTO students
        (first_name, last_name, class, section, roll_number, email,
         father_name, father_phone, mother_name, mother_phone, address, class_teacher)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [first_name, last_name, cls, section||null, roll_number||null, email||null,
        father_name||null, father_phone||null, mother_name||null,
        mother_phone||null, address||null, class_teacher||null]);

    const studentId = newStudent.id;
    const studentUsername = email || `student_${studentId}@school.com`;
    const studentPasswordHash = bcrypt.hashSync(rawPassword, 10);

    await db.query(
      'INSERT INTO users (username, password, role, linked_id) VALUES ($1,$2,$3,$4)',
      [studentUsername, studentPasswordHash, 'STUDENT', studentId]
    );

    const parentUsername = `parent_${studentId}@school.com`;
    const parentPassword = bcrypt.hashSync('parent123', 10);
    await db.query(
      'INSERT INTO users (username, password, role, linked_id) VALUES ($1,$2,$3,$4)',
      [parentUsername, parentPassword, 'PARENT', studentId]
    );

    return res.status(201).json({
      student: newStudent,
      accounts: {
        student: { username: studentUsername, password: rawPassword },
        parent:  { username: parentUsername,  password: 'parent123' },
      },
    });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── PUT /api/students/:id ────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { role, linked_id } = req.user;

  try {
    const { rows } = await db.query('SELECT * FROM students WHERE id = $1', [id]);
    const student = rows[0];
    if (!student) return res.status(404).json({ error: 'Record not found' });

    if (role === 'OWNER') {
      const {
        first_name, last_name, class: cls, section, roll_number,
        email, father_name, father_phone, mother_name, mother_phone,
        address, class_teacher, profile_status,
      } = req.body;

      if (email && email.trim()) {
        const trimmedEmail = email.trim();
        const ex = await db.query(
          "SELECT id FROM users WHERE username = $1 AND NOT (role = 'STUDENT' AND linked_id = $2)",
          [trimmedEmail, id]
        );
        if (ex.rows[0]) return res.status(409).json({ error: 'This email is already in use' });
        await db.query(
          "UPDATE users SET username = $1 WHERE role = 'STUDENT' AND linked_id = $2",
          [trimmedEmail, id]
        );
      }

      await db.query(`
        UPDATE students SET
          first_name    = COALESCE($1,  first_name),
          last_name     = COALESCE($2,  last_name),
          class         = COALESCE($3,  class),
          section       = COALESCE($4,  section),
          roll_number   = COALESCE($5,  roll_number),
          email         = COALESCE($6,  email),
          father_name   = COALESCE($7,  father_name),
          father_phone  = COALESCE($8,  father_phone),
          mother_name   = COALESCE($9,  mother_name),
          mother_phone  = COALESCE($10, mother_phone),
          address       = COALESCE($11, address),
          class_teacher = COALESCE($12, class_teacher),
          profile_status= COALESCE($13, profile_status)
        WHERE id = $14
      `, [first_name||null, last_name||null, cls||null,
          section!==undefined?section:null,
          roll_number!==undefined?roll_number:null,
          email!==undefined?email:null,
          father_name!==undefined?father_name:null,
          father_phone!==undefined?father_phone:null,
          mother_name!==undefined?mother_name:null,
          mother_phone!==undefined?mother_phone:null,
          address!==undefined?address:null,
          class_teacher!==undefined?class_teacher:null,
          profile_status||null, id]);

      const updated = (await db.query('SELECT * FROM students WHERE id = $1', [id])).rows[0];
      return res.json(updated);
    }

    if (role === 'STUDENT' && linked_id === student.id) {
      const { father_name, father_phone, mother_name, mother_phone, address } = req.body;
      await db.query(`
        UPDATE students SET
          pending_father_name  = $1,
          pending_father_phone = $2,
          pending_mother_name  = $3,
          pending_mother_phone = $4,
          pending_address      = $5,
          profile_status       = 'PENDING'
        WHERE id = $6
      `, [father_name!==undefined?father_name:null,
          father_phone!==undefined?father_phone:null,
          mother_name!==undefined?mother_name:null,
          mother_phone!==undefined?mother_phone:null,
          address!==undefined?address:null, id]);

      const updated = (await db.query('SELECT * FROM students WHERE id = $1', [id])).rows[0];
      return res.json(updated);
    }

    return res.status(403).json({ error: 'Access denied' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── Safely delete file helper ────────────────────────────────────────────────
const deleteFile = (relativeUrl) => {
  if (!relativeUrl) return;
  const filePath = path.join(__dirname, '..', relativeUrl);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
  }
};

// ─── POST /api/students/:id/approve ──────────────────────────────────────────
router.post('/:id/approve', authenticate, requireRole('OWNER'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT photo_url, pending_photo_url FROM students WHERE id = $1', [id]);
    const student = rows[0];
    if (!student) return res.status(404).json({ error: 'Record not found' });

    // Clean up obsolete approved photo if it's being replaced
    if (student.pending_photo_url && student.pending_photo_url !== student.photo_url) {
      deleteFile(student.photo_url);
    }

    await db.query(`
      UPDATE students SET
        father_name  = COALESCE(pending_father_name,  father_name),
        father_phone = COALESCE(pending_father_phone, father_phone),
        mother_name  = COALESCE(pending_mother_name,  mother_name),
        mother_phone = COALESCE(pending_mother_phone, mother_phone),
        address      = COALESCE(pending_address,      address),
        photo_url    = COALESCE(pending_photo_url,    photo_url),
        profile_status       = 'APPROVED',
        pending_father_name  = NULL,
        pending_father_phone = NULL,
        pending_mother_name  = NULL,
        pending_mother_phone = NULL,
        pending_address      = NULL,
        pending_photo_url    = NULL
      WHERE id = $1
    `, [id]);

    const updated = (await db.query('SELECT * FROM students WHERE id = $1', [id])).rows[0];
    return res.json(updated);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── DELETE /api/students/:id ─────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('OWNER'), async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('SELECT photo_url, pending_photo_url FROM students WHERE id = $1', [id]);
    const student = rows[0];
    if (!student) return res.status(404).json({ error: 'Record not found' });

    // Delete photo files from disk
    deleteFile(student.photo_url);
    deleteFile(student.pending_photo_url);

    await db.query('DELETE FROM students WHERE id = $1', [id]);
    await db.query("DELETE FROM users WHERE linked_id = $1 AND role IN ('STUDENT','PARENT')", [id]);
    return res.json({ message: 'Student deleted successfully' });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

// ─── POST /api/students/:id/photo ─────────────────────────────────────────────
router.post('/:id/photo', authenticate, uploadPhoto.single('photo'), async (req, res) => {
  const { id } = req.params;
  const { role, linked_id } = req.user;
  try {
    const { rows } = await db.query('SELECT id, photo_url, pending_photo_url FROM students WHERE id = $1', [id]);
    const student = rows[0];
    if (!student) return res.status(404).json({ error: 'Record not found' });

    if (role !== 'OWNER' && !(role === 'STUDENT' && linked_id === student.id))
      return res.status(403).json({ error: 'Access denied' });
    if (!req.file)
      return res.status(400).json({ error: 'No photo file uploaded' });

    const photoUrl = `/uploads/photos/${req.file.filename}`;
    if (role === 'OWNER') {
      const oldPhoto = student.photo_url;
      await db.query('UPDATE students SET photo_url = $1 WHERE id = $2', [photoUrl, id]);
      if (oldPhoto && oldPhoto !== photoUrl) {
        deleteFile(oldPhoto);
      }
    } else {
      const oldPending = student.pending_photo_url;
      await db.query("UPDATE students SET pending_photo_url = $1, profile_status = 'PENDING' WHERE id = $2", [photoUrl, id]);
      if (oldPending && oldPending !== photoUrl) {
        deleteFile(oldPending);
      }
    }

    const updated = (await db.query('SELECT * FROM students WHERE id = $1', [id])).rows[0];
    return res.json(updated);
  } catch (err) { return res.status(500).json({ error: err.message }); }
});

module.exports = router;
