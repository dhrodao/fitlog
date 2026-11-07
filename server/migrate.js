// Explicit migration entry point: `npm run migrate`.
//
// Importing ./db.js opens the database and runs any pending migrations on load
// (the same path used on server boot), so this command just reports the result
// and exits. Useful to apply migrations in a deploy step before starting the
// app. Back up the database first (npm run backup:db).

import { db } from './db.js';

const rows = db
  .prepare(
    'SELECT version, name, applied_at FROM schema_migrations ORDER BY version'
  )
  .all();

const current = rows.length ? rows[rows.length - 1].version : 0;
console.log(`[migrate] schema version: ${current}`);
for (const r of rows) {
  console.log(`  ${String(r.version).padStart(3, '0')} ${r.name} (${r.applied_at})`);
}

db.close();
