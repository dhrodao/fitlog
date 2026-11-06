import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import config from './config.js';
import { attachUser, requireAuth } from './auth.js';
import { HttpError } from './http.js';
import authRoutes from './routes/auth.js';
import exercisesRoutes from './routes/exercises.js';
import routinesRoutes from './routes/routines.js';
import workoutsRoutes from './routes/workouts.js';
import measurementsRoutes from './routes/measurements.js';
import statsRoutes from './routes/stats.js';
import importRoutes from './routes/import.js';
import hevyWebhookRoutes from './routes/hevy-webhook.js';

export function createApp() {
  const app = express();

  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': [
            "'self'",
            'https://accounts.google.com',
            'https://accounts.google.com/gsi/client',
          ],
          'style-src': ["'self'", "'unsafe-inline'", 'https://accounts.google.com'],
          'frame-src': ["'self'", 'https://accounts.google.com'],
          'connect-src': ["'self'", 'https://accounts.google.com'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://cdn.jsdelivr.net',
            'https://*.googleusercontent.com',
            // Hevy exercise thumbnails (used as a fallback image for exercises
            // imported from Hevy that don't match the free-exercise-db catalog).
            'https://*.hevy.com',
            'https://*.hevyapp.com',
          ],
          'font-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
        },
      },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/exercises', requireAuth, exercisesRoutes);
  app.use('/api/routines', requireAuth, routinesRoutes);
  app.use('/api/workouts', requireAuth, workoutsRoutes);
  app.use('/api/measurements', requireAuth, measurementsRoutes);
  app.use('/api/stats', requireAuth, statsRoutes);
  app.use('/api/import', requireAuth, importRoutes);
  // Public: Hevy calls this; authenticated via the per-user webhook token.
  app.use('/api/hevy', hevyWebhookRoutes);

  const publicDir = path.join(config.root, 'public');
  app.use(
    express.static(publicDir, {
      extensions: ['html'],
      // The frontend assets are not content-hashed (files are always requested
      // as /js/views/home.js, etc.), so caching them makes deploys invisible
      // until the cache expires. Use no-cache: clients (and Cloudflare, which
      // honors origin Cache-Control) revalidate with ETag on every request.
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Ruta no encontrada' });
  });

  app.use((error, req, res, _next) => {
    if (error instanceof HttpError) {
      return res
        .status(error.status)
        .json({ error: error.message, details: error.details });
    }

    if (error?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'JSON inválido' });
    }

    console.error('[error]', error);
    res.status(500).json({
      error: config.isProduction
        ? 'Error interno del servidor'
        : error.message || 'Error interno del servidor',
    });
  });

  return app;
}

export default createApp;
