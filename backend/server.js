// ─── Load environment variables from .env (must be first) ───────────────────
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

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
const { loginRateLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Ensure upload directories exist ─────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
const photosDir  = path.join(uploadsDir, 'photos');
const notesDir   = path.join(uploadsDir, 'notes');
[uploadsDir, photosDir, notesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── Core Middleware ──────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.ALLOWED_ORIGINS) {
  console.error('❌ FATAL: ALLOWED_ORIGINS env variable is not set in production.');
  console.error('   Set it to your Render app URL, e.g.: https://your-app.onrender.com');
  process.exit(1);
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://127.0.0.1:3001'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// ─── Static Files ─────────────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const frontendDir = path.join(__dirname, '..');
app.get('/login_page.html',   (req, res) => res.sendFile(path.join(frontendDir, '1login_page.html')));
app.get('/student_page.html', (req, res) => res.sendFile(path.join(frontendDir, '2student_page.html')));
app.get('/parent_page.html',  (req, res) => res.sendFile(path.join(frontendDir, '3parent_page.html')));
app.get('/teacher_page.html', (req, res) => res.sendFile(path.join(frontendDir, '4teacher_page.html')));
app.get('/owner_page.html',   (req, res) => res.sendFile(path.join(frontendDir, '5owner_page.html')));

app.use(express.static(frontendDir));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth/login', loginRateLimiter());
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

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
  }
  next();
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  }

  // PostgreSQL unique violation error code is 23505
  if (err.code === '23505' || (err.message && err.message.includes('UNIQUE constraint failed'))) {
    return res.status(409).json({ error: 'A record with this value already exists' });
  }

  return res.status(500).json({ error: err.message || 'Internal server error' });
});

// Initialize database and then start the server
db.initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🏫 School Management System Backend`);
      console.log(`🚀 Server running at http://localhost:${PORT}`);
      console.log(`🔐 Login page: http://localhost:${PORT}/login_page.html`);
      console.log(`\nDefault credentials:`);
      console.log(`  Manager  → manager / manager1234`);
      console.log(`  Students → student_<id>@school.com / student123`);
      console.log(`  Parents  → parent_<id>@school.com  / parent123`);
      console.log(`  Teachers → teacher_<id>@school.com / teacher123`);
    });
  })
  .catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });

module.exports = app;
