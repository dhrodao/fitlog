import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';

const dbPath = path.join(os.tmpdir(), `fitlog-catalog-${process.pid}.db`);
process.env.DB_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.COOKIE_SECURE = 'false';
process.env.ALLOW_DEV_LOGIN = 'true';
process.env.GOOGLE_CLIENT_ID = '';

const legacy = new Database(dbPath);
legacy.exec(`
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT UNIQUE,
    email TEXT,
    name TEXT NOT NULL,
    picture TEXT,
    is_dev INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE exercise_catalog (
    wger_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_en TEXT,
    category TEXT,
    muscles TEXT,
    equipment TEXT,
    image_url TEXT,
    thumbnail_url TEXT,
    description TEXT,
    updated_at TEXT NOT NULL,
    free_id TEXT,
    free_image_url TEXT,
    free_image_url_2 TEXT,
    image_source TEXT
  );
  CREATE TABLE exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    catalog_id INTEGER REFERENCES exercise_catalog(wger_id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    category TEXT,
    image_url TEXT,
    is_custom INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name)
  );
  CREATE TABLE workout_exercises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workout_id INTEGER NOT NULL,
    exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  );

  INSERT INTO meta (key, value) VALUES ('wger_last_sync', '2026-01-01T00:00:00.000Z');
  INSERT INTO users (id, name, created_at) VALUES (1, 'Usuario Uno', '2026-01-01T00:00:00.000Z');
  INSERT INTO exercise_catalog (wger_id, name, updated_at)
    VALUES (43, 'Sentadilla', '2026-01-01T00:00:00.000Z');
  INSERT INTO exercises (user_id, catalog_id, name, category, is_custom, created_at)
    VALUES (1, NULL, 'Plancha abdominal', 'Core', 1, '2026-01-01T00:00:00.000Z');
  INSERT INTO workout_exercises (workout_id, exercise_id) VALUES (1, 1);
`);
legacy.close();

const { db } = await import('../server/db.js');
const {
  getAliasNamesForCatalogId,
  getCatalogExercise,
  getCatalogStatus,
  mapExercise,
  searchCatalog,
  serializeCatalogRow,
  syncCatalog,
} = await import('../server/catalog.js');
const { getOrCreateFromCatalog } = await import('../server/services/exercises.js');
const { createApp } = await import('../server/app.js');

const dataset = [
  {
    id: 'Plank',
    name: 'Plank',
    primaryMuscles: ['abdominals'],
    secondaryMuscles: [],
    equipment: 'body only',
    instructions: ['Get on the floor.', 'Hold the position.'],
    category: 'strength',
    level: 'beginner',
    force: 'static',
    mechanic: 'isolation',
    images: ['Plank/0.jpg', 'Plank/1.jpg'],
  },
  {
    id: 'Barbell_Deadlift',
    name: 'Barbell Deadlift',
    primaryMuscles: ['lower back'],
    secondaryMuscles: ['hamstrings'],
    equipment: 'barbell',
    instructions: ['Lift the bar.'],
    category: 'strength',
    level: 'intermediate',
    force: 'pull',
    mechanic: 'compound',
    images: ['Barbell_Deadlift/0.jpg'],
  },
  {
    id: 'Jump_Rope',
    name: 'Jump Rope',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: null,
    instructions: [],
    category: 'cardio',
    images: [],
  },
  {
    id: 'Standing_Calf_Raises',
    name: 'Standing Calf Raises',
    primaryMuscles: ['calves'],
    secondaryMuscles: [],
    equipment: 'machine',
    instructions: ['Raise your heels.'],
    category: 'strength',
    images: ['Standing_Calf_Raises/0.jpg'],
  },
];

test('migra el catálogo wger y conserva los ejercicios del usuario', () => {
  const catalogColumns = db
    .prepare('PRAGMA table_info(exercise_catalog)')
    .all()
    .map((column) => column.name);
  assert.ok(catalogColumns.includes('id'));
  assert.ok(!catalogColumns.includes('wger_id'));

  const catalogId = db
    .prepare('PRAGMA table_info(exercises)')
    .all()
    .find((column) => column.name === 'catalog_id');
  assert.equal(catalogId.type, 'TEXT');

  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM exercise_catalog').get().count,
    0
  );

  const exercise = db.prepare('SELECT * FROM exercises WHERE id = 1').get();
  assert.equal(exercise.name, 'Plancha abdominal');
  assert.equal(exercise.catalog_id, null);

  const link = db
    .prepare('SELECT * FROM workout_exercises WHERE exercise_id = 1')
    .get();
  assert.ok(link);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(
    db.prepare("SELECT value FROM meta WHERE key = 'wger_last_sync'").get(),
    undefined
  );
});

test('mapea muslos, categorías, equipamiento e imágenes', () => {
  const mapped = mapExercise(dataset[0]);
  assert.equal(mapped.category, 'Abdominales');
  assert.match(mapped.imageUrl, /free-exercise-db@.*\/exercises\/Plank\/0\.jpg$/);
  assert.match(mapped.imageUrl2, /Plank\/1\.jpg$/);
  assert.equal(mapped.description, 'Get on the floor.\n\nHold the position.');

  const serialized = serializeCatalogRow({
    id: 'Plank',
    name: 'Plank',
    category: mapped.category,
    primary_muscles: mapped.primaryMuscles,
    secondary_muscles: mapped.secondaryMuscles,
    equipment: mapped.equipment,
    instructions: mapped.instructions,
    image_url: mapped.imageUrl,
    thumbnail_url: mapped.thumbnailUrl,
    description: mapped.description,
  });
  assert.deepEqual(serialized.muscles, ['Abdominales']);
  assert.deepEqual(serialized.equipment, ['Peso corporal']);
  assert.equal(serialized.imageUrl, '/api/exercises/image/Plank/0');

  assert.equal(mapExercise(dataset[2]).imageUrl, null);
  assert.deepEqual(JSON.parse(mapExercise(dataset[2]).equipment), []);
});

test('sincroniza el catálogo y enlaza ejercicios propios por alias', async () => {
  const first = await syncCatalog({ force: true, dataset });
  assert.equal(first.count, 4);
  assert.equal(first.linked, 1);
  assert.deepEqual(first.problems, []);

  const plank = getCatalogExercise('Plank');
  assert.equal(plank.name, 'Plank');
  assert.equal(plank.category, 'Abdominales');
  assert.equal(plank.imageUrl, '/api/exercises/image/Plank/0');

  const userExercise = db
    .prepare("SELECT * FROM exercises WHERE user_id = 1 AND name = 'Plancha abdominal'")
    .get();
  assert.equal(userExercise.catalog_id, 'Plank');
  assert.equal(userExercise.image_url, '/api/exercises/image/Plank/0');
  assert.equal(userExercise.category, 'Core');

  const status = getCatalogStatus();
  assert.equal(status.count, 4);
  assert.equal(status.stale, false);

  const deadlift = searchCatalog('deadlift');
  assert.equal(deadlift.length, 1);
  assert.equal(deadlift[0].id, 'Barbell_Deadlift');
  assert.equal(deadlift[0].category, 'Espalda');
  assert.deepEqual(deadlift[0].equipment, ['Barra']);

  const filtered = searchCatalog('', { category: 'Cardio' });
  assert.deepEqual(
    filtered.map((exercise) => exercise.id),
    ['Jump_Rope']
  );

  const second = await syncCatalog({ force: true, dataset });
  assert.equal(second.linked, 0);
});

test('pagina el catálogo con limit y offset sin solapar resultados', () => {
  // 4 exercises in the dataset, sorted by name COLLATE NOCASE:
  // Barbell Deadlift, Jump Rope, Plank, Standing Calf Raises.
  const firstPage = searchCatalog('', { limit: 2, offset: 0 });
  assert.deepEqual(
    firstPage.map((exercise) => exercise.id),
    ['Barbell_Deadlift', 'Jump_Rope']
  );

  const secondPage = searchCatalog('', { limit: 2, offset: 2 });
  assert.deepEqual(
    secondPage.map((exercise) => exercise.id),
    ['Plank', 'Standing_Calf_Raises']
  );

  // Past the end returns an empty page (signals "no more" to the client).
  assert.deepEqual(searchCatalog('', { limit: 2, offset: 4 }), []);

  // Offset also works together with a category filter.
  const strengthFirst = searchCatalog('', { category: 'Espalda', limit: 1, offset: 0 });
  assert.deepEqual(
    strengthFirst.map((exercise) => exercise.id),
    ['Barbell_Deadlift']
  );
  assert.deepEqual(searchCatalog('', { category: 'Espalda', limit: 1, offset: 1 }), []);
});

test('expone el catálogo por la API con ids de texto', async () => {
  const app = createApp();
  const agent = request.agent(app);

  await agent.post('/api/auth/dev').expect(200);

  const status = await agent.get('/api/exercises/status').expect(200);
  assert.equal(status.body.count, 4);

  const search = await agent.get('/api/exercises/search?q=dead').expect(200);
  assert.equal(search.body.exercises[0].id, 'Barbell_Deadlift');

  const categories = await agent.get('/api/exercises/categories').expect(200);
  assert.ok(categories.body.categories.some((item) => item.category === 'Espalda'));

  const detail = await agent.get('/api/exercises/catalog/Plank').expect(200);
  assert.equal(detail.body.exercise.name, 'Plank');
  assert.deepEqual(detail.body.exercise.muscles, ['Abdominales']);
  assert.equal(detail.body.exercise.imageUrl, '/api/exercises/image/Plank/0');

  const added = await agent
    .post('/api/exercises/from-catalog')
    .send({ catalogId: 'Barbell_Deadlift' })
    .expect(201);
  assert.equal(added.body.exercise.catalogId, 'Barbell_Deadlift');
  assert.equal(added.body.exercise.name, 'Barbell Deadlift');

  await agent.get('/api/exercises/catalog/Missing').expect(404);
  await agent.post('/api/exercises/from-catalog').send({}).expect(400);
  await agent.get('/api/exercises/image/Jump_Rope/0').expect(404);
  await agent.get('/api/exercises/image/Plank/2').expect(404);
  await agent.get('/api/exercises/image/Missing/0').expect(404);
});

test('reutiliza el ejercicio propio al añadir desde el catálogo', () => {
  const user = db
    .prepare(
      "INSERT INTO users (google_sub, name, created_at) VALUES ('test:2', 'Usuario Dos', '2026-01-01T00:00:00.000Z')"
    )
    .run();
  const userId = user.lastInsertRowid;
  db.prepare(
    `INSERT INTO exercises (user_id, catalog_id, name, category, is_custom, created_at)
     VALUES (?, NULL, 'Plancha abdominal', 'Core', 1, '2026-01-01T00:00:00.000Z')`
  ).run(userId);

  assert.deepEqual(getAliasNamesForCatalogId('Plank'), ['Plancha abdominal']);

  const exercise = getOrCreateFromCatalog(userId, 'Plank');
  assert.equal(exercise.name, 'Plancha abdominal');
  assert.equal(exercise.catalog_id, 'Plank');
  assert.equal(
    db
      .prepare('SELECT COUNT(*) AS count FROM exercises WHERE user_id = ?')
      .get(userId).count,
    1
  );

  assert.throws(() => getOrCreateFromCatalog(userId, 'Missing'), /no encontrado/);
  assert.throws(() => getOrCreateFromCatalog(userId, ''), /Debes indicar/);
});

test.after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(`${dbPath}${suffix}`);
    } catch {
      // ignore
    }
  }
});
