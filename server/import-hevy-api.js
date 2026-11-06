import { db } from './db.js';
import { linkUserExercises, normalizeExerciseName } from './catalog.js';
import { importWorkout } from './hevy-import.js';
import { HevyClient, hevyApiWorkoutToNormalized } from './hevy-client.js';

/**
 * Import workouts from the Hevy public API into Fitlog.
 *
 * Usage:
 *   node server/import-hevy-api.js --user <id> [--api-key KEY] [--write] [--limit N]
 *
 * The API key can also come from the HEVY_API_KEY environment variable.
 * Runs as a DRY RUN by default; pass --write to persist.
 */

function parseArgs(argv) {
  const args = { user: null, apiKey: null, write: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--user') args.user = Number(argv[++i]);
    else if (a === '--api-key') args.apiKey = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Build a map: Hevy template name -> catalog id (only confident matches). */
function buildTemplateMap(templates) {
  const catalog = db.prepare('SELECT id, name FROM exercise_catalog').all();
  const byNorm = new Map();
  for (const row of catalog) {
    const norm = normalizeExerciseName(row.name);
    if (!byNorm.has(norm)) byNorm.set(norm, row.id);
  }
  const map = new Map();
  for (const t of templates) {
    const name = t.title;
    if (!name) continue;
    const id = byNorm.get(normalizeExerciseName(name));
    if (id) map.set(name, id);
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = args.apiKey || process.env.HEVY_API_KEY;

  if (!Number.isInteger(args.user)) fail('Debes indicar un usuario con --user <id>.');
  if (!apiKey) {
    fail('Falta la API key: usa --api-key KEY o la variable HEVY_API_KEY.');
  }

  const user = db
    .prepare('SELECT id, name, email FROM users WHERE id = ?')
    .get(args.user);
  if (!user) fail(`No existe el usuario con id ${args.user}.`);

  const client = new HevyClient(apiKey);

  console.log(`Usuario: ${user.name} (id ${user.id}, ${user.email})`);
  console.log(args.write ? 'Modo: ESCRITURA' : 'Modo: DRY-RUN (sin cambios)');
  console.log('Conectando con la API de Hevy…');

  let count = null;
  try {
    count = await client.workoutCount();
    console.log(`Entrenos en Hevy: ${count}`);
  } catch (err) {
    fail(`No se pudo autenticar con la API de Hevy: ${err.message}`);
  }

  // Fetch exercise templates to map names to the local catalog reliably.
  const templates = [];
  try {
    for await (const t of client.exerciseTemplates()) templates.push(t);
    console.log(`Plantillas de ejercicio descargadas: ${templates.length}`);
  } catch (err) {
    console.warn(`Aviso: no se pudieron leer las plantillas (${err.message}).`);
  }
  const templateMap = buildTemplateMap(templates);

  // Collect workouts.
  const workouts = [];
  for await (const w of client.workouts()) {
    workouts.push(hevyApiWorkoutToNormalized(w));
    if (args.limit && workouts.length >= args.limit) break;
  }
  workouts.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  console.log(`Entrenos descargados: ${workouts.length}`);
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
        const res = importWorkout(user.id, workout, { templateMap });
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
        totals.imported += 1;
        totals.exercises += workout.exercises.length;
        totals.sets += workout.exercises.reduce((n, e) => n + e.sets.length, 0);
      }
    }
  };

  if (args.write) {
    db.transaction(run)();
    linkUserExercises();
  } else {
    run();
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
