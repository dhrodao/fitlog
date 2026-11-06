import fs from 'node:fs';
import { db } from './db.js';
import { linkUserExercises } from './catalog.js';
import {
  parseCsvObjects,
  csvRowsToWorkouts,
  importWorkout,
} from './hevy-import.js';

/**
 * Import a Hevy CSV export (Settings -> Export Data) into Fitlog.
 *
 * Usage:
 *   node server/import-hevy-csv.js <file.csv> --user <id> [--write] [--limit N]
 *
 * By default it runs as a DRY RUN (no changes). Pass --write to persist.
 */

function parseArgs(argv) {
  const args = { file: null, user: null, write: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--user') args.user = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (!a.startsWith('--') && !args.file) args.file = a;
  }
  return args;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file) {
    fail(
      'Debes indicar la ruta del CSV.\n' +
        'Uso: node server/import-hevy-csv.js <file.csv> --user <id> [--write] [--limit N]'
    );
  }
  if (!fs.existsSync(args.file)) fail(`No existe el archivo: ${args.file}`);
  if (!Number.isInteger(args.user)) {
    fail('Debes indicar un usuario con --user <id>.');
  }

  const user = db
    .prepare('SELECT id, name, email FROM users WHERE id = ?')
    .get(args.user);
  if (!user) fail(`No existe el usuario con id ${args.user}.`);

  const text = fs.readFileSync(args.file, 'utf8');
  const rows = parseCsvObjects(text);
  if (!rows.length) fail('El CSV no tiene filas de datos.');

  const required = ['title', 'start_time', 'exercise_title', 'weight_kg', 'reps'];
  const missing = required.filter((c) => !(c in rows[0]));
  if (missing.length) {
    fail(`El CSV no parece de Hevy. Faltan columnas: ${missing.join(', ')}`);
  }

  let workouts = csvRowsToWorkouts(rows);
  if (args.limit) workouts = workouts.slice(0, args.limit);

  console.log(`Usuario: ${user.name} (id ${user.id}, ${user.email})`);
  console.log(`Filas (series) en el CSV: ${rows.length}`);
  console.log(`Entrenos detectados: ${workouts.length}`);
  console.log(args.write ? 'Modo: ESCRITURA' : 'Modo: DRY-RUN (sin cambios)');
  console.log('─'.repeat(50));

  const totals = {
    imported: 0,
    skipped: 0,
    duplicates: 0,
    exercises: 0,
    sets: 0,
    custom: 0,
    matched: 0,
  };

  const run = () => {
    for (const workout of workouts) {
      if (args.write) {
        const res = importWorkout(user.id, workout);
        if (res.skipped) {
          totals.skipped += 1;
          if (res.reason === 'duplicate') totals.duplicates += 1;
        } else {
          totals.imported += 1;
          totals.exercises += res.exercises;
          totals.sets += res.sets;
          totals.custom += res.custom;
          totals.matched += res.matched;
        }
      } else {
        // Dry run: only report what would happen.
        totals.imported += 1;
        totals.exercises += workout.exercises.length;
        totals.sets += workout.exercises.reduce((n, e) => n + e.sets.length, 0);
      }
    }
  };

  if (args.write) {
    db.transaction(run)();
  } else {
    run();
  }

  if (args.write) {
    // Attach catalog images/links to any newly created custom exercises.
    linkUserExercises();
  }

  console.log('Resumen:');
  if (args.write) {
    console.log(`  Entrenos importados: ${totals.imported}`);
    console.log(
      `  Entrenos omitidos:   ${totals.skipped} (duplicados: ${totals.duplicates})`
    );
    console.log(`  Ejercicios:          ${totals.exercises}`);
    console.log(
      `    - enlazados catálogo: ${totals.matched}, personalizados: ${totals.custom}`
    );
    console.log(`  Series:              ${totals.sets}`);
  } else {
    console.log(`  Entrenos a importar: ${totals.imported}`);
    console.log(`  Ejercicios totales:  ${totals.exercises}`);
    console.log(`  Series totales:      ${totals.sets}`);
    console.log('\n  (Vuelve a ejecutar con --write para aplicar los cambios)');
  }
}

main();
