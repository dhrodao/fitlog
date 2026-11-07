#!/usr/bin/env node
// Online, WAL-safe backup of the SQLite database.
//
// Uses better-sqlite3's `.backup()` API, which performs a consistent online
// backup even while the app is writing (it checkpoints and copies pages via
// SQLite's backup API). A raw `cp` of the .db file in WAL mode is NOT safe;
// this is.
//
// The backup is written to a timestamped file in a directory OUTSIDE the
// database's own directory (so it is not part of the live data dir), with a
// retention policy that keeps a configurable number of daily and weekly copies.
//
// Usage:
//   node scripts/backup-db.js [--out <dir>] [--keep-daily N] [--keep-weekly N]
//
// Env:
//   DB_PATH        Source database (same resolution as the app). Default
//                  <root>/data/fitness.db.
//   BACKUP_DIR     Destination directory. Default <root>/backups.
//   BACKUP_KEEP_DAILY   Daily copies to retain (default 7).
//   BACKUP_KEEP_WEEKLY  Weekly copies to retain (default 4).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { out: null, keepDaily: null, keepWeekly: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--keep-daily') args.keepDaily = Number(argv[++i]);
    else if (a === '--keep-weekly') args.keepWeekly = Number(argv[++i]);
  }
  return args;
}

export function resolveDbPath(value) {
  if (!value) return path.join(root, 'data', 'fitness.db');
  return path.isAbsolute(value) ? value : path.join(root, value);
}

// A filename-safe UTC timestamp: 2026-11-07T08-24-57Z
function timestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
}

/**
 * Create one consistent backup of `dbPath` into `outDir`.
 * @returns {Promise<string>} the backup file path
 */
export async function createBackup(dbPath, outDir) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Source database not found: ${dbPath}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `fitness-${timestamp()}.db`);

  const source = new Database(dbPath, { readonly: true });
  try {
    // better-sqlite3 returns a promise that resolves when the backup finishes.
    await source.backup(dest);
  } finally {
    source.close();
  }

  // Sanity check: the backup must open and pass an integrity check.
  const check = new Database(dest, { readonly: true });
  try {
    const result = check.pragma('integrity_check', { simple: true });
    if (result !== 'ok') {
      throw new Error(`Backup failed integrity_check: ${result}`);
    }
  } finally {
    check.close();
  }
  return dest;
}

/**
 * Apply a daily+weekly retention policy to the backup directory.
 * Keeps the newest `keepDaily` backups, plus one backup per ISO week for the
 * `keepWeekly` most recent weeks. Everything else is deleted.
 * @returns {{kept: string[], deleted: string[]}}
 */
export function applyRetention(outDir, { keepDaily = 7, keepWeekly = 4 } = {}) {
  const files = fs
    .readdirSync(outDir)
    .filter((f) => /^fitness-.*\.db$/.test(f))
    .map((f) => ({ name: f, full: path.join(outDir, f) }))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first (ISO names)

  const keep = new Set();

  // Keep the newest `keepDaily`.
  for (const f of files.slice(0, keepDaily)) keep.add(f.name);

  // Keep the newest backup for each of the last `keepWeekly` ISO weeks.
  const seenWeeks = new Set();
  for (const f of files) {
    const week = isoWeekKey(f.name);
    if (week && !seenWeeks.has(week)) {
      seenWeeks.add(week);
      if (seenWeeks.size <= keepWeekly) keep.add(f.name);
    }
  }

  const kept = [];
  const deleted = [];
  for (const f of files) {
    if (keep.has(f.name)) {
      kept.push(f.name);
    } else {
      fs.unlinkSync(f.full);
      deleted.push(f.name);
    }
  }
  return { kept, deleted };
}

// Derive "YYYY-Www" from a backup filename's embedded timestamp.
function isoWeekKey(name) {
  const m = name.match(/^fitness-(\d{4})-(\d{2})-(\d{2})T/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  // ISO week number.
  const day = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - day + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
    );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(process.env.DB_PATH);
  const outDir = args.out || process.env.BACKUP_DIR || path.join(root, 'backups');
  const keepDaily = args.keepDaily ?? Number(process.env.BACKUP_KEEP_DAILY || 7);
  const keepWeekly = args.keepWeekly ?? Number(process.env.BACKUP_KEEP_WEEKLY || 4);

  const dest = await createBackup(dbPath, outDir);
  const { kept, deleted } = applyRetention(outDir, { keepDaily, keepWeekly });

  console.log(`[backup] created ${dest}`);
  console.log(`[backup] retention: kept ${kept.length}, deleted ${deleted.length}`);
  if (deleted.length) console.log(`[backup] deleted: ${deleted.join(', ')}`);
}

// Run only when invoked directly, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[backup] FAILED: ${error.message}`);
    process.exit(1);
  });
}
