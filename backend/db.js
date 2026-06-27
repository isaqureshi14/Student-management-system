const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'school.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('STUDENT','TEACHER','PARENT','OWNER')),
    linked_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    section TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    class TEXT NOT NULL,
    section TEXT,
    roll_number TEXT,
    email TEXT,
    father_name TEXT,
    father_phone TEXT,
    mother_name TEXT,
    mother_phone TEXT,
    address TEXT,
    photo_url TEXT,
    class_teacher TEXT,
    profile_status TEXT DEFAULT 'PENDING' CHECK(profile_status IN ('PENDING','APPROVED')),
    pending_father_name TEXT,
    pending_father_phone TEXT,
    pending_mother_name TEXT,
    pending_mother_phone TEXT,
    pending_address TEXT,
    pending_photo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teachers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    photo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    exam_name TEXT NOT NULL,
    subject TEXT NOT NULL,
    score REAL NOT NULL DEFAULT 0,
    max_score REAL NOT NULL DEFAULT 100,
    remarks TEXT,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','LATE')),
    marked_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, subject, date)
  );

  CREATE TABLE IF NOT EXISTS timetable (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    class TEXT NOT NULL,
    day TEXT NOT NULL CHECK(day IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
    period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 8),
    subject TEXT NOT NULL,
    teacher_name TEXT,
    start_time TEXT,
    end_time TEXT,
    created_by INTEGER REFERENCES users(id),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(class, day, period)
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    file_url TEXT,
    file_name TEXT,
    subject TEXT NOT NULL,
    class TEXT NOT NULL,
    uploaded_by INTEGER REFERENCES users(id),
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    parent_user_id INTEGER REFERENCES users(id),
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
    owner_note TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME
  );
`);

// ─── Migrations ───────────────────────────────────────────────────────────────
const studentCols = db.prepare('PRAGMA table_info(students)').all().map(c => c.name);
if (!studentCols.includes('email')) {
  db.exec('ALTER TABLE students ADD COLUMN email TEXT');
}
if (!studentCols.includes('pending_father_name')) {
  db.exec('ALTER TABLE students ADD COLUMN pending_father_name TEXT');
  db.exec('ALTER TABLE students ADD COLUMN pending_father_phone TEXT');
  db.exec('ALTER TABLE students ADD COLUMN pending_mother_name TEXT');
  db.exec('ALTER TABLE students ADD COLUMN pending_mother_phone TEXT');
  db.exec('ALTER TABLE students ADD COLUMN pending_address TEXT');
  db.exec('ALTER TABLE students ADD COLUMN pending_photo_url TEXT');
}

// Migrate old marks table if it has exam_type constraint
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      exam_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 100,
      remarks TEXT,
      uploaded_by INTEGER REFERENCES users(id),
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const oldCols = db.prepare('PRAGMA table_info(marks)').all().map(c => c.name);
  if (oldCols.includes('exam_type') && !oldCols.includes('exam_name')) {
    db.exec(`INSERT INTO marks_new (id,student_id,exam_name,subject,score,max_score,remarks,uploaded_by,uploaded_at)
             SELECT id,student_id,exam_type,subject,score,max_score,remarks,uploaded_by,uploaded_at FROM marks`);
    db.exec('DROP TABLE marks');
    db.exec('ALTER TABLE marks_new RENAME TO marks');
    console.log('✅ Migrated marks table: exam_type → exam_name (no constraint)');
  } else {
    db.exec('DROP TABLE IF EXISTS marks_new');
  }
} catch(e) { /* already migrated */ }

// Migrate timetable: drop teacher_id FK, add teacher_name text
try {
  const ttCols = db.prepare('PRAGMA table_info(timetable)').all().map(c => c.name);
  if (ttCols.includes('teacher_id') && !ttCols.includes('teacher_name')) {
    db.exec(`
      CREATE TABLE timetable_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class TEXT NOT NULL,
        day TEXT NOT NULL,
        period INTEGER NOT NULL,
        subject TEXT NOT NULL,
        teacher_name TEXT,
        start_time TEXT,
        end_time TEXT,
        created_by INTEGER REFERENCES users(id),
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(class, day, period)
      );
      INSERT INTO timetable_new (id,class,day,period,subject,start_time,end_time,created_by,updated_at)
        SELECT id,class,day,period,subject,start_time,end_time,created_by,updated_at FROM timetable;
      DROP TABLE timetable;
    `);
    db.exec('ALTER TABLE timetable_new RENAME TO timetable');
    console.log('✅ Migrated timetable: teacher_id → teacher_name');
  }
  // Also widen period constraint if needed
} catch(e) { /* already migrated */ }

// Remove teacher classes column (no longer used)
try {
  const tCols = db.prepare('PRAGMA table_info(teachers)').all().map(c => c.name);
  if (tCols.includes('classes')) {
    db.exec(`
      CREATE TABLE teachers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        photo_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO teachers_new SELECT id,first_name,last_name,subject,email,phone,photo_url,created_at FROM teachers;
      DROP TABLE teachers;
    `);
    db.exec('ALTER TABLE teachers_new RENAME TO teachers');
    console.log('✅ Migrated teachers: removed classes column');
  }
} catch(e) { /* already migrated */ }

// Migrate notes: add file_name column
try {
  const noteCols = db.prepare('PRAGMA table_info(notes)').all().map(c => c.name);
  if (!noteCols.includes('file_name')) {
    db.exec('ALTER TABLE notes ADD COLUMN file_name TEXT');
    console.log('✅ Migrated notes: added file_name column');
  }
} catch(e) { /* already migrated */ }

// ─── Password Hashing Utilities ────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;

function hashPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

function verifyPassword(plainPassword, hashedPassword) {
  return bcrypt.compareSync(plainPassword, hashedPassword);
}

function needsRehash(hashedPassword) {
  try {
    const rounds = parseInt(hashedPassword.split('$')[2], 10);
    return isNaN(rounds) || rounds < BCRYPT_ROUNDS;
  } catch {
    return true;
  }
}

// ─── Migrate Weak Password Hashes ───────────────────────────────────────────────
function migrateWeakPasswords() {
  const users = db.prepare('SELECT id, username, password FROM users').all();
  let migrated = 0;
  
  for (const user of users) {
    if (needsRehash(user.password)) {
      console.warn(`User ${user.username} (id: ${user.id}) has weak password hash - will rehash on next login`);
      migrated++;
    }
  }
  
  if (migrated > 0) {
    console.log(`⚠️  Found ${migrated} user(s) with weak password hashes (will auto-rehash on next login)`);
  }
}

// ─── Seed Owner ───────────────────────────────────────────────────────────────
const ownerHash1 = hashPassword('manager1234');
db.prepare(`
  INSERT INTO users (username, password, role) VALUES (?, ?, 'OWNER')
  ON CONFLICT(username) DO UPDATE SET password = excluded.password
`).run('manager', ownerHash1);

const ownerHash2 = hashPassword('owner123');
db.prepare(`
  INSERT INTO users (username, password, role) VALUES (?, ?, 'OWNER')
  ON CONFLICT(username) DO UPDATE SET password = excluded.password
`).run('owner@school.com', ownerHash2);

console.log('✅ Owner ready: manager / manager1234 & owner@school.com / owner123');

migrateWeakPasswords();

// Attach utility properties to db instance for backward-compatible routing imports
db.db = db;
db.hashPassword = hashPassword;
db.verifyPassword = verifyPassword;
db.needsRehash = needsRehash;
db.BCRYPT_ROUNDS = BCRYPT_ROUNDS;

module.exports = db;

