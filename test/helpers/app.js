// Test harness for FitLog.
//
// Why this shape: server/config.js reads process.env at module load, and
// server/db.js opens a single module-level SQLite database at the DB_PATH that
// is set when it is first imported. So tests MUST set the environment BEFORE
// importing server/app.js. `node --test` runs each test file in its own
// process, so one isolated database per file is both safe and sufficient.
//
// Usage (at the very top of a test file, before any server import):
//
//   import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
//   setupTestEnv();
//   const { app, db, agent } = await createTestApp();
//   test.after(() => cleanupTestApp(db));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';

let dbPath = null;

/**
 * Set the environment required to run the server against a throwaway database.
 * Must be called before createTestApp()/any server import.
 * @param {Record<string,string>} [overrides] Extra env vars to set.
 * @returns {string} The temporary database path.
 */
export function setupTestEnv(overrides = {}) {
  // A unique file per call avoids collisions if several helpers run in one proc.
  const unique = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  dbPath = path.join(os.tmpdir(), `fitlog-test-${unique}.db`);

  const env = {
    DB_PATH: dbPath,
    NODE_ENV: 'test',
    COOKIE_SECURE: 'false',
    ALLOW_DEV_LOGIN: 'true',
    GOOGLE_CLIENT_ID: '',
    SESSION_SECRET: 'test-session-secret-not-for-production',
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }
  return dbPath;
}

/**
 * Build the Express app against the test database and return handy references.
 * Imports server modules dynamically so env is already in place.
 * @returns {Promise<{app: import('express').Express, db: any, agent: import('supertest').SuperAgentTest, createApp: Function}>}
 */
export async function createTestApp() {
  if (!dbPath) setupTestEnv();
  const { createApp } = await import('../../server/app.js');
  const { db } = await import('../../server/db.js');
  const app = createApp();
  return { app, db, createApp, agent: request.agent(app) };
}

/** A fresh, independent cookie-jar agent for the same app (e.g. a second user). */
export function newAgent(app) {
  return request.agent(app);
}

/**
 * Close the database and delete the temporary files (including WAL/SHM).
 * @param {any} db The better-sqlite3 handle returned by createTestApp().
 */
export function cleanupTestApp(db) {
  try {
    db?.close();
  } catch {
    // ignore: already closed
  }
  if (!dbPath) return;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // ignore: file may not exist
    }
  }
}
