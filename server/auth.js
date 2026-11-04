import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { db, nowIso } from './db.js';
import config from './config.js';

export const COOKIE_NAME = 'fit_session';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(
    Date.now() + config.sessionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).run(hashToken(token), userId, nowIso(), expiresAt);

  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());

  return { token, expiresAt };
}

export function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    isDev: Boolean(row.is_dev),
  };
}

export function userFromRequest(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.*, s.expires_at AS session_expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(token));

  if (!row) return null;

  if (new Date(row.session_expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }

  return row;
}

export function attachUser(req, _res, next) {
  req.user = userFromRequest(req);
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
  });
}

export async function verifyGoogleCredential(credential) {
  if (!config.googleClientId) {
    throw new Error('El login con Google no está configurado');
  }

  const client = new OAuth2Client(config.googleClientId);
  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: config.googleClientId,
  });

  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error('Token de Google inválido');
  return payload;
}

export function upsertGoogleUser(payload) {
  const existing = db
    .prepare('SELECT * FROM users WHERE google_sub = ?')
    .get(payload.sub);

  if (existing) {
    db.prepare(
      'UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?'
    ).run(
      payload.email || existing.email,
      payload.name || existing.name,
      payload.picture || existing.picture,
      existing.id
    );
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  }

  const info = db
    .prepare(
      'INSERT INTO users (google_sub, email, name, picture, is_dev, created_at) VALUES (?, ?, ?, ?, 0, ?)'
    )
    .run(
      payload.sub,
      payload.email || null,
      payload.name || payload.email || 'Atleta',
      payload.picture || null,
      nowIso()
    );

  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function ensureDevUser() {
  const email = 'dev@local';
  let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get('dev:local');
  if (!user) {
    const info = db
      .prepare(
        'INSERT INTO users (google_sub, email, name, picture, is_dev, created_at) VALUES (?, ?, ?, ?, 1, ?)'
      )
      .run('dev:local', email, 'Atleta Demo', null, nowIso());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  }
  return user;
}
