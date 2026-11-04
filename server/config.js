import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const nodeEnv = process.env.NODE_ENV || 'development';

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
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret',
  allowDevLogin:
    process.env.ALLOW_DEV_LOGIN !== 'false' && nodeEnv !== 'production',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  wgerBase: 'https://wger.de/api/v2',
  wgerSyncDays: Number(process.env.WGER_SYNC_DAYS || 14),
};

if (config.isProduction && !config.googleClientId) {
  console.warn(
    '[config] GOOGLE_CLIENT_ID no está definido: el login con Google no funcionará.'
  );
}

export default config;
