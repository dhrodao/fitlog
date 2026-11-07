// Health probe that reflects real database availability, not just "the Node
// process is up". The Docker/Compose healthcheck and the deploy health probe
// both read the HTTP status, so returning 503 here makes a broken database
// fail the deploy gate and mark the container unhealthy.
//
// The probe is deliberately READ-ONLY and cheap: a write-on-health-check would
// add load and could itself wedge under contention. We:
//   1. run `SELECT 1` (connection + basic query work),
//   2. compare the applied schema version against the latest migration on disk
//      (so a container running older/newer code than the DB is visible),
//   3. confirm the DB file is writable via a filesystem check (no DB write).

import fs from 'node:fs';
import { db } from './db.js';
import config from './config.js';
import { listMigrations } from './migrations.js';

function appliedSchemaVersion() {
  // schema_migrations is created by the migration runner on boot.
  const row = db
    .prepare('SELECT MAX(version) AS v FROM schema_migrations')
    .get();
  return row?.v ?? 0;
}

function expectedSchemaVersion() {
  const migrations = listMigrations();
  return migrations.length ? migrations[migrations.length - 1].version : 0;
}

/**
 * Run the health checks. Never throws; returns a plain result object.
 * @returns {{ok:boolean, time:string, checks:Record<string,{ok:boolean, detail?:string}>, schema?:{applied:number, expected:number}}}
 */
export function checkHealth() {
  const checks = {};
  let schema;

  // 1. Database query.
  try {
    const row = db.prepare('SELECT 1 AS ok').get();
    checks.db = { ok: row?.ok === 1 };
  } catch (err) {
    checks.db = { ok: false, detail: err.message };
  }

  // 2. Schema version matches the code's migrations.
  try {
    const applied = appliedSchemaVersion();
    const expected = expectedSchemaVersion();
    schema = { applied, expected };
    checks.schema = {
      ok: applied === expected,
      detail:
        applied === expected ? undefined : `applied ${applied}, expected ${expected}`,
    };
  } catch (err) {
    checks.schema = { ok: false, detail: err.message };
  }

  // 3. Database file is writable (filesystem-level, no DB write).
  try {
    fs.accessSync(config.dbPath, fs.constants.W_OK);
    checks.writable = { ok: true };
  } catch (err) {
    checks.writable = { ok: false, detail: err.message };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  return { ok, time: new Date().toISOString(), schema, checks };
}

export default checkHealth;
