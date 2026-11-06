import { db, nowIso } from './db.js';
import { normalizeName } from './catalog.js';
import { resolveHevyExercise } from './hevy-import.js';

/**
 * Import Hevy routines into the local `routines` table.
 *
 * A "normalized routine" is the object produced by
 * hevyApiRoutineToNormalized() in hevy-client.js:
 * {
 *   hevyRoutineId: string,
 *   name: string,
 *   folderId: number|null,
 *   updatedAt: string|null,
 *   exercises: [
 *     { name, templateId, notes, targetSets, targetReps }
 *   ]
 * }
 *
 * Imported routines are tagged with source='hevy' and keyed by
 * hevy_routine_id so re-syncing updates the same routine instead of
 * duplicating it (idempotent upsert). Exercises are resolved to the local
 * catalogue the same way workouts are (by Hevy template id, then by name).
 */

/** Build a map of Hevy folder id -> folder title for the current user sync. */
export function foldersToMap(folders) {
  const map = new Map();
  for (const f of folders || []) {
    if (f?.id == null) continue;
    map.set(String(f.id), f.title || null);
  }
  return map;
}

function clampTargetSets(n) {
  const v = Number(n) || 1;
  return Math.min(Math.max(v, 1), 20);
}

function cleanTargetReps(value) {
  if (!value) return '8-12';
  return String(value).slice(0, 40);
}

/**
 * Upsert a single normalized routine for a user. Returns a result object:
 * { imported|updated: true, name, exercises, matched, custom } or
 * { skipped: true, reason }.
 */
export function importRoutine(userId, routine, { templateMap = null, folderMap = null } = {}) {
  const hevyRoutineId = routine.hevyRoutineId;
  if (!hevyRoutineId) return { skipped: true, reason: 'missing-id' };

  const name = String(routine.name || 'Rutina').slice(0, 120);
  const folder =
    routine.folderId != null && folderMap
      ? folderMap.get(String(routine.folderId)) || null
      : null;
  const now = nowIso();

  const run = db.transaction(() => {
    const existing = db
      .prepare(
        'SELECT * FROM routines WHERE user_id = ? AND hevy_routine_id = ?'
      )
      .get(userId, hevyRoutineId);

    let routineId;
    let updated = false;
    if (existing) {
      updated = true;
      db.prepare(
        `UPDATE routines
           SET name = ?, folder = ?, source = 'hevy', updated_at = ?
         WHERE id = ?`
      ).run(name, folder, now, existing.id);
      routineId = existing.id;
      // Replace the exercise list wholesale (same approach as the manual editor).
      db.prepare('DELETE FROM routine_exercises WHERE routine_id = ?').run(routineId);
    } else {
      const info = db
        .prepare(
          `INSERT INTO routines
             (user_id, name, description, folder, source, hevy_routine_id, created_at, updated_at)
           VALUES (?, ?, NULL, ?, 'hevy', ?, ?, ?)`
        )
        .run(userId, name, folder, hevyRoutineId, now, now);
      routineId = info.lastInsertRowid;
    }

    const insert = db.prepare(
      `INSERT INTO routine_exercises
         (routine_id, exercise_id, position, target_sets, target_reps, notes)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const stats = { exercises: 0, matched: 0, custom: 0 };
    let position = 0;
    for (const ex of routine.exercises || []) {
      const resolved = resolveHevyExercise(userId, ex.name, {
        templateMap,
        templateId: ex.templateId,
      });
      if (!resolved) continue;
      if (resolved.source === 'custom' || resolved.source === 'template-custom') {
        stats.custom += 1;
      } else {
        stats.matched += 1;
      }
      insert.run(
        routineId,
        resolved.row.id,
        position,
        clampTargetSets(ex.targetSets),
        cleanTargetReps(ex.targetReps),
        ex.notes ? String(ex.notes).slice(0, 1000) : null
      );
      position += 1;
      stats.exercises += 1;
    }

    // Link imported Hevy workouts to this routine by matching the (normalized)
    // name. Hevy's API does not tell us which routine a workout came from, so
    // we rely on the title, which in Hevy is usually the routine name. Only
    // Hevy-imported workouts are touched (never manual ones), and only when the
    // workout is unlinked or already pointed at an imported routine.
    const linked = linkImportedWorkoutsToRoutine(userId, routineId, name);

    return { routineId, updated, linked, ...stats };
  });

  const res = run();
  return {
    [res.updated ? 'updated' : 'imported']: true,
    name,
    exercises: res.exercises,
    matched: res.matched,
    custom: res.custom,
    linked: res.linked,
  };
}

/**
 * Point every Hevy-imported workout whose name matches `routineName`
 * (normalized) at `routineId`. Returns how many workouts were linked.
 * Safe to re-run: it only (re)assigns Hevy workouts that are unlinked or
 * already attached to an imported routine, so manual routine links are
 * never overwritten.
 */
export function linkImportedWorkoutsToRoutine(userId, routineId, routineName) {
  const target = normalizeName(routineName);
  if (!target) return 0;

  const candidates = db
    .prepare(
      `SELECT w.id, w.name, w.routine_id, r.source AS routine_source
         FROM workouts w
         LEFT JOIN routines r ON r.id = w.routine_id
        WHERE w.user_id = ? AND w.source = 'hevy'`
    )
    .all(userId);

  const update = db.prepare('UPDATE workouts SET routine_id = ? WHERE id = ?');
  let linked = 0;
  for (const w of candidates) {
    if (normalizeName(w.name) !== target) continue;
    // Skip if already linked to this routine, or to a non-Hevy (manual) routine.
    if (w.routine_id === routineId) continue;
    if (w.routine_id != null && w.routine_source !== 'hevy') continue;
    update.run(routineId, w.id);
    linked += 1;
  }
  return linked;
}

/** Count routines imported from Hevy for a user. */
export function countImportedRoutines(userId) {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM routines WHERE user_id = ? AND source = 'hevy'"
    )
    .get(userId);
  return row ? row.c : 0;
}

/**
 * Delete every routine imported from Hevy for a user. routine_exercises rows
 * cascade via foreign keys; exercises in the personal catalogue are preserved.
 * Returns the number of routines removed.
 */
export function deleteImportedRoutines(userId) {
  const info = db
    .prepare("DELETE FROM routines WHERE user_id = ? AND source = 'hevy'")
    .run(userId);
  return info.changes;
}
