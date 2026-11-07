-- Baseline schema. All statements use IF NOT EXISTS so this migration is a
-- no-op on databases that already contain the schema (created by the previous
-- bootstrap), and creates everything on a fresh database. It records the
-- current schema as version 1.

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

CREATE TABLE IF NOT EXISTS exercise_catalog (
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
);
CREATE INDEX IF NOT EXISTS idx_catalog_name ON exercise_catalog(name);
CREATE INDEX IF NOT EXISTS idx_catalog_category ON exercise_catalog(category);

CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id TEXT REFERENCES exercise_catalog(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT,
  image_url TEXT,
  is_custom INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_exercises_user ON exercises(user_id);

CREATE TABLE IF NOT EXISTS routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  folder TEXT,
  source TEXT,
  hevy_routine_id TEXT,
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
  source TEXT,
  hevy_workout_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_workouts_routine ON workouts(routine_id);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  superset_group INTEGER
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

CREATE TABLE IF NOT EXISTS hevy_sync (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  api_key TEXT NOT NULL,
  auto_sync INTEGER NOT NULL DEFAULT 1,
  last_sync_at TEXT,
  last_cursor TEXT,
  last_status TEXT,
  last_error TEXT,
  last_warning TEXT,
  webhook_token TEXT,
  webhook_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hevy_templates (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL,
  title TEXT,
  type TEXT,
  primary_muscle TEXT,
  secondary_muscles TEXT,
  equipment TEXT,
  thumbnail_url TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_hevy_templates_user ON hevy_templates(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hevy_webhook_token
  ON hevy_sync(webhook_token) WHERE webhook_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_routines_hevy
  ON routines(user_id, hevy_routine_id) WHERE hevy_routine_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_hevy
  ON workouts(user_id, hevy_workout_id) WHERE hevy_workout_id IS NOT NULL;
