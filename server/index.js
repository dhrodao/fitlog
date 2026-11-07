import { createApp } from './app.js';
import config from './config.js';
import { db } from './db.js';
import { syncCatalog, getCatalogStatus } from './catalog.js';
import { startSyncScheduler } from './hevy-sync.js';
import { logger } from './logger.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server listening', {
    url: `http://localhost:${config.port}`,
    env: config.nodeEnv,
  });

  const status = getCatalogStatus();
  // When the catalog was seeded from Hevy, never auto-sync from
  // free-exercise-db on boot: that would silently replace the chosen catalog.
  // Re-seed explicitly with `npm run seed:hevy-catalog` to refresh it.
  if (status.source === 'hevy') {
    logger.info('catalog cached (hevy source)', { count: status.count });
  } else if (status.count === 0 || status.stale) {
    logger.info('catalog sync starting in background');
    syncCatalog({ force: true })
      .then((result) => {
        logger.info('catalog sync done', {
          count: result.count,
          linked: result.linked,
        });
      })
      .catch((error) => {
        logger.warn('catalog sync failed', { err: error });
      });
  } else {
    logger.info('catalog cached', { count: status.count });
  }

  startSyncScheduler({ intervalHours: 6 });
  logger.info('hevy sync scheduler active', { intervalHours: 6 });
});

// Graceful shutdown: on SIGTERM/SIGINT stop accepting connections, let in-flight
// requests drain, then close the database so SQLite can checkpoint the WAL
// cleanly (a hard kill can leave a -wal sidecar that the next boot must replay).
// A timeout force-exits if something hangs, so a stuck request never blocks the
// container from stopping.
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown requested', { signal });

  const forceTimer = setTimeout(() => {
    logger.error('shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
  // Do not let the timer itself keep the event loop alive.
  forceTimer.unref();

  server.close((err) => {
    if (err) {
      logger.error('error while closing HTTP server', { err });
    }
    try {
      db.close();
      logger.info('database closed, exiting cleanly');
    } catch (dbErr) {
      logger.error('error while closing database', { err: dbErr });
    }
    clearTimeout(forceTimer);
    process.exit(err ? 1 : 0);
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => shutdown(signal));
}
