import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const nodeEnv = process.env.NODE_ENV || 'development';

// Default secret used only in development. Production must set its own strong
// SESSION_SECRET; booting with this value in production is refused below.
const INSECURE_SESSION_SECRET = 'dev-insecure-secret';

function resolveDbPath(value) {
  if (!value) return path.join(root, 'data', 'fitness.db');
  return path.isAbsolute(value) ? value : path.join(root, value);
}

export const config = {
  root,
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: Number(process.env.PORT || 3000),
  dbPath: resolveDbPath(process.env.DB_PATH),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  sessionSecret: process.env.SESSION_SECRET || INSECURE_SESSION_SECRET,
  allowDevLogin:
    process.env.ALLOW_DEV_LOGIN !== 'false' && nodeEnv !== 'production',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/$/, ''),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  catalogSyncDays: Number(process.env.CATALOG_SYNC_DAYS || 14),
};

if (config.isProduction && !config.googleClientId) {
  console.warn(
    '[config] GOOGLE_CLIENT_ID no está definido: el login con Google no funcionará.'
  );
}

if (config.isProduction && config.sessionSecret === INSECURE_SESSION_SECRET) {
  throw new Error(
    '[config] SESSION_SECRET no está definido (o usa el valor inseguro por ' +
      'defecto). Define un SESSION_SECRET fuerte en producción: protege las ' +
      'sesiones y cifra la API key de Hevy en reposo.'
  );
}

export default config;
