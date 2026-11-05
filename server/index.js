import { createApp } from './app.js';
import config from './config.js';
import { syncCatalog, getCatalogStatus } from './catalog.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(
    `[fitness-app] escuchando en http://localhost:${config.port} (${config.nodeEnv})`
  );

  const status = getCatalogStatus();
  if (status.count === 0 || status.stale) {
    console.log(
      '[catálogo] sincronizando free-exercise-db en segundo plano...'
    );
    syncCatalog({ force: true })
      .then((result) => {
        console.log(
          `[catálogo] ${result.count} ejercicios disponibles · ${result.linked} propios enlazados`
        );
      })
      .catch((error) => {
        console.warn('[catálogo] no se pudo sincronizar:', error.message);
      });
  } else {
    console.log(`[catálogo] en caché: ${status.count} ejercicios`);
  }
});
