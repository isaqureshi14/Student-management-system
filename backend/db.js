require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// ─── Connection Pool ──────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ─── Password Hashing Utilities ───────────────────────────────────────────────
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

// ─── Schema Initialisation ────────────────────────────────────────────────────
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL PRIMARY KEY,
        username   TEXT UNIQUE NOT NULL,
        password   TEXT NOT NULL,
        role       TEXT NOT NULL CHECK(role IN ('STUDENT','TEACHER','PARENT','OWNER')),
        linked_id  INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS classes (
        id         SERIAL PRIMARY KEY,
        name       TEXT UNIQUE NOT NULL,
        section    TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS students (
        id                   SERIAL PRIMARY KEY,
        first_name           TEXT NOT NULL,
        last_name            TEXT NOT NULL,
        class                TEXT NOT NULL,
        section              TEXT,
        roll_number          TEXT,
        email                TEXT,
        father_name          TEXT,
        father_phone         TEXT,
        mother_name          TEXT,
        mother_phone         TEXT,
        address              TEXT,
        photo_url            TEXT,
        class_teacher        TEXT,
        profile_status       TEXT DEFAULT 'PENDING' CHECK(profile_status IN ('PENDING','APPROVED')),
        pending_father_name  TEXT,
        pending_father_phone TEXT,
        pending_mother_name  TEXT,
        pending_mother_phone TEXT,
        pending_address      TEXT,
        pending_photo_url    TEXT,
        created_at           TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS teachers (
        id         SERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name  TEXT NOT NULL,
        subject    TEXT NOT NULL,
        email      TEXT,
        phone      TEXT,
        photo_url  TEXT,
        subjects   TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS marks (
        id          SERIAL PRIMARY KEY,
        student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        exam_name   TEXT NOT NULL,
        subject     TEXT NOT NULL,
        score       REAL NOT NULL DEFAULT 0,
        max_score   REAL NOT NULL DEFAULT 100,
        remarks     TEXT,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id         SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        subject    TEXT NOT NULL,
        date       TEXT NOT NULL,
        status     TEXT NOT NULL CHECK(status IN ('PRESENT','ABSENT','LATE')),
        marked_by  INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(student_id, subject, date)
      );

      CREATE TABLE IF NOT EXISTS timetable (
        id           SERIAL PRIMARY KEY,
        class        TEXT NOT NULL,
        day          TEXT NOT NULL CHECK(day IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday')),
        period       INTEGER NOT NULL CHECK(period BETWEEN 1 AND 8),
        subject      TEXT NOT NULL,
        teacher_name TEXT,
        start_time   TEXT,
        end_time     TEXT,
        created_by   INTEGER REFERENCES users(id),
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(class, day, period)
      );

      CREATE TABLE IF NOT EXISTS notes (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        content     TEXT,
        file_url    TEXT,
        file_name   TEXT,
        subject     TEXT NOT NULL,
        class       TEXT NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS leave_requests (
        id             SERIAL PRIMARY KEY,
        student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        parent_user_id INTEGER REFERENCES users(id),
        from_date      TEXT NOT NULL,
        to_date        TEXT NOT NULL,
        reason         TEXT NOT NULL,
        status         TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
        owner_note     TEXT,
        submitted_at   TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at    TIMESTAMPTZ
      );
    `);

    // ─── Non-breaking column migrations ──────────────────────────────────────
    // Add subjects[] array column to teachers if it doesn't exist (existing installs)
    await client.query(`
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS subjects TEXT[];
    `);

    // Add holidays table for tracking school holiday dates
    await client.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id         SERIAL PRIMARY KEY,
        date       TEXT NOT NULL UNIQUE,
        label      TEXT NOT NULL DEFAULT 'Holiday',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ─── Seed owner accounts ─────────────────────────────────────────────────
    const ownerHash1 = hashPassword('manager1234');
    await client.query(`
      INSERT INTO users (username, password, role)
      VALUES ($1, $2, 'OWNER')
      ON CONFLICT (username) DO NOTHING
    `, ['manager', ownerHash1]);

    const ownerHash2 = hashPassword('owner123');
    await client.query(`
      INSERT INTO users (username, password, role)
      VALUES ($1, $2, 'OWNER')
      ON CONFLICT (username) DO NOTHING
    `, ['owner@school.com', ownerHash2]);

    await client.query('COMMIT');
    console.log('✅ Database schema ready');
    console.log('✅ Owner ready: manager / manager1234 & owner@school.com / owner123');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Database init failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Attach utilities to pool for convenient imports in routes
pool.hashPassword  = hashPassword;
pool.verifyPassword = verifyPassword;
pool.needsRehash   = needsRehash;
pool.BCRYPT_ROUNDS = BCRYPT_ROUNDS;
pool.initDb        = initDb;

module.exports = pool;
