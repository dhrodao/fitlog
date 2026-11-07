// A catalog re-sync must drop the in-memory name→catalog maps used to resolve
// Hevy exercises, so imports after a sync resolve against the fresh catalog
// instead of a stale map that previously only cleared on process restart.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbPath = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'fitlog-catalog-cache-')),
  'fitness.db'
);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.ALLOW_DEV_LOGIN = 'true';
process.env.GOOGLE_CLIENT_ID = '';

const { db } = await import('../server/db.js');
const { syncCatalog } = await import('../server/catalog.js');
const { registerCatalogCache, invalidateCatalogCaches } = await import(
  '../server/catalog-cache-registry.js'
);
const hevyImport = await import('../server/hevy-import.js');

// A minimal free-exercise-db style dataset. The same display name maps to a
// different catalog id across the two syncs.
const datasetV1 = [
  {
    id: 'Bench_Press',
    name: 'Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    instructions: ['Press.'],
    category: 'strength',
    images: [],
  },
];
const datasetV2 = [
  {
    id: 'Bench_Press_V2',
    name: 'Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    instructions: ['Press.'],
    category: 'strength',
    images: [],
  },
];

function createUser() {
  return db
    .prepare(
      `INSERT INTO users (name, created_at) VALUES (?, ?)`
    )
    .run('Tester', new Date().toISOString()).lastInsertRowid;
}

test('registered cache clearers run on a catalog sync', async () => {
  let cleared = 0;
  const unregister = registerCatalogCache(() => {
    cleared += 1;
  });

  await syncCatalog({ force: true, dataset: datasetV1 });
  assert.ok(cleared >= 1, 'the registered clearer was invoked by the sync');

  unregister();
  const before = cleared;
  await syncCatalog({ force: true, dataset: datasetV1 });
  assert.equal(cleared, before, 'an unregistered clearer is no longer called');
});

test('a broken clearer never aborts invalidation', () => {
  const unregister = registerCatalogCache(() => {
    throw new Error('boom');
  });
  let other = 0;
  const unregister2 = registerCatalogCache(() => {
    other += 1;
  });
  assert.doesNotThrow(() => invalidateCatalogCaches());
  assert.equal(other, 1, 'other clearers still run despite one throwing');
  unregister();
  unregister2();
});

test('Hevy resolution sees catalog entries added by a later sync', async () => {
  const userId = createUser();

  // v1 catalog: only Bench Press. Resolving it populates the in-memory
  // name→catalog map inside hevy-import.
  await syncCatalog({ force: true, dataset: datasetV1 });
  const bench = hevyImport.resolveHevyExercise(userId, 'Bench Press');
  assert.ok(bench?.row, 'resolves Bench Press from the v1 catalog');

  // A later sync adds a brand-new exercise that did not exist in v1. With a
  // stale cached map this name would not resolve; invalidation forces a rebuild
  // so the new entry is visible without a process restart.
  const datasetV3 = [
    ...datasetV1,
    {
      id: 'Overhead_Press',
      name: 'Overhead Press',
      primaryMuscles: ['shoulders'],
      secondaryMuscles: [],
      equipment: 'barbell',
      instructions: ['Press overhead.'],
      category: 'strength',
      images: [],
    },
  ];
  await syncCatalog({ force: true, dataset: datasetV3 });

  const ohp = hevyImport.resolveHevyExercise(userId, 'Overhead Press');
  assert.ok(ohp?.row, 'the newly synced exercise resolves after invalidation');
  const ohpCatalogId = ohp.row.catalogId ?? ohp.row.catalog_id;
  assert.equal(ohpCatalogId, 'Overhead_Press', 'uses the freshly synced entry');
});
