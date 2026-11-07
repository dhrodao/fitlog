import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Versioned, transactional schema migrations.
//
// Each migration is a file server/migrations/NNN_description.sql. They are
// applied in ascending NNN order, each inside its own transaction, and the
// applied version + a checksum of the file are recorded in schema_migrations.
//
// Guarantees:
//   - a fresh database and an existing one both converge to the same schema
//     (baseline uses IF NOT EXISTS; later migrations are additive/repairing);
//   - re-running is a no-op (already-applied versions are skipped);
//   - a failed migration rolls back its transaction, leaving the DB usable at
//     the previous version;
//   - editing an already-applied migration is detected via checksum mismatch.

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Parse "003_add_thing.sql" -> { version: 3, name: 'add_thing' }. */
function parseName(file) {
  const m = /^(\d+)_(.+)\.sql$/.exec(file);
  if (!m) return null;
  return { version: Number(m[1]), name: m[2], file };
}

/** List migration files in ascending version order. */
export function listMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map(parseName)
    .filter(Boolean)
    .sort((a, b) => a.version - b.version);
}

/**
 * Apply all pending migrations against an open better-sqlite3 database.
 * @param {import('better-sqlite3').Database} db
 * @param {{dir?:string, log?:(msg:string)=>void}} [opts]
 * @returns {{applied:number[], current:number}}
 */
export function runMigrations(db, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       checksum TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`
  );

  const appliedRows = db
    .prepare('SELECT version, checksum FROM schema_migrations')
    .all();
  const appliedByVersion = new Map(appliedRows.map((r) => [r.version, r.checksum]));

  const migrations = listMigrations(dir);
  const applied = [];

  for (const { version, name, file } of migrations) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const checksum = sha256(sql);

    if (appliedByVersion.has(version)) {
      // Already applied: verify it was not edited after the fact.
      if (appliedByVersion.get(version) !== checksum) {
        throw new Error(
          `La migración ${file} cambió después de aplicarse ` +
            '(checksum distinto). No se modifican migraciones ya aplicadas.'
        );
      }
      continue;
    }

    // Each migration runs in its own transaction: on error it rolls back and
    // the database stays at the previous version.
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        `INSERT INTO schema_migrations (version, name, checksum, applied_at)
         VALUES (?, ?, ?, ?)`
      ).run(version, name, checksum, new Date().toISOString());
    });
    apply();
    applied.push(version);
    log(`[migrate] applied ${file}`);
  }

  const current = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    .get().v;

  return { applied, current };
}
