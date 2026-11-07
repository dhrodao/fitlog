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
    process.env.ALLOW_DEV_LOGIN === 'true' && nodeEnv !== 'production',
  // Access control: only these verified Google emails may create/use an
  // account. Empty + allowAnyGoogleUser=false means Google login is locked.
  allowedEmails: (process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  // Explicit opt-in to accept ANY verified Google account (public instance).
  allowAnyGoogleUser: process.env.ALLOW_ANY_GOOGLE_USER === 'true',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  publicUrl: (process.env.PUBLIC_URL || '').trim().replace(/\/$/, ''),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  catalogSyncDays: Number(process.env.CATALOG_SYNC_DAYS || 14),
  hevy: {
    // Per-request timeout (ms) for every Hevy HTTP call. A hung request must
    // never block the scheduler indefinitely.
    requestTimeoutMs: Number(process.env.HEVY_REQUEST_TIMEOUT_MS || 20000),
    // How many times to retry a retriable read (429/5xx/network). The first
    // attempt is not a retry, so N retries means up to N+1 total attempts.
    maxRetries: Number(process.env.HEVY_MAX_RETRIES || 3),
    // Base backoff (ms) for the exponential schedule (base, 2x, 4x…) + jitter.
    retryBackoffMs: Number(process.env.HEVY_RETRY_BACKOFF_MS || 500),
  },
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

// In production, refuse to boot with Google login enabled but no access policy:
// otherwise any Google account could create a user on a publicly reachable
// instance. Either list ALLOWED_EMAILS or opt in explicitly with
// ALLOW_ANY_GOOGLE_USER=true.
if (
  config.isProduction &&
  config.googleClientId &&
  config.allowedEmails.length === 0 &&
  !config.allowAnyGoogleUser
) {
  throw new Error(
    '[config] El login con Google está activo sin política de acceso. Define ' +
      'ALLOWED_EMAILS (lista separada por comas) para limitar quién puede ' +
      'entrar, o ALLOW_ANY_GOOGLE_USER=true para abrir la instancia a ' +
      'cualquier cuenta de Google de forma explícita.'
  );
}

export default config;
