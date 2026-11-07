// Hevy import identity and idempotency tests.
//
// These lock in the fix for the previous (name, started_at) duplicate check:
// imported workouts now carry a stable Hevy id, so re-syncing updates in place,
// renames do not duplicate, and CSV/legacy imports (no id) still de-duplicate
// by name and time.

import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';
import { loginDev } from './helpers/fixtures.js';

setupTestEnv();
const { app, db } = await createTestApp();
const { importWorkout } = await import('../server/hevy-import.js');
const { hevyApiWorkoutToNormalized } = await import('../server/hevy-client.js');
const { default: request } = await import('supertest');

// A minimal Hevy API workout object (as returned by /v1/workouts).
function hevyWorkout(overrides = {}) {
  return {
    id: 'hevy-abc-123',
    title: 'Push Day',
    start_time: '2026-01-10T09:00:00.000Z',
    end_time: '2026-01-10T10:00:00.000Z',
    description: null,
    exercises: [
      {
        index: 0,
        title: 'Bench Press (Barbell)',
        exercise_template_id: null,
        superset_id: null,
        sets: [
          { index: 0, weight_kg: 60, reps: 10 },
          { index: 1, weight_kg: 60, reps: 8 },
        ],
      },
    ],
    ...overrides,
  };
}

function countWorkouts(userId) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM workouts WHERE user_id = ? AND source = 'hevy'")
    .get(userId).c;
}

function getWorkout(userId, hevyId) {
  return db
    .prepare('SELECT * FROM workouts WHERE user_id = ? AND hevy_workout_id = ?')
    .get(userId, hevyId);
}

let userId;

test('Hevy import identity and idempotency', async (t) => {
  // Dev login creates/returns the dev user; use its id for the import calls.
  const agent = request.agent(app);
  const user = await loginDev(agent);
  userId = user.id;

  await t.test('importing the same workout twice yields one row', () => {
    const normalized = hevyApiWorkoutToNormalized(hevyWorkout());
    const first = importWorkout(userId, normalized);
    assert.equal(first.skipped, false);
    assert.equal(first.updated, false, 'first import is an insert');

    const second = importWorkout(userId, hevyApiWorkoutToNormalized(hevyWorkout()));
    assert.equal(second.skipped, false);
    assert.equal(second.updated, true, 're-import updates in place');

    assert.equal(countWorkouts(userId), 1, 'exactly one imported workout');
  });

  await t.test('an updated workout applies changed sets and notes', () => {
    const updated = hevyWorkout({
      description: 'felt strong',
      exercises: [
        {
          index: 0,
          title: 'Bench Press (Barbell)',
          exercise_template_id: null,
          superset_id: null,
          sets: [
            { index: 0, weight_kg: 65, reps: 10 },
            { index: 1, weight_kg: 65, reps: 9 },
            { index: 2, weight_kg: 65, reps: 8 },
          ],
        },
      ],
    });
    importWorkout(userId, hevyApiWorkoutToNormalized(updated));

    assert.equal(countWorkouts(userId), 1, 'still one workout');
    const row = getWorkout(userId, 'hevy-abc-123');
    assert.equal(row.notes, 'felt strong', 'notes updated');

    const sets = db
      .prepare(
        `SELECT s.weight_kg, s.reps FROM workout_sets s
           JOIN workout_exercises we ON we.id = s.workout_exercise_id
          WHERE we.workout_id = ? ORDER BY s.set_number`
      )
      .all(row.id);
    assert.equal(sets.length, 3, 'set count updated from 2 to 3');
    assert.equal(sets[0].weight_kg, 65, 'weight updated');
  });

  await t.test('renaming a workout does not create a duplicate', () => {
    const renamed = hevyWorkout({ title: 'Push Day (renamed)' });
    importWorkout(userId, hevyApiWorkoutToNormalized(renamed));

    assert.equal(countWorkouts(userId), 1, 'rename updates, does not duplicate');
    const row = getWorkout(userId, 'hevy-abc-123');
    assert.equal(row.name, 'Push Day (renamed)', 'name updated');
  });

  await t.test('a workout with a different Hevy id is a separate row', () => {
    const other = hevyWorkout({ id: 'hevy-xyz-999', title: 'Pull Day' });
    importWorkout(userId, hevyApiWorkoutToNormalized(other));
    assert.equal(countWorkouts(userId), 2, 'distinct id creates a new workout');
  });

  await t.test('CSV/legacy workouts (no Hevy id) de-duplicate by name+time', () => {
    const noId = {
      name: 'Legacy CSV workout',
      startedAt: '2026-02-01T09:00:00.000Z',
      finishedAt: null,
      notes: null,
      exercises: [],
    };
    const first = importWorkout(userId, noId);
    assert.equal(first.skipped, false);
    const second = importWorkout(userId, { ...noId });
    assert.equal(second.skipped, true, 'same name+time is skipped as duplicate');
    assert.equal(second.reason, 'duplicate');
  });

  await t.test('a legacy row (no id) is adopted by a later API sync, not duplicated', () => {
    // Simulate a workout imported before stable ids: source 'hevy', id NULL.
    const legacyName = 'Legacy adopt me';
    const legacyStart = '2026-03-15T09:00:00.000Z';
    db.prepare(
      `INSERT INTO workouts (user_id, name, started_at, source, hevy_workout_id, created_at)
       VALUES (?, ?, ?, 'hevy', NULL, ?)`
    ).run(userId, legacyName, legacyStart, new Date().toISOString());

    const before = countWorkouts(userId);

    // The same workout now arrives from the API with a stable id.
    const fromApi = hevyWorkout({
      id: 'hevy-legacy-match',
      title: legacyName,
      start_time: legacyStart,
      end_time: null,
    });
    const res = importWorkout(userId, hevyApiWorkoutToNormalized(fromApi));

    assert.equal(res.updated, true, 'the legacy row is adopted and updated');
    assert.equal(countWorkouts(userId), before, 'no duplicate created');
    const adopted = getWorkout(userId, 'hevy-legacy-match');
    assert.ok(adopted, 'the legacy row now carries the Hevy id');
    assert.equal(adopted.name, legacyName);
  });
});

test.after(() => cleanupTestApp(db));
