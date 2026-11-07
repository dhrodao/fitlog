// Backup and restore tests.
//
// Prove that a backup taken while the database is being written is consistent
// and restorable, and that the retention policy keeps the right files.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { createBackup, applyRetention } from '../scripts/backup-db.js';
import { verifyBackup } from '../scripts/verify-backup.js';

function tmpDir(label) {
  const dir = path.join(
    os.tmpdir(),
    `fitlog-${label}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function seedDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE workouts (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL
    );
  `);
  const insertUser = db.prepare('INSERT INTO users (id, name) VALUES (?, ?)');
  insertUser.run(1, 'A');
  insertUser.run(2, 'B');
  db.prepare('INSERT INTO workouts (id, user_id, name) VALUES (?, ?, ?)').run(1, 1, 'W1');
  return db;
}

test('backup and restore', async (t) => {
  await t.test('backup taken during a write is consistent and restorable', async () => {
    const dataDir = tmpDir('data');
    const outDir = tmpDir('backups');
    const dbPath = path.join(dataDir, 'fitness.db');
    const db = seedDb(dbPath);

    // Simulate an in-progress write: insert without closing, so the WAL holds
    // uncommitted/committed-but-unmerged pages when we back up.
    db.prepare('INSERT INTO workouts (id, user_id, name) VALUES (?, ?, ?)').run(2, 2, 'W2');

    const dest = await createBackup(dbPath, outDir);
    db.close();

    assert.ok(fs.existsSync(dest), 'backup file exists');

    const { counts } = verifyBackup(dest);
    assert.equal(counts.users, 2, 'both users present in the backup');
    assert.equal(counts.workouts, 2, 'both workouts present (write was captured)');

    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  await t.test('a corrupt backup is rejected by verify', async () => {
    const outDir = tmpDir('corrupt');
    const bad = path.join(outDir, 'fitness-2026-01-01T00-00-00Z.db');
    fs.writeFileSync(bad, 'this is not a sqlite database');

    assert.throws(() => verifyBackup(bad), /integrity|not a database|file is not/i);

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  await t.test('retention keeps the newest daily backups', () => {
    const outDir = tmpDir('retain');
    // 10 backups on consecutive days.
    const names = [];
    for (let d = 1; d <= 10; d += 1) {
      const name = `fitness-2026-03-${String(d).padStart(2, '0')}T08-00-00Z.db`;
      fs.writeFileSync(path.join(outDir, name), 'x');
      names.push(name);
    }

    const { kept, deleted } = applyRetention(outDir, { keepDaily: 3, keepWeekly: 0 });

    // The 3 newest (days 10, 09, 08) must be kept.
    assert.ok(kept.includes('fitness-2026-03-10T08-00-00Z.db'));
    assert.ok(kept.includes('fitness-2026-03-08T08-00-00Z.db'));
    assert.ok(deleted.includes('fitness-2026-03-01T08-00-00Z.db'));
    assert.equal(kept.length + deleted.length, names.length, 'every file accounted for');

    // And the kept set actually survives on disk.
    const onDisk = fs.readdirSync(outDir).filter((f) => f.endsWith('.db'));
    assert.equal(onDisk.length, kept.length);

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  await t.test('retention keeps one backup per recent week', () => {
    const outDir = tmpDir('retain-weekly');
    // Backups across 4 different ISO weeks (March 2026: 2,9,16,23 are Mondays).
    for (const day of ['02', '09', '16', '23']) {
      const name = `fitness-2026-03-${day}T08-00-00Z.db`;
      fs.writeFileSync(path.join(outDir, name), 'x');
    }

    const { kept } = applyRetention(outDir, { keepDaily: 1, keepWeekly: 4 });

    // keepDaily=1 keeps the newest; weekly keeps one per week for 4 weeks.
    assert.ok(kept.length >= 4, 'at least one backup per week is retained');

    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
