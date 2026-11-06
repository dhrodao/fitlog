import { db, nowIso } from './db.js';
import { normalizeExerciseName } from './catalog.js';
import { getOrCreateFromCatalog, getOrCreateByName } from './services/exercises.js';

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

/**
 * Resolve a Hevy exercise name to a Fitlog exercise row for the given user.
 * Tries, in order:
 *   1. an explicit Hevy->catalog id override (templateMap),
 *   2. exact normalized catalog name,
 *   3. catalog name after stripping the trailing "(Equipment)" suffix,
 *   4. equipment moved to the front ("Bench Press (Barbell)" ->
 *      "Barbell Bench Press"), matching free-exercise-db's naming,
 *   5. otherwise create a custom exercise keeping the original Hevy name.
 */
export function resolveHevyExercise(userId, hevyName, { templateMap = null } = {}) {
  const name = String(hevyName || '').trim();
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

/** True if a workout with the same (user, name, startedAt) already exists. */
export function workoutExists(userId, name, startedAt) {
  const row = db
    .prepare(
      'SELECT id FROM workouts WHERE user_id = ? AND name = ? AND started_at = ?'
    )
    .get(userId, name, startedAt);
  return row ? row.id : null;
}

/**
 * Persist a single normalized workout. Returns a result describing what
 * happened. Does nothing (returns {skipped:true}) if an identical workout
 * already exists, so the import is idempotent.
 */
export function importWorkout(userId, workout, { templateMap = null } = {}) {
  const name = String(workout.name || 'Entreno').slice(0, 200);
  const startedAt = workout.startedAt;
  if (!startedAt) {
    return { skipped: true, reason: 'missing-start', name };
  }

  const existingId = workoutExists(userId, name, startedAt);
  if (existingId) {
    return { skipped: true, reason: 'duplicate', name, workoutId: existingId };
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
  const run = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO workouts
           (user_id, routine_id, name, location, notes, started_at, finished_at, duration_seconds, created_at)
         VALUES (?, NULL, ?, NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        name,
        workout.notes || null,
        startedAt,
        finishedAt,
        durationSeconds,
        createdAt
      );
    const workoutId = info.lastInsertRowid;

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
        supersetCount.set(
          ex.supersetId,
          (supersetCount.get(ex.supersetId) || 0) + 1
        );
      }
    }
    const supersetGroupIds = new Map();
    let nextGroup = 1;

    workout.exercises.forEach((ex, position) => {
      const resolved = resolveHevyExercise(userId, ex.name, { templateMap });
      if (!resolved) return;
      if (resolved.source === 'custom') stats.custom += 1;
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
        insertSet.run(
          weId,
          i + 1,
          set.weightKg ?? null,
          set.reps ?? null,
          createdAt
        );
        stats.sets += 1;
      });
    });

    return { workoutId, stats };
  });

  const { workoutId, stats } = run();
  return { skipped: false, name, startedAt, workoutId, ...stats };
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
