import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const catalogColumns = `
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  muscles TEXT,
  primary_muscles TEXT,
  secondary_muscles TEXT,
  equipment TEXT,
  instructions TEXT,
  level TEXT,
  force TEXT,
  mechanic TEXT,
  image_url TEXT,
  image_url_2 TEXT,
  thumbnail_url TEXT,
  description TEXT,
  updated_at TEXT NOT NULL
`;

const exerciseColumns = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id TEXT REFERENCES exercise_catalog(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT,
  image_url TEXT,
  is_custom INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name)
`;

const schema = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT NOT NULL,
  picture TEXT,
  is_dev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS exercise_catalog (${catalogColumns});
CREATE INDEX IF NOT EXISTS idx_catalog_name ON exercise_catalog(name);
CREATE INDEX IF NOT EXISTS idx_catalog_category ON exercise_catalog(category);

CREATE TABLE IF NOT EXISTS exercises (${exerciseColumns});
CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises(user_id);

CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  folder TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routines_user ON routines(user_id);

CREATE TABLE IF NOT EXISTS routine_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  target_sets INTEGER NOT NULL DEFAULT 3,
  target_reps TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine ON routine_exercises(routine_id, position);

CREATE TABLE IF NOT EXISTS workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  routine_id INTEGER REFERENCES routines(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  location TEXT,
  notes TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_seconds INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_routine ON workouts(routine_id);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_we_workout ON workout_exercises(workout_id, position);

CREATE TABLE IF NOT EXISTS workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL,
  weight_kg REAL,
  reps INTEGER,
  completed INTEGER NOT NULL DEFAULT 0,
  rest_seconds INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sets_we ON workout_sets(workout_exercise_id, set_number);

CREATE TABLE IF NOT EXISTS measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  weight_kg REAL,
  body_fat REAL,
  waist_cm REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_measurements_user ON measurements(user_id, date);
`;

db.exec(schema);

function isLegacyCatalog() {
  const columns = db.prepare('PRAGMA table_info(exercise_catalog)').all();
  return columns.some((entry) => entry.name === 'wger_id');
}

function migrateLegacyCatalog() {
  if (!isLegacyCatalog()) return false;

  // The old catalog and its user links point to wger ids, so they cannot be
  // reused. User exercises are preserved by id; any old catalog_id becomes
  // NULL and is relinked by name during the next catalog sync.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`CREATE TABLE exercise_catalog_new (${catalogColumns})`);
      db.exec('DROP TABLE exercise_catalog');
      db.exec('ALTER TABLE exercise_catalog_new RENAME TO exercise_catalog');

      db.exec(`CREATE TABLE exercises_new (${exerciseColumns})`);
      db.exec(
        `INSERT INTO exercises_new
           (id, user_id, catalog_id, name, category, image_url, is_custom, created_at)
         SELECT id, user_id, NULL, name, category, image_url, is_custom, created_at
         FROM exercises`
      );
      db.exec('DROP TABLE exercises');
      db.exec('ALTER TABLE exercises_new RENAME TO exercises');

      db.prepare(
        `DELETE FROM meta
         WHERE key IN (
           'wger_last_sync', 'wger_count',
           'free_images_last_sync', 'free_images_count'
         )`
      ).run();
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const violations = db.pragma('foreign_key_check');
  if (violations.length > 0) {
    throw new Error(
      `La migración del catálogo dejó ${violations.length} referencias rotas`
    );
  }

  return true;
}

if (migrateLegacyCatalog()) {
  db.exec(schema);
}

export const nowIso = () => new Date().toISOString();

export function getMeta(key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setMeta(key, value) {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

export default db;
