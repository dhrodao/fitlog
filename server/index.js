import { createApp } from './app.js';
import config from './config.js';
import { syncWger, getWgerStatus } from './wger.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(
    `[fitness-app] escuchando en http://localhost:${config.port} (${config.nodeEnv})`
  );

  const status = getWgerStatus();
  if (status.count === 0 || status.stale) {
    console.log('[wger] sincronizando catálogo de ejercicios en segundo plano...');
    syncWger({ force: true })
      .then((result) => {
        console.log(`[wger] ${result.count} ejercicios disponibles`);
      })
      .catch((error) => {
        console.warn('[wger] no se pudo sincronizar:', error.message);
      });
  } else {
    console.log(`[wger] catálogo en caché: ${status.count} ejercicios`);
  }
});
