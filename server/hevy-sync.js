import { db, nowIso } from './db.js';
import crypto from 'node:crypto';
import config from './config.js';
import { linkUserExercises, normalizeExerciseName } from './catalog.js';
import { encryptSecret, decryptSecret, maskSecret } from './crypto-box.js';
import { importWorkout } from './hevy-import.js';
import { storeTemplates } from './hevy-templates.js';
import {
  HevyClient,
  HevyApiError,
  hevyApiWorkoutToNormalized,
} from './hevy-client.js';

/**
 * Per-user synchronization with the Hevy public API.
 * Only Hevy -> Fitlog (import) is supported. Syncs are incremental via the
 * /v1/workouts/events feed and idempotent (duplicate workouts are skipped).
 */

export function getSyncRow(userId) {
  return db.prepare('SELECT * FROM hevy_sync WHERE user_id = ?').get(userId);
}

/** Public (safe) status: never returns the API key itself. */
export function getSyncStatus(userId) {
  const row = getSyncRow(userId);
  if (!row) return { connected: false };
  const key = decryptSecret(row.api_key);
  return {
    connected: true,
    autoSync: Boolean(row.auto_sync),
    keyMasked: key ? maskSecret(key) : '••••',
    lastSyncAt: row.last_sync_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    webhookEnabled: Boolean(row.webhook_enabled),
    webhookAvailable: Boolean(config.publicUrl),
  };
}

export function getDecryptedKey(userId) {
  const row = getSyncRow(userId);
  if (!row) return null;
  return decryptSecret(row.api_key);
}

/** Store or update the connection. Validates the key against Hevy first. */
export async function connect(userId, apiKey, { autoSync = true } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Falta la API key de Hevy');

  const client = new HevyClient(key);
  try {
    await client.workoutCount();
  } catch (err) {
    if (err instanceof HevyApiError && err.status === 401) {
      const e = new Error('La API key de Hevy no es válida');
      e.status = 401;
      throw e;
    }
    const e = new Error(`No se pudo conectar con Hevy: ${err.message}`);
    e.status = 502;
    throw e;
  }

  const now = nowIso();
  const existing = getSyncRow(userId);
  if (existing) {
    db.prepare(
      `UPDATE hevy_sync
         SET api_key = ?, auto_sync = ?, updated_at = ?
       WHERE user_id = ?`
    ).run(encryptSecret(key), autoSync ? 1 : 0, now, userId);
  } else {
    db.prepare(
      `INSERT INTO hevy_sync (user_id, api_key, auto_sync, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(userId, encryptSecret(key), autoSync ? 1 : 0, now, now);
  }

  return getSyncStatus(userId);
}

export function setAutoSync(userId, autoSync) {
  const row = getSyncRow(userId);
  if (!row) {
    const e = new Error('No hay ninguna cuenta de Hevy conectada');
    e.status = 404;
    throw e;
  }
  db.prepare(
    'UPDATE hevy_sync SET auto_sync = ?, updated_at = ? WHERE user_id = ?'
  ).run(autoSync ? 1 : 0, nowIso(), userId);
  return getSyncStatus(userId);
}

export async function disconnect(userId) {
  const row = getSyncRow(userId);
  // Best-effort: remove the webhook subscription from Hevy before forgetting
  // the key. Failures here must not block disconnecting locally.
  if (row?.webhook_enabled) {
    const key = decryptSecret(row.api_key);
    if (key) {
      try {
        await new HevyClient(key).deleteWebhookSubscription();
      } catch {
        /* ignore */
      }
    }
  }
  db.prepare('DELETE FROM hevy_sync WHERE user_id = ?').run(userId);
  return { connected: false };
}

/** The public URL Hevy will POST to for a given user token. */
function webhookUrl() {
  if (!config.publicUrl) return null;
  return `${config.publicUrl}/api/hevy/webhook`;
}

/** Look up the user that owns a webhook auth token (constant-time compare). */
export function userByWebhookToken(token) {
  const clean = String(token || '').trim();
  if (!clean) return null;
  const candidate = Buffer.from(clean);
  // Compare against every enabled token in constant time to avoid leaking
  // which bytes matched via response timing. The set of active webhook tokens
  // is tiny (one per connected user), so scanning them is cheap.
  const rows = db
    .prepare(
      'SELECT user_id, webhook_token FROM hevy_sync WHERE webhook_enabled = 1 AND webhook_token IS NOT NULL'
    )
    .all();
  let match = null;
  for (const row of rows) {
    const stored = Buffer.from(String(row.webhook_token));
    if (
      stored.length === candidate.length &&
      crypto.timingSafeEqual(stored, candidate)
    ) {
      match = row.user_id;
    }
  }
  return match;
}

/** Register the Hevy webhook for a user. Requires a connected account + PUBLIC_URL. */
export async function enableWebhook(userId) {
  const row = getSyncRow(userId);
  if (!row) {
    const e = new Error('No hay ninguna cuenta de Hevy conectada');
    e.status = 404;
    throw e;
  }
  const url = webhookUrl();
  if (!url) {
    const e = new Error(
      'Define PUBLIC_URL en el servidor para usar webhooks en tiempo real'
    );
    e.status = 400;
    throw e;
  }
  const key = decryptSecret(row.api_key);
  if (!key) {
    const e = new Error('No se pudo descifrar la API key');
    e.status = 400;
    throw e;
  }

  const token = row.webhook_token || crypto.randomBytes(24).toString('hex');
  const client = new HevyClient(key);
  try {
    await client.createWebhookSubscription({
      url,
      authToken: `Bearer ${token}`,
    });
  } catch (err) {
    const e = new Error(`Hevy rechazó la suscripción al webhook: ${err.message}`);
    e.status = err instanceof HevyApiError ? err.status : 502;
    throw e;
  }

  db.prepare(
    `UPDATE hevy_sync
       SET webhook_token = ?, webhook_enabled = 1, updated_at = ?
     WHERE user_id = ?`
  ).run(token, nowIso(), userId);
  return getSyncStatus(userId);
}

/** Remove the Hevy webhook subscription for a user. */
export async function disableWebhook(userId) {
  const row = getSyncRow(userId);
  if (!row) {
    const e = new Error('No hay ninguna cuenta de Hevy conectada');
    e.status = 404;
    throw e;
  }
  const key = decryptSecret(row.api_key);
  if (key) {
    try {
      await new HevyClient(key).deleteWebhookSubscription();
    } catch {
      // Non-fatal: still disable locally.
    }
  }
  db.prepare(
    'UPDATE hevy_sync SET webhook_enabled = 0, updated_at = ? WHERE user_id = ?'
  ).run(nowIso(), userId);
  return getSyncStatus(userId);
}

function buildTemplateMap(templates) {
  const byNorm = new Map();
  for (const row of db.prepare('SELECT id, name FROM exercise_catalog').all()) {
    const norm = normalizeExerciseName(row.name);
    if (!byNorm.has(norm)) byNorm.set(norm, row.id);
  }
  const map = new Map();
  for (const t of templates) {
    if (!t.title) continue;
    const id = byNorm.get(normalizeExerciseName(t.title));
    if (id) map.set(t.title, id);
  }
  return map;
}

/**
 * Run an incremental sync for a user. Returns aggregate totals.
 * Uses the events feed when a previous sync timestamp exists; otherwise falls
 * back to a full workouts pull (first sync).
 */
export async function syncUser(userId, { full = false } = {}) {
  const row = getSyncRow(userId);
  if (!row) {
    const e = new Error('No hay ninguna cuenta de Hevy conectada');
    e.status = 404;
    throw e;
  }

  const key = decryptSecret(row.api_key);
  if (!key) {
    const e = new Error('No se pudo descifrar la API key (¿cambió SESSION_SECRET?)');
    e.status = 400;
    throw e;
  }

  const client = new HevyClient(key);
  const since = full ? null : row.last_sync_at;
  const syncStartedAt = nowIso();

  const totals = {
    imported: 0,
    skipped: 0,
    duplicates: 0,
    exercises: 0,
    sets: 0,
    matched: 0,
    custom: 0,
    deletedSeen: 0,
  };

  try {
    // Map Hevy template names to the local catalog for reliable linking.
    const templates = [];
    try {
      for await (const t of client.exerciseTemplates()) templates.push(t);
    } catch {
      // Non-fatal: resolution falls back to catalog name matching.
    }
    // Cache templates so we can resolve exercises by Hevy template id.
    if (templates.length) storeTemplates(userId, templates);
    const templateMap = buildTemplateMap(templates);

    const normalizedWorkouts = [];
    if (since) {
      for await (const event of client.workoutEvents({ since })) {
        if (event.type === 'deleted') {
          totals.deletedSeen += 1;
          continue;
        }
        const workout = event.workout || event.payload;
        if (workout) normalizedWorkouts.push(hevyApiWorkoutToNormalized(workout));
      }
    } else {
      for await (const w of client.workouts()) {
        normalizedWorkouts.push(hevyApiWorkoutToNormalized(w));
      }
    }

    normalizedWorkouts.sort(
      (a, b) => new Date(a.startedAt) - new Date(b.startedAt)
    );

    const apply = db.transaction(() => {
      for (const workout of normalizedWorkouts) {
        const res = importWorkout(userId, workout, { templateMap });
        if (res.skipped) {
          totals.skipped += 1;
          if (res.reason === 'duplicate') totals.duplicates += 1;
        } else {
          totals.imported += 1;
          totals.exercises += res.exercises;
          totals.sets += res.sets;
          totals.matched += res.matched;
          totals.custom += res.custom;
        }
      }
    });
    apply();
    linkUserExercises();

    db.prepare(
      `UPDATE hevy_sync
         SET last_sync_at = ?, last_status = 'ok', last_error = NULL, updated_at = ?
       WHERE user_id = ?`
    ).run(syncStartedAt, nowIso(), userId);

    return { ok: true, totals, syncedAt: syncStartedAt };
  } catch (err) {
    db.prepare(
      `UPDATE hevy_sync
         SET last_status = 'error', last_error = ?, updated_at = ?
       WHERE user_id = ?`
    ).run(String(err.message || err).slice(0, 500), nowIso(), userId);
    throw err;
  }
}

/** All users that have auto-sync enabled. */
export function usersWithAutoSync() {
  return db
    .prepare('SELECT user_id FROM hevy_sync WHERE auto_sync = 1')
    .all()
    .map((r) => r.user_id);
}

/** Run an incremental sync for every auto-sync user (used by the scheduler). */
export async function syncAllAutoUsers() {
  const users = usersWithAutoSync();
  const results = [];
  for (const userId of users) {
    try {
      const res = await syncUser(userId);
      results.push({ userId, ok: true, imported: res.totals.imported });
    } catch (err) {
      results.push({ userId, ok: false, error: err.message });
    }
  }
  return results;
}

/**
 * Start the background scheduler. Runs every `intervalHours` and syncs all
 * users with auto-sync enabled. Returns the timer so callers can clear it.
 */
export function startSyncScheduler({ intervalHours = 6 } = {}) {
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  const tick = async () => {
    const users = usersWithAutoSync();
    if (!users.length) return;
    console.log(`[hevy-sync] sincronizando ${users.length} usuario(s)…`);
    const results = await syncAllAutoUsers();
    for (const r of results) {
      if (r.ok) {
        console.log(`[hevy-sync] usuario ${r.userId}: +${r.imported} entrenos`);
      } else {
        console.warn(`[hevy-sync] usuario ${r.userId} falló: ${r.error}`);
      }
    }
  };
  // Defer the first run a bit so startup stays fast.
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
