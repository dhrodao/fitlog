import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getMeta, nowIso, setMeta } from './db.js';
import config from './config.js';
import { catalogImageUrl } from './catalog-images.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALIASES_PATH = path.join(__dirname, 'user-exercise-aliases.json');

const MUSCLE_CATEGORY = {
  abdominals: 'Abdominales',
  biceps: 'Brazos',
  triceps: 'Brazos',
  forearms: 'Brazos',
  calves: 'Gemelos',
  chest: 'Pecho',
  lats: 'Espalda',
  'middle back': 'Espalda',
  'lower back': 'Espalda',
  traps: 'Espalda',
  shoulders: 'Hombros',
  quadriceps: 'Piernas',
  hamstrings: 'Piernas',
  glutes: 'Piernas',
  abductors: 'Piernas',
  adductors: 'Piernas',
  neck: 'Cuello',
};

const CATEGORY_FALLBACK = {
  cardio: 'Cardio',
  stretching: 'Estiramientos',
};

const MUSCLE_ES = {
  abdominals: 'Abdominales',
  abductors: 'Abductores',
  adductors: 'Aductores',
  biceps: 'Bíceps',
  calves: 'Gemelos',
  chest: 'Pecho',
  forearms: 'Antebrazos',
  glutes: 'Glúteos',
  hamstrings: 'Isquios',
  lats: 'Dorsales',
  'lower back': 'Lumbar',
  'middle back': 'Espalda media',
  neck: 'Cuello',
  quadriceps: 'Cuádriceps',
  shoulders: 'Hombros',
  traps: 'Trapecios',
  triceps: 'Tríceps',
};

const EQUIPMENT_ES = {
  bands: 'Bandas',
  barbell: 'Barra',
  'body only': 'Peso corporal',
  cable: 'Polea',
  dumbbell: 'Mancuernas',
  'e-z curl bar': 'Barra Z',
  'exercise ball': 'Fitball',
  'foam roll': 'Rodillo',
  kettlebells: 'Kettlebell',
  machine: 'Máquina',
  'medicine ball': 'Balón medicinal',
  other: 'Otro',
};

let aliasesCache = null;

function loadAliases() {
  if (aliasesCache) return aliasesCache;

  const aliases = JSON.parse(fs.readFileSync(ALIASES_PATH, 'utf8'));
  const dataset = aliases.dataset || {};
  if (!dataset.repo || !dataset.ref) {
    throw new Error(
      'user-exercise-aliases.json: faltan dataset.repo y dataset.ref (commit fijo)'
    );
  }

  aliasesCache = aliases;
  return aliases;
}

export function normalizeExerciseName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function datasetUrl() {
  const dataset = loadAliases().dataset;
  const distPath = dataset.distPath || 'dist/exercises.json';
  return `https://raw.githubusercontent.com/${dataset.repo}/${dataset.ref}/${distPath}`;
}

function imageBaseUrl() {
  const dataset = loadAliases().dataset;
  if (dataset.imageBaseUrl) {
    return dataset.imageBaseUrl.endsWith('/')
      ? dataset.imageBaseUrl
      : `${dataset.imageBaseUrl}/`;
  }
  return `https://cdn.jsdelivr.net/gh/${dataset.repo}@${dataset.ref}/exercises/`;
}

export function buildImageUrl(imagePath) {
  const encodedPath = String(imagePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${imageBaseUrl()}${encodedPath}`;
}

async function fetchDataset() {
  const res = await fetch(datasetUrl(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'fitness-app/1.0 (personal workout tracker)',
    },
  });

  if (!res.ok) {
    throw new Error(`free-exercise-db respondió ${res.status}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('free-exercise-db: el dataset no es un array');
  }
  return data;
}

function categoryFor(item) {
  const primary = Array.isArray(item.primaryMuscles)
    ? item.primaryMuscles[0]
    : null;
  return (
    MUSCLE_CATEGORY[primary] || CATEGORY_FALLBACK[item.category] || 'Otros'
  );
}

export function mapExercise(item) {
  const images = Array.isArray(item.images) ? item.images : [];
  const primary = Array.isArray(item.primaryMuscles)
    ? item.primaryMuscles.filter(Boolean)
    : [];
  const secondary = Array.isArray(item.secondaryMuscles)
    ? item.secondaryMuscles.filter(Boolean)
    : [];
  const equipment = item.equipment ? [item.equipment] : [];
  const instructions = Array.isArray(item.instructions)
    ? item.instructions.filter(Boolean)
    : [];
  const imageUrl = images[0] ? buildImageUrl(images[0]) : null;

  return {
    id: String(item.id),
    name: item.name,
    category: categoryFor(item),
    muscles: JSON.stringify([...primary, ...secondary]),
    primaryMuscles: JSON.stringify(primary),
    secondaryMuscles: JSON.stringify(secondary),
    equipment: JSON.stringify(equipment),
    instructions: JSON.stringify(instructions),
    level: item.level || null,
    force: item.force || null,
    mechanic: item.mechanic || null,
    imageUrl,
    imageUrl2: images[1] ? buildImageUrl(images[1]) : null,
    thumbnailUrl: imageUrl,
    description: instructions.join('\n\n'),
    updatedAt: nowIso(),
  };
}

export function linkUserExercises() {
  const aliases = loadAliases().userExercises || {};
  const getCatalogImage = db.prepare(
    'SELECT image_url FROM exercise_catalog WHERE id = ?'
  );
  const rows = db
    .prepare('SELECT id, name FROM exercises WHERE catalog_id IS NULL')
    .all();
  const update = db.prepare(
    `UPDATE exercises
        SET catalog_id = ?, image_url = COALESCE(image_url, ?)
      WHERE id = ?`
  );
  const updateImage = db.prepare(
    'UPDATE exercises SET image_url = ? WHERE id = ?'
  );

  const problems = [];
  let linked = 0;

  for (const row of rows) {
    const alias = aliases[normalizeExerciseName(row.name)];
    if (!alias) continue;

    const catalogRow = getCatalogImage.get(alias.freeId);
    if (!catalogRow) {
      problems.push(`freeId inexistente: ${alias.freeId} (${row.name})`);
      continue;
    }

    const imageUrl = catalogRow.image_url
      ? catalogImageUrl(alias.freeId, 0)
      : null;
    linked += update.run(alias.freeId, imageUrl, row.id).changes;
  }

  // Migrate rows linked by older syncs that still point at the CDN directly.
  const stale = db
    .prepare(
      `SELECT id, catalog_id FROM exercises
        WHERE catalog_id IS NOT NULL
          AND image_url LIKE 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@%'`
    )
    .all();
  for (const row of stale) {
    updateImage.run(catalogImageUrl(row.catalog_id, 0), row.id);
  }

  return { linked, problems };
}

const upsertCatalog = db.prepare(
  `INSERT INTO exercise_catalog
     (id, name, category, muscles, primary_muscles, secondary_muscles,
      equipment, instructions, level, force, mechanic,
      image_url, image_url_2, thumbnail_url, description, updated_at)
   VALUES
     (@id, @name, @category, @muscles, @primaryMuscles, @secondaryMuscles,
      @equipment, @instructions, @level, @force, @mechanic,
      @imageUrl, @imageUrl2, @thumbnailUrl, @description, @updatedAt)
   ON CONFLICT(id) DO UPDATE SET
     name = excluded.name,
     category = excluded.category,
     muscles = excluded.muscles,
     primary_muscles = excluded.primary_muscles,
     secondary_muscles = excluded.secondary_muscles,
     equipment = excluded.equipment,
     instructions = excluded.instructions,
     level = excluded.level,
     force = excluded.force,
     mechanic = excluded.mechanic,
     image_url = excluded.image_url,
     image_url_2 = excluded.image_url_2,
     thumbnail_url = excluded.thumbnail_url,
     description = excluded.description,
     updated_at = excluded.updated_at`
);

async function runSync({ dataset }) {
  const items = dataset || (await fetchDataset());

  const writeCatalog = db.transaction((records) => {
    for (const item of records) {
      if (!item?.id || !item?.name) continue;
      upsertCatalog.run(mapExercise(item));
    }
  });

  writeCatalog(items);

  const { linked, problems } = db.transaction(() => linkUserExercises())();

  const syncedAt = nowIso();
  setMeta('catalog_last_sync', syncedAt);
  setMeta('catalog_count', items.length);

  return {
    count: items.length,
    linked,
    problems,
    syncedAt,
    skipped: false,
  };
}

export function getCatalogStatus() {
  const count = db
    .prepare('SELECT COUNT(*) AS count FROM exercise_catalog')
    .get().count;
  const lastSync = getMeta('catalog_last_sync');

  return {
    count,
    lastSync,
    stale:
      !lastSync ||
      Date.now() - new Date(lastSync).getTime() >
        config.catalogSyncDays * 24 * 60 * 60 * 1000,
  };
}

let syncPromise = null;

export async function syncCatalog({ force = false, dataset = null } = {}) {
  if (syncPromise) return syncPromise;

  const status = getCatalogStatus();
  if (!force && status.count > 0 && !status.stale) {
    return { ...status, linked: 0, problems: [], skipped: true };
  }

  syncPromise = runSync({ dataset }).finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}

export function searchCatalog(query, { limit = 40, category = '' } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const term = `%${String(query || '').trim()}%`;
  const hasQuery = Boolean(String(query || '').trim());

  let rows;
  if (hasQuery && category) {
    rows = db
      .prepare(
        `SELECT * FROM exercise_catalog
         WHERE name LIKE ? AND category = ?
         ORDER BY name COLLATE NOCASE LIMIT ?`
      )
      .all(term, category, safeLimit);
  } else if (hasQuery) {
    rows = db
      .prepare(
        `SELECT * FROM exercise_catalog
         WHERE name LIKE ?
         ORDER BY name COLLATE NOCASE LIMIT ?`
      )
      .all(term, safeLimit);
  } else if (category) {
    rows = db
      .prepare(
        `SELECT * FROM exercise_catalog
         WHERE category = ?
         ORDER BY name COLLATE NOCASE LIMIT ?`
      )
      .all(category, safeLimit);
  } else {
    rows = db
      .prepare(
        'SELECT * FROM exercise_catalog ORDER BY name COLLATE NOCASE LIMIT ?'
      )
      .all(safeLimit);
  }

  return rows.map(serializeCatalogRow);
}

export function getCatalogExercise(id) {
  const row = db
    .prepare('SELECT * FROM exercise_catalog WHERE id = ?')
    .get(String(id));
  return row ? serializeCatalogRow(row) : null;
}

export function listCategories() {
  return db
    .prepare(
      'SELECT category, COUNT(*) AS count FROM exercise_catalog GROUP BY category ORDER BY category COLLATE NOCASE'
    )
    .all();
}

export function getAliasNamesForCatalogId(catalogId) {
  const aliases = loadAliases().userExercises || {};
  return Object.values(aliases)
    .filter((alias) => alias.freeId === catalogId)
    .map((alias) => alias.name);
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function serializeCatalogRow(row) {
  const primary = parseList(row.primary_muscles || row.muscles);
  const secondary = parseList(row.secondary_muscles);
  const equipment = parseList(row.equipment);
  const instructions = parseList(row.instructions);
  const muscles = [...new Set([...primary, ...secondary])].map(
    (muscle) => MUSCLE_ES[muscle] || muscle
  );

  const imageUrl = row.image_url ? catalogImageUrl(row.id, 0) : null;

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscles,
    equipment: equipment.map((item) => EQUIPMENT_ES[item] || item),
    imageUrl,
    thumbnailUrl: imageUrl,
    description: row.description,
    instructions,
    level: row.level,
    force: row.force,
    mechanic: row.mechanic,
  };
}
