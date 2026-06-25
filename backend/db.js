require('dotenv').config();
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
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
      profile_status TEXT DEFAULT 'PENDING',
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
      student_id INTEGER NOT NULL,
      exam_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      max_score REAL NOT NULL DEFAULT 100,
      remarks TEXT,
      uploaded_by INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      marked_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS timetable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class TEXT NOT NULL,
      day TEXT NOT NULL,
      period INTEGER NOT NULL,
      subject TEXT NOT NULL,
      teacher_name TEXT,
      start_time TEXT,
      end_time TEXT,
      created_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      file_url TEXT,
      file_name TEXT,
      subject TEXT NOT NULL,
      class TEXT NOT NULL,
      uploaded_by INTEGER,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS leave_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      parent_user_id INTEGER,
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT 'PENDING',
      owner_note TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME
    );
  `);

  // Seed owners
  const ownerHash1 = bcrypt.hashSync(process.env.OWNER_PASSWORD_1, 10);
  await db.execute({
    sql: `INSERT INTO users (username, password, role) VALUES (?, ?, 'OWNER')
          ON CONFLICT(username) DO UPDATE SET password = excluded.password`,
    args: [process.env.OWNER_USERNAME_1, ownerHash1]
  });

  const ownerHash2 = bcrypt.hashSync(process.env.OWNER_PASSWORD_2, 10);
  await db.execute({
    sql: `INSERT INTO users (username, password, role) VALUES (?, ?, 'OWNER')
          ON CONFLICT(username) DO UPDATE SET password = excluded.password`,
    args: [process.env.OWNER_USERNAME_2, ownerHash2]
  });

  console.log('✅ Turso DB initialized');
}

initDB().catch(console.error);

module.exports = db;