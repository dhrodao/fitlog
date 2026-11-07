-- Enforce positional/ordinal uniqueness invariants that until now lived only in
-- application code. Existing databases may already contain duplicate positions
-- or set numbers (e.g. from interrupted writes), so each group is renumbered
-- deterministically BEFORE the unique index is created, otherwise the index
-- creation would fail.
--
-- Renumbering is stable: rows keep their relative order (by the old ordinal,
-- then by id) and are reassigned a dense 0-based sequence per parent.

-- workout_sets.set_number must be unique within a workout_exercise.
UPDATE workout_sets
SET set_number = seq.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY workout_exercise_id
           ORDER BY set_number, id
         ) AS rn
  FROM workout_sets
) AS seq
WHERE workout_sets.id = seq.id
  AND workout_sets.set_number <> seq.rn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sets_we_number
  ON workout_sets(workout_exercise_id, set_number);

-- workout_exercises.position must be unique within a workout.
UPDATE workout_exercises
SET position = seq.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY workout_id
           ORDER BY position, id
         ) - 1 AS rn
  FROM workout_exercises
) AS seq
WHERE workout_exercises.id = seq.id
  AND workout_exercises.position <> seq.rn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_we_workout_position
  ON workout_exercises(workout_id, position);

-- routine_exercises.position must be unique within a routine.
UPDATE routine_exercises
SET position = seq.rn
FROM (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY routine_id
           ORDER BY position, id
         ) - 1 AS rn
  FROM routine_exercises
) AS seq
WHERE routine_exercises.id = seq.id
  AND routine_exercises.position <> seq.rn;

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_exercises_position
  ON routine_exercises(routine_id, position);
