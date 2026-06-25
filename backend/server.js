const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

// ─── Initialize DB (runs schema + seed) ──────────────────────────────────────
const db = require('./db');

// ─── Route Imports ────────────────────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const studentsRoutes   = require('./routes/students');
const teachersRoutes   = require('./routes/teachers');
const marksRoutes      = require('./routes/marks');
const attendanceRoutes = require('./routes/attendance');
const timetableRoutes  = require('./routes/timetable');
const notesRoutes      = require('./routes/notes');
const leavesRoutes     = require('./routes/leaves');
const ownerRoutes      = require('./routes/owner');
const classesRoutes    = require('./routes/classes');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Ensure upload directories exist ─────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
const photosDir  = path.join(uploadsDir, 'photos');
const notesDir   = path.join(uploadsDir, 'notes');
[uploadsDir, photosDir, notesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3001', 'http://127.0.0.1:3001'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

// ─── Core Middleware ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Prevent caching for all API routes
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// ─── Static Files ─────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./middleware/auth');

// Simple cookie parser helper
const parseCookies = (req) => {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach((cookie) => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
};

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// On Render, frontend files are served from the same repo root
const frontendDir = path.join(__dirname, '..');

// HTML Page Route Authorization Middleware
app.use((req, res, next) => {
  const filePath = req.path;
  const isHtml = filePath.endsWith('.html') || filePath === '/';
  if (!isHtml) {
    return next();
  }

  const normalizedPath = filePath.replace(/^\//, '').toLowerCase();

  // Public pages
  if (normalizedPath === '' || normalizedPath === 'index.html' || normalizedPath.includes('login_page')) {
    return next();
  }

  let requiredRole = null;
  if (normalizedPath.includes('owner_page')) {
    requiredRole = 'OWNER';
  } else if (normalizedPath.includes('teacher_page')) {
    requiredRole = 'TEACHER';
  } else if (normalizedPath.includes('student_page')) {
    requiredRole = 'STUDENT';
  } else if (normalizedPath.includes('parent_page')) {
    requiredRole = 'PARENT';
  } else {
    return next();
  }

  const cookies = parseCookies(req);
  const token = cookies.token;

  if (!token) {
    return res.redirect('/login_page.html');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role === requiredRole) {
      let targetFile = '';
      if (requiredRole === 'OWNER') targetFile = '5owner_page.html';
      else if (requiredRole === 'TEACHER') targetFile = '4teacher_page.html';
      else if (requiredRole === 'PARENT') targetFile = '3parent_page.html';
      else if (requiredRole === 'STUDENT') targetFile = '2student_page.html';
      
      return res.sendFile(path.join(frontendDir, targetFile));
    } else {
      return res.redirect('/login_page.html');
    }
  } catch (err) {
    return res.redirect('/login_page.html');
  }
});

app.get('/login_page.html',   (req, res) => res.sendFile(path.join(frontendDir, '1login_page.html')));
app.get('/student_page.html', (req, res) => res.sendFile(path.join(frontendDir, '2student_page.html')));
app.get('/parent_page.html',  (req, res) => res.sendFile(path.join(frontendDir, '3parent_page.html')));
app.get('/teacher_page.html', (req, res) => res.sendFile(path.join(frontendDir, '4teacher_page.html')));
app.get('/owner_page.html',   (req, res) => res.sendFile(path.join(frontendDir, '5owner_page.html')));

app.use(express.static(frontendDir));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth',       authRoutes);
app.use('/api/students',   studentsRoutes);
app.use('/api/teachers',   teachersRoutes);
app.use('/api/marks',      marksRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/timetable',  timetableRoutes);
app.use('/api/notes',      notesRoutes);
app.use('/api/leaves',     leavesRoutes);
app.use('/api/owner',      ownerRoutes);
app.use('/api/classes',    classesRoutes);

// ─── Serve Homepage ───────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  }
  next();
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }

  if (err.message && err.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: 'A record with this value already exists' });
  }

  return res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏫 School Management System Backend`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  if (!process.env.TURSO_DATABASE_URL) {
    console.warn('⚠️  TURSO_DATABASE_URL is not set — database will not work!');
  }
  if (!process.env.TURSO_AUTH_TOKEN) {
    console.warn('⚠️  TURSO_AUTH_TOKEN is not set — database will not work!');
  }
});

module.exports = app;