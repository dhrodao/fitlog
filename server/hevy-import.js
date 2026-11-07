import { db, nowIso } from './db.js';
import { normalizeExerciseName, normalizeName } from './catalog.js';
import { registerCatalogCache } from './catalog-cache-registry.js';
import { getOrCreateFromCatalog, getOrCreateByName } from './services/exercises.js';
import { resolveByTemplateId } from './hevy-templates.js';

/**
 * Shared helpers to import workouts coming from Hevy (CSV export or public API)
 * into the local Fitlog database.
 *
 * A "normalized workout" is a plain object with the shape:
 * {
 *   name: string,
 *   startedAt: string (ISO),
 *   finishedAt: string|null (ISO),
 *   notes: string|null,
 *   exercises: [
 *     {
 *       name: string,            // Hevy exercise title (English)
 *       notes: string|null,
 *       supersetId: number|null, // Hevy superset grouping within the workout
 *       sets: [
 *         { weightKg: number|null, reps: number|null }
 *       ]
 *     }
 *   ]
 * }
 */

/** Minimal RFC-4180 CSV parser (handles quotes, escaped quotes and CRLF). */
export function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse a CSV string into an array of objects keyed by the header row. */
export function parseCsvObjects(input) {
  const rows = parseCsv(input).filter(
    (r) => r.length > 1 && r.some((c) => c !== '')
  );
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((key, i) => {
      obj[key] = r[i] ?? '';
    });
    return obj;
  });
}

/**
 * Split "Bench Press (Barbell)" into { base: "Bench Press", equip: "Barbell" }.
 * Returns null when there is no trailing "(...)" group.
 */
function splitEquipment(name) {
  const m = String(name || '').match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return null;
  return { base: m[1].trim(), equip: m[2].trim() };
}

let catalogByNormCache = null;

function catalogByNorm() {
  if (catalogByNormCache) return catalogByNormCache;
  const map = new Map();
  const rows = db.prepare('SELECT id, name FROM exercise_catalog').all();
  for (const row of rows) {
    const norm = normalizeExerciseName(row.name);
    if (!map.has(norm)) map.set(norm, row.id);
  }
  catalogByNormCache = map;
  return map;
}

/** Drop the cached name→catalog map (called after a catalog re-sync). */
export function _clearCatalogCache() {
  catalogByNormCache = null;
}

registerCatalogCache(_clearCatalogCache);

/**
 * Resolve a Hevy exercise to a Fitlog exercise row for the given user.
 * Tries, in order:
 *   1. the cached Hevy template id (reliable; keeps/links catalog image or
 *      falls back to Hevy's thumbnail for custom exercises),
 *   2. an explicit Hevy->catalog id override (templateMap),
 *   3. exact normalized catalog name,
 *   4. catalog name after stripping the trailing "(Equipment)" suffix,
 *   5. equipment moved to the front ("Bench Press (Barbell)" ->
 *      "Barbell Bench Press"), matching free-exercise-db's naming,
 *   6. otherwise create a custom exercise keeping the original Hevy name.
 */
export function resolveHevyExercise(
  userId,
  hevyName,
  { templateMap = null, templateId = null } = {}
) {
  const name = String(hevyName || '').trim();

  if (templateId) {
    const byTemplate = resolveByTemplateId(userId, templateId);
    if (byTemplate) return byTemplate;
  }

  if (!name) return null;

  if (templateMap && templateMap.has(name)) {
    return {
      row: getOrCreateFromCatalog(userId, templateMap.get(name)),
      source: 'template-map',
    };
  }

  const map = catalogByNorm();
  const direct = map.get(normalizeExerciseName(name));
  if (direct) {
    return { row: getOrCreateFromCatalog(userId, direct), source: 'catalog' };
  }

  const parts = splitEquipment(name);
  if (parts) {
    const stripped = map.get(normalizeExerciseName(parts.base));
    if (stripped) {
      return {
        row: getOrCreateFromCatalog(userId, stripped),
        source: 'catalog-stripped',
      };
    }
    // Hevy puts equipment as a trailing "(Equipment)" suffix, while
    // free-exercise-db uses it as a prefix (e.g. "Barbell Bench Press").
    const prefixed = map.get(normalizeExerciseName(`${parts.equip} ${parts.base}`));
    if (prefixed) {
      return {
        row: getOrCreateFromCatalog(userId, prefixed),
        source: 'catalog-prefixed',
      };
    }
  }

  return {
    row: getOrCreateByName(userId, name, { category: 'Personalizado' }),
    source: 'custom',
  };
}

/** Number of workouts imported from Hevy for a user. */
export function countImportedWorkouts(userId) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM workouts WHERE user_id = ? AND source = 'hevy'"
    )
    .get(userId);
  return row ? row.c : 0;
}

/**
 * Delete every workout imported from Hevy for a user (exercise and set rows
 * cascade via foreign keys). Exercises in the personal catalogue are
 * preserved. Returns the number of workouts removed.
 */
export function deleteImportedWorkouts(userId) {
  const info = db
    .prepare("DELETE FROM workouts WHERE user_id = ? AND source = 'hevy'")
    .run(userId);
  return info.changes;
}

/** True if a workout with the same (user, name, startedAt) already exists. */
export function workoutExists(userId, name, startedAt) {
  const row = db
    .prepare(
      'SELECT id FROM workouts WHERE user_id = ? AND name = ? AND started_at = ?'
    )
    .get(userId, name, startedAt);
  return row ? row.id : null;
}

/** Look up an imported workout by its stable Hevy id. */
export function workoutByHevyId(userId, hevyWorkoutId) {
  if (!hevyWorkoutId) return null;
  const row = db
    .prepare(
      'SELECT id FROM workouts WHERE user_id = ? AND hevy_workout_id = ?'
    )
    .get(userId, hevyWorkoutId);
  return row ? row.id : null;
}

// Find a legacy imported workout (source 'hevy', no Hevy id) that matches by
// name and start time. Used once per workout to adopt rows imported before
// stable ids existed, so the first post-upgrade sync updates them instead of
// creating a duplicate.
function legacyWorkoutToAdopt(userId, name, startedAt) {
  const row = db
    .prepare(
      `SELECT id FROM workouts
        WHERE user_id = ? AND source = 'hevy' AND hevy_workout_id IS NULL
          AND name = ? AND started_at = ?`
    )
    .get(userId, name, startedAt);
  return row ? row.id : null;
}

// Insert all exercises/sets of a normalized workout under an existing workout
// row, resolving exercises and rebuilding superset groups. Assumes the caller
// runs inside a transaction and has already cleared any previous children.
function insertWorkoutChildren(userId, workoutId, workout, { templateMap, createdAt }) {
  const insertWe = db.prepare(
    `INSERT INTO workout_exercises (workout_id, exercise_id, position, notes, superset_group)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertSet = db.prepare(
    `INSERT INTO workout_sets
       (workout_exercise_id, set_number, weight_kg, reps, completed, rest_seconds, created_at)
     VALUES (?, ?, ?, ?, 1, NULL, ?)`
  );

  const stats = { exercises: 0, sets: 0, custom: 0, matched: 0 };
  // Map Hevy superset ids to local superset group ids (only when >= 2 members).
  const supersetCount = new Map();
  for (const ex of workout.exercises) {
    if (ex.supersetId != null && ex.supersetId !== '') {
      supersetCount.set(ex.supersetId, (supersetCount.get(ex.supersetId) || 0) + 1);
    }
  }
  const supersetGroupIds = new Map();
  let nextGroup = 1;

  workout.exercises.forEach((ex, position) => {
    const resolved = resolveHevyExercise(userId, ex.name, {
      templateMap,
      templateId: ex.templateId || null,
    });
    if (!resolved) return;
    if (resolved.source === 'custom' || resolved.source === 'template-custom')
      stats.custom += 1;
    else stats.matched += 1;

    let supersetGroup = null;
    if (
      ex.supersetId != null &&
      ex.supersetId !== '' &&
      supersetCount.get(ex.supersetId) >= 2
    ) {
      if (!supersetGroupIds.has(ex.supersetId)) {
        supersetGroupIds.set(ex.supersetId, nextGroup);
        nextGroup += 1;
      }
      supersetGroup = supersetGroupIds.get(ex.supersetId);
    }

    const weInfo = insertWe.run(
      workoutId,
      resolved.row.id,
      position,
      ex.notes || null,
      supersetGroup
    );
    const weId = weInfo.lastInsertRowid;
    stats.exercises += 1;

    ex.sets.forEach((set, i) => {
      insertSet.run(weId, i + 1, set.weightKg ?? null, set.reps ?? null, createdAt);
      stats.sets += 1;
    });
  });

  // If an imported Hevy routine shares this workout's name, link them so the
  // routine's history/chart includes this workout. Hevy's API doesn't expose
  // the workout's routine, so we match by normalized name.
  const targetName = normalizeName(workout.name);
  if (targetName) {
    const routines = db
      .prepare("SELECT id, name FROM routines WHERE user_id = ? AND source = 'hevy'")
      .all(userId);
    const match = routines.find((r) => normalizeName(r.name) === targetName);
    if (match) {
      db.prepare('UPDATE workouts SET routine_id = ? WHERE id = ?').run(
        match.id,
        workoutId
      );
    }
  }

  return stats;
}

/**
 * Persist a single normalized workout, upserting by the stable Hevy workout id
 * when present. Behaviour:
 *   - If the workout has a Hevy id that already exists for this user, it is
 *     updated in place (metadata + children replaced), so renames and edited
 *     sets/notes are applied without creating duplicates.
 *   - If it has a Hevy id that is new, it is inserted with that id.
 *   - If it has no Hevy id (CSV import / legacy), it falls back to the
 *     (name, startedAt) duplicate check and is skipped when already present.
 */
export function importWorkout(userId, workout, { templateMap = null } = {}) {
  const name = String(workout.name || 'Entreno').slice(0, 200);
  const startedAt = workout.startedAt;
  if (!startedAt) {
    return { skipped: true, reason: 'missing-start', name };
  }

  const hevyWorkoutId = workout.hevyWorkoutId || null;

  // Without a stable id (CSV/legacy), keep the old name+time idempotency.
  if (!hevyWorkoutId) {
    const existingId = workoutExists(userId, name, startedAt);
    if (existingId) {
      return { skipped: true, reason: 'duplicate', name, workoutId: existingId };
    }
  }

  const finishedAt = workout.finishedAt || null;
  let durationSeconds = null;
  if (finishedAt) {
    durationSeconds = Math.max(
      0,
      Math.round(
        (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000
      )
    );
  }

  const createdAt = nowIso();
  let existingByHevyId = hevyWorkoutId ? workoutByHevyId(userId, hevyWorkoutId) : null;
  // One-time backfill: a workout that now has a Hevy id may already exist as a
  // legacy row (imported before ids). Adopt it so we update instead of
  // duplicating on the first sync after upgrading.
  if (hevyWorkoutId && !existingByHevyId) {
    const legacyId = legacyWorkoutToAdopt(userId, name, startedAt);
    if (legacyId) {
      db.prepare(
        'UPDATE workouts SET hevy_workout_id = ? WHERE id = ? AND user_id = ?'
      ).run(hevyWorkoutId, legacyId, userId);
      existingByHevyId = legacyId;
    }
  }

  const run = db.transaction(() => {
    let workoutId;
    let updated = false;

    if (existingByHevyId) {
      // Update in place: refresh metadata and replace children. Only touch
      // imported ('hevy') workouts; never a user-created one.
      workoutId = existingByHevyId;
      updated = true;
      db.prepare(
        `UPDATE workouts
           SET name = ?, notes = ?, started_at = ?, finished_at = ?,
               duration_seconds = ?
         WHERE id = ? AND user_id = ? AND source = 'hevy'`
      ).run(name, workout.notes || null, startedAt, finishedAt, durationSeconds, workoutId, userId);
      // Replace children (cascades delete sets via FK on workout_exercises).
      db.prepare('DELETE FROM workout_exercises WHERE workout_id = ?').run(workoutId);
    } else {
      const info = db
        .prepare(
          `INSERT INTO workouts
             (user_id, routine_id, name, location, notes, started_at, finished_at, duration_seconds, source, hevy_workout_id, created_at)
           VALUES (?, NULL, ?, NULL, ?, ?, ?, ?, 'hevy', ?, ?)`
        )
        .run(
          userId,
          name,
          workout.notes || null,
          startedAt,
          finishedAt,
          durationSeconds,
          hevyWorkoutId,
          createdAt
        );
      workoutId = info.lastInsertRowid;
    }

    const stats = insertWorkoutChildren(userId, workoutId, workout, {
      templateMap,
      createdAt,
    });
    return { workoutId, stats, updated };
  });

  const { workoutId, stats, updated } = run();
  return { skipped: false, updated, name, startedAt, workoutId, hevyWorkoutId, ...stats };
}

/** Group flat Hevy CSV rows into normalized workouts. */
export function csvRowsToWorkouts(rows) {
  const toNum = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const parseDate = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const workouts = new Map();
  for (const row of rows) {
    const key = `${row.title}|${row.start_time}`;
    if (!workouts.has(key)) {
      workouts.set(key, {
        name: row.title || 'Entreno',
        startedAt: parseDate(row.start_time),
        finishedAt: parseDate(row.end_time),
        notes: row.description || null,
        _exerciseOrder: [],
        _exercises: new Map(),
      });
    }
    const w = workouts.get(key);

    const exKey = `${row.exercise_title}#${row.superset_id}`;
    if (!w._exercises.has(exKey)) {
      const ex = {
        name: row.exercise_title,
        notes: row.exercise_notes || null,
        supersetId:
          row.superset_id === '' || row.superset_id == null
            ? null
            : row.superset_id,
        sets: [],
      };
      w._exercises.set(exKey, ex);
      w._exerciseOrder.push(exKey);
    }
    w._exercises.get(exKey).sets.push({
      weightKg: toNum(row.weight_kg),
      reps: toNum(row.reps),
    });
  }

  return [...workouts.values()]
    .map((w) => ({
      name: w.name,
      startedAt: w.startedAt,
      finishedAt: w.finishedAt,
      notes: w.notes,
      exercises: w._exerciseOrder.map((k) => w._exercises.get(k)),
    }))
    .filter((w) => w.startedAt)
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
}
