import { syncCatalog } from './catalog.js';

try {
  console.log('Sincronizando catálogo desde free-exercise-db...');
  const result = await syncCatalog({ force: true });

  console.log(
    `Listo: ${result.count} ejercicios · ${result.linked} ejercicios propios enlazados · ${result.syncedAt}`
  );

  if (result.problems.length > 0) {
    console.warn(`Avisos (${result.problems.length}):`);
    for (const problem of result.problems) console.warn(`- ${problem}`);
  }

  process.exit(0);
} catch (error) {
  console.error('Error sincronizando:', error.message);
  process.exit(1);
}
