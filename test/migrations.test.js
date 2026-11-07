// Migration runner tests. These exercise runMigrations against throwaway
// databases and ad-hoc migration dirs (no server import, no app DB).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { runMigrations, listMigrations } from '../server/migrations.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fitlog-mig-'));
}

function writeMigration(dir, file, sql) {
  fs.writeFileSync(path.join(dir, file), sql, 'utf8');
}

test('fresh database applies all migrations in order', () => {
  const db = new Database(':memory:');
  const dir = tmpDir();
  writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
  writeMigration(dir, '002_b.sql', 'CREATE TABLE b (id INTEGER PRIMARY KEY);');

  const res = runMigrations(db, { dir });
  assert.deepEqual(res.applied, [1, 2]);
  assert.equal(res.current, 2);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('a'));
  assert.ok(tables.includes('b'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('re-running is a no-op', () => {
  const db = new Database(':memory:');
  const dir = tmpDir();
  writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');

  const first = runMigrations(db, { dir });
  assert.deepEqual(first.applied, [1]);
  const second = runMigrations(db, { dir });
  assert.deepEqual(second.applied, []);
  assert.equal(second.current, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failing migration rolls back and leaves the DB usable', () => {
  const db = new Database(':memory:');
  const dir = tmpDir();
  writeMigration(dir, '001_ok.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
  // Invalid SQL in 002: should throw and not record version 2.
  writeMigration(dir, '002_bad.sql', 'CREATE TABLE b (id INTEGER PRIMARY KEY); THIS IS NOT SQL;');

  assert.throws(() => runMigrations(db, { dir }));
  // Version 1 applied; version 2 rolled back (table b must not exist).
  const current = db
    .prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations')
    .get().v;
  assert.equal(current, 1);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('a'));
  assert.ok(!tables.includes('b'));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('editing an applied migration is detected via checksum', () => {
  const db = new Database(':memory:');
  const dir = tmpDir();
  writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY);');
  runMigrations(db, { dir });
  // Edit the already-applied file.
  writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id INTEGER PRIMARY KEY, x TEXT);');
  assert.throws(() => runMigrations(db, { dir }), /checksum|cambió/);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('integrity migration repairs duplicate positions and set numbers', () => {
  const db = new Database(':memory:');
  const dir = tmpDir();
  // Minimal schema with duplicate positions/set numbers, then the real repair.
  writeMigration(
    dir,
    '001_base.sql',
    `CREATE TABLE workout_exercises (id INTEGER PRIMARY KEY, workout_id INTEGER, position INTEGER);
     CREATE TABLE workout_sets (id INTEGER PRIMARY KEY, workout_exercise_id INTEGER, set_number INTEGER);
     CREATE TABLE routine_exercises (id INTEGER PRIMARY KEY, routine_id INTEGER, position INTEGER);
     INSERT INTO workout_exercises (id, workout_id, position) VALUES (1,10,0),(2,10,0),(3,10,0);
     INSERT INTO workout_sets (id, workout_exercise_id, set_number) VALUES (1,5,1),(2,5,1),(3,5,2);
     INSERT INTO routine_exercises (id, routine_id, position) VALUES (1,7,0),(2,7,0);`
  );
  // Reuse the real integrity migration SQL.
  const realDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'server', 'migrations');
  const integritySql = fs.readFileSync(path.join(realDir, '002_integrity_indexes.sql'), 'utf8');
  writeMigration(dir, '002_integrity.sql', integritySql);

  runMigrations(db, { dir });

  // workout_exercises positions within workout 10 are now 0,1,2 (unique).
  const positions = db
    .prepare('SELECT position FROM workout_exercises WHERE workout_id = 10 ORDER BY id')
    .all()
    .map((r) => r.position);
  assert.deepEqual([...positions].sort(), [0, 1, 2]);
  // set numbers within workout_exercise 5 are now unique.
  const setNumbers = db
    .prepare('SELECT set_number FROM workout_sets WHERE workout_exercise_id = 5 ORDER BY id')
    .all()
    .map((r) => r.set_number);
  assert.equal(new Set(setNumbers).size, setNumbers.length);
  // A duplicate insert now fails thanks to the unique index.
  assert.throws(() =>
    db.prepare('INSERT INTO workout_exercises (id, workout_id, position) VALUES (99, 10, 0)').run()
  );
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listMigrations sorts by numeric version', () => {
  const dir = tmpDir();
  writeMigration(dir, '010_j.sql', '');
  writeMigration(dir, '002_b.sql', '');
  writeMigration(dir, '001_a.sql', '');
  const versions = listMigrations(dir).map((m) => m.version);
  assert.deepEqual(versions, [1, 2, 10]);
  fs.rmSync(dir, { recursive: true, force: true });
});
