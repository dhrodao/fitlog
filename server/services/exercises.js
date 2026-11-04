import { db, nowIso } from '../db.js';
import { getCatalogExercise } from '../wger.js';
import { HttpError, requireString } from '../http.js';

export function serializeExercise(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    imageUrl: row.image_url,
    catalogId: row.catalog_id,
    isCustom: Boolean(row.is_custom),
  };
}

export function getUserExercise(userId, exerciseId) {
  return db
    .prepare('SELECT * FROM exercises WHERE id = ? AND user_id = ?')
    .get(exerciseId, userId);
}

export function getOrCreateFromCatalog(userId, catalogId) {
  const catalog = getCatalogExercise(catalogId);
  if (!catalog) {
    throw new HttpError(404, 'Ejercicio no encontrado en el catálogo');
  }

  const byCatalog = db
    .prepare('SELECT * FROM exercises WHERE user_id = ? AND catalog_id = ?')
    .get(userId, catalogId);
  if (byCatalog) return byCatalog;

  const byName = db
    .prepare('SELECT * FROM exercises WHERE user_id = ? AND name = ?')
    .get(userId, catalog.name);

  if (byName) {
    db.prepare(
      `UPDATE exercises SET catalog_id = COALESCE(catalog_id, ?),
        image_url = COALESCE(image_url, ?), category = COALESCE(category, ?)
       WHERE id = ?`
    ).run(catalogId, catalog.thumbnailUrl, catalog.category, byName.id);
    return db.prepare('SELECT * FROM exercises WHERE id = ?').get(byName.id);
  }

  const info = db
    .prepare(
      `INSERT INTO exercises (user_id, catalog_id, name, category, image_url, is_custom, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      userId,
      catalogId,
      catalog.name,
      catalog.category,
      catalog.thumbnailUrl,
      nowIso()
    );

  return db.prepare('SELECT * FROM exercises WHERE id = ?').get(info.lastInsertRowid);
}

export function getOrCreateByName(userId, name, { category = 'Personalizado', imageUrl = null } = {}) {
  const clean = requireString(name, 'nombre del ejercicio', { max: 120 });
  const existing = db
    .prepare('SELECT * FROM exercises WHERE user_id = ? AND name = ?')
    .get(userId, clean);
  if (existing) return existing;

  const info = db
    .prepare(
      `INSERT INTO exercises (user_id, catalog_id, name, category, image_url, is_custom, created_at)
       VALUES (?, NULL, ?, ?, ?, 1, ?)`
    )
    .run(userId, clean, category, imageUrl, nowIso());

  return db.prepare('SELECT * FROM exercises WHERE id = ?').get(info.lastInsertRowid);
}

export function resolveExercise(userId, input = {}) {
  if (input.exerciseId) {
    const row = getUserExercise(userId, Number(input.exerciseId));
    if (!row) throw new HttpError(404, 'Ejercicio no encontrado');
    return row;
  }

  if (input.catalogId) {
    return getOrCreateFromCatalog(userId, Number(input.catalogId));
  }

  if (input.name) {
    return getOrCreateByName(userId, input.name, {
      category: input.category || 'Personalizado',
      imageUrl: input.imageUrl || null,
    });
  }

  throw new HttpError(400, 'Debes indicar un ejercicio');
}

export function listUserExercises(userId, query = '') {
  const term = `%${String(query || '').trim()}%`;
  return db
    .prepare(
      `SELECT DISTINCT e.*, MAX(w.started_at) AS last_used
       FROM exercises e
       LEFT JOIN workout_exercises we ON we.exercise_id = e.id
       LEFT JOIN workouts w ON w.id = we.workout_id AND w.finished_at IS NOT NULL
       WHERE e.user_id = ? AND (? = '%%' OR e.name LIKE ?)
       GROUP BY e.id
       ORDER BY last_used DESC NULLS LAST, e.name COLLATE NOCASE
       LIMIT 60`
    )
    .all(userId, term, term)
    .map((row) => ({
      ...serializeExercise(row),
      lastUsed: row.last_used,
    }));
}
