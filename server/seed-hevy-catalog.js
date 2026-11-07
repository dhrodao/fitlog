import path from 'node:path';
import { config } from './config.js';
import { seedCatalogFromDump } from './hevy-catalog-seed.js';

/**
 * Seed the app's exercise_catalog from a Hevy dump that already exists on disk
 * (written by dump-hevy-catalog.js). Needs no Hevy API key, so it still works
 * after a Hevy Pro subscription is cancelled.
 *
 * Usage:
 *   node server/seed-hevy-catalog.js [--dir DIR]
 *
 * Default DIR = data/hevy-catalog.
 */

function parseArgs(argv) {
  const args = { dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dir') args.dir = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir
    ? path.resolve(args.dir)
    : path.join(path.dirname(config.dbPath), 'hevy-catalog');

  console.log(`Cargando el catálogo de Hevy desde ${dir}…`);
  const result = await seedCatalogFromDump(dir);
  console.log(
    `Catálogo actualizado: ${result.count} ejercicios · ` +
      `${result.linked} ejercicios propios enlazados.`
  );
  if (result.problems?.length) {
    console.warn(`Avisos (${result.problems.length}):`);
    for (const p of result.problems) console.warn(`- ${p}`);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
