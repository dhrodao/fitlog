import { db, getMeta, nowIso, setMeta } from './db.js';
import config from './config.js';

const PAGE_SIZE = 100;

const CATEGORY_ES = {
  Abs: 'Abdominales',
  Arms: 'Brazos',
  Back: 'Espalda',
  Calves: 'Gemelos',
  Chest: 'Pecho',
  Legs: 'Piernas',
  Shoulders: 'Hombros',
  Cardio: 'Cardio',
  'Full body': 'Cuerpo completo',
  Neck: 'Cuello',
  Glutes: 'Glúteos',
  Hamstrings: 'Isquios',
  Quadriceps: 'Cuádriceps',
  Biceps: 'Bíceps',
  Triceps: 'Tríceps',
  Forearms: 'Antebrazos',
  Lats: 'Dorsales',
  Traps: 'Trapecios',
  Core: 'Core',
};

function stripHtml(value) {
  if (!value) return '';
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pickTranslation(translations = []) {
  return (
    translations.find((t) => t.language === 4) ||
    translations.find((t) => t.language === 2) ||
    translations[0] ||
    null
  );
}

function pickEnglish(translations = []) {
  return translations.find((t) => t.language === 2) || null;
}

function mapExercise(item) {
  const es = pickTranslation(item.translations);
  const en = pickEnglish(item.translations);
  const image = (item.images || []).find((img) => img.is_main) || item.images?.[0];

  return {
    wgerId: item.id,
    name: stripHtml(es?.name) || stripHtml(en?.name) || `Ejercicio ${item.id}`,
    nameEn: stripHtml(en?.name) || null,
    category:
      CATEGORY_ES[item.category?.name] || item.category?.name || 'Otro',
    muscles: (item.muscles || []).map((m) => m.name_en || m.name).filter(Boolean),
    equipment: (item.equipment || []).map((e) => e.name).filter(Boolean),
    imageUrl: image?.image || null,
    thumbnailUrl: image?.thumbnails?.small || image?.image || null,
    description: stripHtml(es?.description || en?.description).slice(0, 4000),
  };
}

async function fetchPage(offset) {
  const url = new URL(`${config.wgerBase}/exerciseinfo/`);
  url.searchParams.set('language', 'es');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'fitness-app/1.0 (personal workout tracker)',
    },
  });

  if (!res.ok) {
    throw new Error(`wger respondió ${res.status}`);
  }

  return res.json();
}

let syncPromise = null;

async function runSync() {
  const upsert = db.prepare(
    `INSERT INTO exercise_catalog
      (wger_id, name, name_en, category, muscles, equipment, image_url, thumbnail_url, description, updated_at)
     VALUES (@wgerId, @name, @nameEn, @category, @muscles, @equipment, @imageUrl, @thumbnailUrl, @description, @updatedAt)
     ON CONFLICT(wger_id) DO UPDATE SET
       name = excluded.name,
       name_en = excluded.name_en,
       category = excluded.category,
       muscles = excluded.muscles,
       equipment = excluded.equipment,
       image_url = excluded.image_url,
       thumbnail_url = excluded.thumbnail_url,
       description = excluded.description,
       updated_at = excluded.updated_at`
  );

  let offset = 0;
  let total = 0;
  let pages = 0;

  while (true) {
    const page = await fetchPage(offset);
    const results = Array.isArray(page.results) ? page.results : [];

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        const mapped = mapExercise(item);
        upsert.run({
          wgerId: mapped.wgerId,
          name: mapped.name,
          nameEn: mapped.nameEn,
          category: mapped.category,
          muscles: JSON.stringify(mapped.muscles),
          equipment: JSON.stringify(mapped.equipment),
          imageUrl: mapped.imageUrl,
          thumbnailUrl: mapped.thumbnailUrl,
          description: mapped.description,
          updatedAt: nowIso(),
        });
      }
    });

    insertMany(results);
    total += results.length;
    pages += 1;

    if (!page.next || results.length === 0) break;
    offset += PAGE_SIZE;

    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  setMeta('wger_last_sync', nowIso());
  setMeta('wger_count', total);

  return { count: total, pages, syncedAt: getMeta('wger_last_sync') };
}

export function getWgerStatus() {
  const count = db
    .prepare('SELECT COUNT(*) AS count FROM exercise_catalog')
    .get().count;
  const lastSync = getMeta('wger_last_sync');

  return {
    count,
    lastSync,
    stale:
      !lastSync ||
      Date.now() - new Date(lastSync).getTime() >
        config.wgerSyncDays * 24 * 60 * 60 * 1000,
  };
}

export async function syncWger({ force = false } = {}) {
  if (syncPromise) return syncPromise;

  const status = getWgerStatus();
  if (!force && status.count > 0 && !status.stale) {
    return { ...status, skipped: true };
  }

  syncPromise = runSync().finally(() => {
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
         WHERE (name LIKE ? OR name_en LIKE ?) AND category = ?
         ORDER BY name COLLATE NOCASE LIMIT ?`
      )
      .all(term, term, category, safeLimit);
  } else if (hasQuery) {
    rows = db
      .prepare(
        `SELECT * FROM exercise_catalog
         WHERE name LIKE ? OR name_en LIKE ?
         ORDER BY name COLLATE NOCASE LIMIT ?`
      )
      .all(term, term, safeLimit);
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

export function getCatalogExercise(wgerId) {
  const row = db
    .prepare('SELECT * FROM exercise_catalog WHERE wger_id = ?')
    .get(wgerId);
  return row ? serializeCatalogRow(row) : null;
}

export function listCategories() {
  return db
    .prepare(
      'SELECT category, COUNT(*) AS count FROM exercise_catalog GROUP BY category ORDER BY category COLLATE NOCASE'
    )
    .all();
}

export function serializeCatalogRow(row) {
  let muscles = [];
  let equipment = [];
  try {
    muscles = JSON.parse(row.muscles || '[]');
  } catch {}
  try {
    equipment = JSON.parse(row.equipment || '[]');
  } catch {}

  return {
    id: row.wger_id,
    name: row.name,
    nameEn: row.name_en,
    category: row.category,
    muscles,
    equipment,
    imageUrl: row.image_url,
    thumbnailUrl: row.thumbnail_url,
    description: row.description,
  };
}
