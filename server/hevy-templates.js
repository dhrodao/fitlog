import { db, nowIso } from './db.js';
import { normalizeExerciseName } from './catalog.js';
import { registerCatalogCache } from './catalog-cache-registry.js';
import { getOrCreateFromCatalog, getOrCreateByName } from './services/exercises.js';

/**
 * Local cache of the user's Hevy exercise templates. Lets us map imported
 * exercises to a Fitlog exercise by Hevy's canonical `exercise_template_id`
 * (reliable) instead of only by display name.
 */

const HEVY_MUSCLE_CATEGORY = {
  abductors: 'Piernas',
  abs: 'Abdominales',
  abdominals: 'Abdominales',
  adductors: 'Piernas',
  biceps: 'Brazos',
  calves: 'Gemelos',
  cardio: 'Cardio',
  chest: 'Pecho',
  forearms: 'Brazos',
  full_body: 'Cuerpo completo',
  glutes: 'Piernas',
  hamstrings: 'Piernas',
  lats: 'Espalda',
  lower_back: 'Espalda',
  'lower back': 'Espalda',
  neck: 'Cuello',
  quadriceps: 'Piernas',
  shoulders: 'Hombros',
  traps: 'Espalda',
  triceps: 'Brazos',
  upper_back: 'Espalda',
  'upper back': 'Espalda',
};

function categoryFromMuscle(muscle) {
  if (!muscle) return 'Personalizado';
  return HEVY_MUSCLE_CATEGORY[String(muscle).toLowerCase()] || 'Personalizado';
}

/** Upsert a batch of Hevy ExerciseTemplate objects for a user. */
export function storeTemplates(userId, templates) {
  if (!Array.isArray(templates) || !templates.length) return 0;
  const now = nowIso();
  const upsert = db.prepare(
    `INSERT INTO hevy_templates
       (user_id, template_id, title, type, primary_muscle, secondary_muscles,
        equipment, thumbnail_url, is_custom, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, template_id) DO UPDATE SET
       title = excluded.title,
       type = excluded.type,
       primary_muscle = excluded.primary_muscle,
       secondary_muscles = excluded.secondary_muscles,
       equipment = excluded.equipment,
       thumbnail_url = excluded.thumbnail_url,
       is_custom = excluded.is_custom,
       updated_at = excluded.updated_at`
  );
  const run = db.transaction(() => {
    let n = 0;
    for (const t of templates) {
      if (!t?.id) continue;
      upsert.run(
        userId,
        String(t.id),
        t.title || null,
        t.type || null,
        t.primary_muscle_group || null,
        JSON.stringify(t.secondary_muscle_groups || []),
        t.equipment || null,
        t.thumbnail_url || null,
        t.is_custom ? 1 : 0,
        now
      );
      n += 1;
    }
    return n;
  });
  return run();
}

export function getTemplate(userId, templateId) {
  if (!templateId) return null;
  return db
    .prepare('SELECT * FROM hevy_templates WHERE user_id = ? AND template_id = ?')
    .get(userId, String(templateId));
}

let catalogByNormCache = null;
function catalogByNorm() {
  if (catalogByNormCache) return catalogByNormCache;
  const map = new Map();
  for (const row of db.prepare('SELECT id, name FROM exercise_catalog').all()) {
    const norm = normalizeExerciseName(row.name);
    if (!map.has(norm)) map.set(norm, row.id);
  }
  catalogByNormCache = map;
  return map;
}

function matchCatalogByTitle(title) {
  const map = catalogByNorm();
  const direct = map.get(normalizeExerciseName(title));
  if (direct) return direct;
  const m = String(title || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const base = m[1].trim();
    const equip = m[2].trim();
    const stripped = map.get(normalizeExerciseName(base));
    if (stripped) return stripped;
    const prefixed = map.get(normalizeExerciseName(`${equip} ${base}`));
    if (prefixed) return prefixed;
  }
  return null;
}

/**
 * Resolve a Fitlog exercise from a cached Hevy template id.
 * Returns null when the template is not cached (caller falls back to name).
 * Strategy: match the template title to free-exercise-db (keeps rich images);
 * otherwise create a custom exercise using Hevy's thumbnail + muscle category.
 */
export function resolveByTemplateId(userId, templateId) {
  const tpl = getTemplate(userId, templateId);
  if (!tpl) return null;

  const catalogId = matchCatalogByTitle(tpl.title);
  if (catalogId) {
    return { row: getOrCreateFromCatalog(userId, catalogId), source: 'template-catalog' };
  }

  return {
    row: getOrCreateByName(userId, tpl.title || `Hevy ${templateId}`, {
      category: categoryFromMuscle(tpl.primary_muscle),
      imageUrl: tpl.thumbnail_url || null,
    }),
    source: 'template-custom',
  };
}

/** Test/maintenance helper. */
export function _clearCatalogCache() {
  catalogByNormCache = null;
}

// Drop the cached name→catalog map whenever the catalog is re-synced.
registerCatalogCache(_clearCatalogCache);
