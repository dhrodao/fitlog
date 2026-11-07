#!/usr/bin/env node
// Verify that a backup is restorable and internally consistent.
//
// A backup you have never restored is not a backup. This script restores a
// backup file to a temporary location, runs PRAGMA integrity_check and
// foreign_key_check, and reports row counts for the key tables so a human (or
// a cron log) can sanity-check that the data is actually there.
//
// Usage:
//   node scripts/verify-backup.js <backup-file>
//   node scripts/verify-backup.js            # verifies the newest backup
//
// Env:
//   BACKUP_DIR   Directory to search when no file is given. Default <root>/backups.
//
// Exit code is non-zero if the backup is missing, corrupt or unreadable.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const KEY_TABLES = [
  'users',
  'exercises',
  'routines',
  'workouts',
  'workout_exercises',
  'workout_sets',
  'measurements',
];

export function newestBackup(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^fitness-.*\.db$/.test(f))
    .sort((a, b) => b.localeCompare(a));
  return files.length ? path.join(dir, files[0]) : null;
}

/**
 * Restore a backup to a temp path and validate it.
 * @param {string} backupFile
 * @returns {{restoredPath: string, counts: Record<string, number>}}
 * @throws if the backup is missing, corrupt, or violates foreign keys
 */
export function verifyBackup(backupFile) {
  if (!backupFile || !fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  // "Restore" = copy to a throwaway path and open it there, proving the file is
  // a usable standalone database (not dependent on WAL/SHM siblings).
  const restoredPath = path.join(
    os.tmpdir(),
    `fitlog-restore-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`
  );
  fs.copyFileSync(backupFile, restoredPath);

  const db = new Database(restoredPath, { readonly: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new Error(`integrity_check failed: ${integrity}`);
    }
    const fkViolations = db.pragma('foreign_key_check');
    if (Array.isArray(fkViolations) && fkViolations.length > 0) {
      throw new Error(`foreign_key_check found ${fkViolations.length} violation(s)`);
    }

    const counts = {};
    for (const table of KEY_TABLES) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
        counts[table] = row.c;
      } catch {
        counts[table] = -1; // table absent (older schema); flag but don't fail
      }
    }
    return { restoredPath, counts };
  } finally {
    db.close();
  }
}

function main() {
  const arg = process.argv[2];
  const backupDir = process.env.BACKUP_DIR || path.join(root, 'backups');
  const backupFile = arg || newestBackup(backupDir);

  if (!backupFile) {
    console.error(`[verify] no backup found in ${backupDir}`);
    process.exit(1);
  }

  let result;
  try {
    result = verifyBackup(backupFile);
  } catch (error) {
    console.error(`[verify] FAILED for ${backupFile}: ${error.message}`);
    process.exit(1);
  }

  console.log(`[verify] OK: ${backupFile}`);
  console.log('[verify] row counts:');
  for (const [table, count] of Object.entries(result.counts)) {
    console.log(`  ${table.padEnd(20)} ${count < 0 ? '(table absent)' : count}`);
  }
  // Clean up the temporary restored copy.
  try {
    fs.unlinkSync(result.restoredPath);
  } catch {
    // ignore
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
