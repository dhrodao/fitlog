import { syncWger } from './wger.js';

try {
  console.log('Sincronizando catálogo de ejercicios desde wger.de...');
  const result = await syncWger({ force: true });
  console.log(
    `Listo: ${result.count} ejercicios (${result.pages} páginas) · ${result.syncedAt}`
  );
  process.exit(0);
} catch (error) {
  console.error('Error sincronizando wger:', error.message);
  process.exit(1);
}
