import { db, nowIso, getMeta, setMeta } from './db.js';
import { ensureDevUser } from './auth.js';
import { linkUserExercises } from './catalog.js';

const SEED_KEY = 'demo_seed_v2';
const force = process.argv.includes('--force');

function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261104);
const jitter = (values) => values[Math.floor(random() * values.length)];

const EXERCISES = [
  ['Press banca con barra', 'Pecho', 60],
  ['Sentadilla con barra', 'Piernas', 85],
  ['Peso muerto convencional', 'Espalda', 105],
  ['Peso muerto rumano', 'Piernas', 75],
  ['Press militar con barra', 'Hombros', 35],
  ['Remo con barra', 'Espalda', 55],
  ['Dominadas', 'Espalda', 0],
  ['Jalón al pecho', 'Espalda', 50],
  ['Curl con mancuernas', 'Bíceps', 12],
  ['Extensión de tríceps en polea', 'Tríceps', 25],
  ['Elevaciones laterales', 'Hombros', 8],
  ['Prensa de piernas', 'Piernas', 130],
  ['Curl femoral', 'Piernas', 40],
  ['Elevación de gemelos', 'Piernas', 60],
  ['Fondos en paralelas', 'Pecho', 0],
  ['Face pull', 'Hombros', 20],
  ['Plancha abdominal', 'Core', 0],
];

const ROUTINES = [
  {
    name: 'Torso A',
    folder: 'PPL',
    description: 'Empuje y tirón con foco en fuerza del tren superior.',
    exercises: [
      ['Press banca con barra', 4, '6-8'],
      ['Remo con barra', 4, '8-10'],
      ['Press militar con barra', 3, '8-10'],
      ['Jalón al pecho', 3, '10-12'],
      ['Curl con mancuernas', 3, '10-12'],
      ['Extensión de tríceps en polea', 3, '12-15'],
    ],
  },
  {
    name: 'Pierna A',
    folder: 'PPL',
    description: 'Fuerza de piernas con sentadilla y peso muerto.',
    exercises: [
      ['Sentadilla con barra', 4, '6-8'],
      ['Peso muerto rumano', 3, '8-10'],
      ['Prensa de piernas', 3, '10-12'],
      ['Curl femoral', 3, '12-15'],
      ['Elevación de gemelos', 4, '15-20'],
    ],
  },
  {
    name: 'Empuje',
    folder: 'Weider',
    description: 'Pecho, hombros y tríceps.',
    exercises: [
      ['Press banca con barra', 4, '8-10'],
      ['Press militar con barra', 4, '8-10'],
      ['Fondos en paralelas', 3, '10-12'],
      ['Elevaciones laterales', 4, '12-15'],
      ['Extensión de tríceps en polea', 3, '12-15'],
    ],
  },
  {
    name: 'Tirón',
    folder: 'Weider',
    description: 'Espalda y bíceps.',
    exercises: [
      ['Dominadas', 4, '6-10'],
      ['Remo con barra', 4, '8-10'],
      ['Jalón al pecho', 3, '10-12'],
      ['Face pull', 3, '15-20'],
      ['Curl con mancuernas', 3, '10-12'],
    ],
  },
  {
    name: 'Full body express',
    folder: 'Mis rutinas',
    description: 'Sesión completa para días con poco tiempo.',
    exercises: [
      ['Sentadilla con barra', 3, '8-10'],
      ['Press banca con barra', 3, '8-10'],
      ['Remo con barra', 3, '10-12'],
      ['Press militar con barra', 3, '10-12'],
      ['Plancha abdominal', 3, '45-60 s'],
    ],
  },
];

function resetUserData(userId) {
  db.prepare('DELETE FROM measurements WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM workouts WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM routines WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM exercises WHERE user_id = ?').run(userId);
}

function ensureExercise(userId, name, category) {
  const existing = db
    .prepare('SELECT * FROM exercises WHERE user_id = ? AND name = ?')
    .get(userId, name);
  if (existing) return existing;
  const info = db
    .prepare(
      `INSERT INTO exercises (user_id, catalog_id, name, category, image_url, is_custom, created_at)
       VALUES (?, NULL, ?, ?, NULL, 1, ?)`
    )
    .run(userId, name, category, nowIso());
  return db.prepare('SELECT * FROM exercises WHERE id = ?').get(info.lastInsertRowid);
}

function roundTo(value, step = 2.5) {
  return Math.round(value / step) * step;
}

function isoAt(date, hour, minute) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute)
  ).toISOString();
}

function mondayOfWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d;
}

function seedMeasurements(userId) {
  const insert = db.prepare(
    `INSERT INTO measurements (user_id, date, weight_kg, body_fat, waist_cm, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       weight_kg = excluded.weight_kg,
       body_fat = excluded.body_fat,
       waist_cm = excluded.waist_cm,
       notes = excluded.notes`
  );

  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 84);

  let count = 0;
  for (let week = 0; week <= 12; week += 1) {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + week * 7);
    if (date > today) break;

    const weight = 84.2 - week * 0.32 + (random() - 0.5) * 0.6;
    const bodyFat = 19.4 - week * 0.22 + (random() - 0.5) * 0.3;
    const waist = 90.5 - week * 0.42 + (random() - 0.5) * 0.5;
    insert.run(
      userId,
      date.toISOString().slice(0, 10),
      Math.round(weight * 10) / 10,
      Math.round(bodyFat * 10) / 10,
      Math.round(waist * 10) / 10,
      week === 0 ? 'Punto de partida' : null,
      isoAt(date, 7, 30)
    );
    count += 1;
  }
  return count;
}

function seedWorkouts(userId, exerciseMap, routineMap) {
  const today = new Date();
  const currentMonday = mondayOfWeek(today);
  const firstMonday = new Date(currentMonday);
  firstMonday.setUTCDate(firstMonday.getUTCDate() - 12 * 7);

  const sessionOffsets = [0, 2, 4];
  const insertWorkout = db.prepare(
    `INSERT INTO workouts (user_id, routine_id, name, location, notes, started_at, finished_at, duration_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertWorkoutExercise = db.prepare(
    `INSERT INTO workout_exercises (workout_id, exercise_id, position, notes)
     VALUES (?, ?, ?, ?)`
  );
  const insertSet = db.prepare(
    `INSERT INTO workout_sets (workout_exercise_id, set_number, weight_kg, reps, completed, rest_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let workouts = 0;
  let sets = 0;

  for (let week = 0; week < 12; week += 1) {
    const monday = new Date(firstMonday);
    monday.setUTCDate(monday.getUTCDate() + week * 7);

    for (let session = 0; session < sessionOffsets.length; session += 1) {
      if (week === 0 && session === 0) continue;
      if (week % 5 === 3 && session === 2) continue;

      const day = new Date(monday);
      day.setUTCDate(day.getUTCDate() + sessionOffsets[session]);
      const startedAt = isoAt(day, 18, 15 + session * 10);
      if (new Date(startedAt).getTime() > today.getTime()) continue;

      const routine = ROUTINES[(week * 3 + session) % ROUTINES.length];
      const routineId = routineMap.get(routine.name);
      const duration = 3000 + Math.round(random() * 1200);
      const finishedAt = new Date(
        new Date(startedAt).getTime() + duration * 1000
      ).toISOString();
      const progress = week / 11;

      const workoutInfo = insertWorkout.run(
        userId,
        routineId,
        routine.name,
        session === 1 ? 'Gimnasio' : 'Casa',
        week === 11 && session === 1 ? 'Buenas sensaciones, subir carga la próxima semana.' : null,
        startedAt,
        finishedAt,
        duration,
        startedAt
      );
      const workoutId = workoutInfo.lastInsertRowid;

      routine.exercises.forEach(([name, targetSets, targetReps], index) => {
        const exercise = exerciseMap.get(name);
        const weInfo = insertWorkoutExercise.run(workoutId, exercise.id, index, null);
        const workoutExerciseId = weInfo.lastInsertRowid;
        const base = EXERCISES.find((item) => item[0] === name)?.[2] || 0;
        const target = Number(String(targetReps).match(/\d+/)?.[0] || 10);
        const setCount = targetSets + (random() < 0.2 ? 1 : 0);

        for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
          const wave = jitter([-2.5, 0, 0, 2.5]);
          const weight =
            base === 0
              ? null
              : Math.max(
                  2.5,
                  roundTo(base * (1 + progress * 0.16) + wave + setIndex * 1.25)
                );
          const reps = Math.max(
            5,
            target - setIndex + (random() < 0.25 ? 1 : 0)
          );
          const completed = setIndex === setCount - 1 && random() < 0.08 ? 0 : 1;
          insertSet.run(
            workoutExerciseId,
            setIndex + 1,
            weight,
            reps,
            completed,
            base >= 50 ? 120 : 90,
            finishedAt
          );
          sets += 1;
        }
      });

      workouts += 1;
    }
  }

  return { workouts, sets };
}

function main() {
  const user = ensureDevUser();
  const existing = getMeta(SEED_KEY);

  if (existing && !force) {
    console.log(
      `[seed] Los datos de demo ya existen (usuario ${user.name}). Usa "npm run seed:demo -- --force" para regenerarlos.`
    );
    return;
  }

  const run = db.transaction(() => {
    if (existing) resetUserData(user.id);

    const exerciseMap = new Map();
    for (const [name, category] of EXERCISES) {
      exerciseMap.set(name, ensureExercise(user.id, name, category));
    }

    const routineMap = new Map();
    const insertRoutine = db.prepare(
      `INSERT INTO routines (user_id, name, description, folder, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertRoutineExercise = db.prepare(
      `INSERT INTO routine_exercises (routine_id, exercise_id, position, target_sets, target_reps, notes)
       VALUES (?, ?, ?, ?, ?, NULL)`
    );

    for (const routine of ROUTINES) {
      const now = nowIso();
      const info = insertRoutine.run(
        user.id,
        routine.name,
        routine.description,
        routine.folder,
        now,
        now
      );
      routineMap.set(routine.name, info.lastInsertRowid);
      routine.exercises.forEach(([name, targetSets, targetReps], index) => {
        insertRoutineExercise.run(
          info.lastInsertRowid,
          exerciseMap.get(name).id,
          index,
          targetSets,
          targetReps
        );
      });
    }

    const measurements = seedMeasurements(user.id);
    const workoutStats = seedWorkouts(user.id, exerciseMap, routineMap);
    linkUserExercises();
    setMeta(SEED_KEY, `${user.id}:${nowIso()}`);

    return { measurements, routines: ROUTINES.length, ...workoutStats };
  });

  const result = run();
  console.log(
    `[seed] Datos de demo listos para "${user.name}": ${result.routines} rutinas, ${result.workouts} entrenos, ${result.sets} series, ${result.measurements} medidas.`
  );
}

try {
  main();
} catch (error) {
  console.error('[seed] Error:', error.message);
  process.exitCode = 1;
}
