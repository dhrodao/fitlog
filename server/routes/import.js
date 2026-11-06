import { Router } from 'express';
import { db } from '../db.js';
import { HttpError, asyncHandler } from '../http.js';
import { linkUserExercises, normalizeExerciseName } from '../catalog.js';
import {
  parseCsvObjects,
  csvRowsToWorkouts,
  importWorkout,
} from '../hevy-import.js';
import { HevyClient, hevyApiWorkoutToNormalized } from '../hevy-client.js';
import { storeTemplates } from '../hevy-templates.js';
import {
  getSyncStatus,
  connect as connectHevy,
  setAutoSync,
  disconnect as disconnectHevy,
  syncUser,
  enableWebhook,
  disableWebhook,
} from '../hevy-sync.js';

const router = Router();

const REQUIRED_CSV_COLUMNS = [
  'title',
  'start_time',
  'exercise_title',
  'weight_kg',
  'reps',
];

/** Run the import loop (or a dry-run) and return aggregate totals. */
function runImport(userId, workouts, { write, templateMap = null }) {
  const totals = {
    workouts: workouts.length,
    imported: 0,
    skipped: 0,
    duplicates: 0,
    exercises: 0,
    sets: 0,
    matched: 0,
    custom: 0,
  };

  if (!write) {
    for (const workout of workouts) {
      totals.imported += 1;
      totals.exercises += workout.exercises.length;
      totals.sets += workout.exercises.reduce((n, e) => n + e.sets.length, 0);
    }
    return totals;
  }

  const apply = db.transaction(() => {
    for (const workout of workouts) {
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
  return totals;
}

/**
 * Import workouts from a Hevy CSV export.
 * Body: { csv: string, write?: boolean }
 */
router.post('/hevy/csv', (req, res) => {
  const csv = req.body?.csv;
  const write = req.body?.write === true;
  if (typeof csv !== 'string' || !csv.trim()) {
    throw new HttpError(400, 'Debes adjuntar el contenido del CSV');
  }

  const rows = parseCsvObjects(csv);
  if (!rows.length) throw new HttpError(400, 'El CSV no tiene filas de datos');

  const missing = REQUIRED_CSV_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length) {
    throw new HttpError(
      400,
      `El CSV no parece de Hevy. Faltan columnas: ${missing.join(', ')}`
    );
  }

  const workouts = csvRowsToWorkouts(rows);
  if (!workouts.length) {
    throw new HttpError(400, 'No se detectaron entrenamientos en el CSV');
  }

  const totals = runImport(req.user.id, workouts, { write });
  res.json({ ok: true, write, totals });
});

/** Build a map Hevy template title -> catalog id for confident matches. */
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
 * Import workouts from the Hevy public API.
 * Body: { apiKey: string, write?: boolean }
 */
router.post(
  '/hevy/api',
  asyncHandler(async (req, res) => {
    const apiKey = String(req.body?.apiKey || '').trim();
    const write = req.body?.write === true;
    if (!apiKey) throw new HttpError(400, 'Debes indicar tu API key de Hevy');

    const client = new HevyClient(apiKey);

    try {
      await client.workoutCount();
    } catch (err) {
      if (err.status === 401) {
        throw new HttpError(401, 'La API key de Hevy no es válida');
      }
      throw new HttpError(502, `No se pudo conectar con Hevy: ${err.message}`);
    }

    const templates = [];
    try {
      for await (const t of client.exerciseTemplates()) templates.push(t);
    } catch {
      // Non-fatal: without templates we still resolve by catalog name.
    }
    if (write && templates.length) storeTemplates(req.user.id, templates);
    const templateMap = buildTemplateMap(templates);

    const workouts = [];
    try {
      for await (const w of client.workouts()) {
        workouts.push(hevyApiWorkoutToNormalized(w));
      }
    } catch (err) {
      throw new HttpError(502, `Error leyendo entrenos de Hevy: ${err.message}`);
    }
    workouts.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

    if (!workouts.length) {
      throw new HttpError(400, 'No se encontraron entrenamientos en tu cuenta de Hevy');
    }

    const totals = runImport(req.user.id, workouts, { write, templateMap });
    res.json({ ok: true, write, totals });
  })
);

// ── Hevy sync (persistent connection via API key) ───────────────────────────

/** Current sync connection status for the user. */
router.get('/hevy/sync', (req, res) => {
  res.json(getSyncStatus(req.user.id));
});

/** Connect / update the Hevy API key. Body: { apiKey, autoSync? } */
router.post(
  '/hevy/sync/connect',
  asyncHandler(async (req, res) => {
    const apiKey = String(req.body?.apiKey || '').trim();
    const autoSync = req.body?.autoSync !== false;
    if (!apiKey) throw new HttpError(400, 'Debes indicar tu API key de Hevy');
    try {
      const status = await connectHevy(req.user.id, apiKey, { autoSync });
      res.json({ ok: true, status });
    } catch (err) {
      throw new HttpError(err.status || 502, err.message);
    }
  })
);

/** Toggle automatic background sync. Body: { autoSync: boolean } */
router.patch('/hevy/sync', (req, res) => {
  const autoSync = req.body?.autoSync === true;
  try {
    const status = setAutoSync(req.user.id, autoSync);
    res.json({ ok: true, status });
  } catch (err) {
    throw new HttpError(err.status || 400, err.message);
  }
});

/** Run a sync now. Body: { full?: boolean } */
router.post(
  '/hevy/sync/run',
  asyncHandler(async (req, res) => {
    const full = req.body?.full === true;
    try {
      const result = await syncUser(req.user.id, { full });
      res.json({ ok: true, ...result, status: getSyncStatus(req.user.id) });
    } catch (err) {
      throw new HttpError(err.status || 502, err.message);
    }
  })
);

/** Disconnect and remove the stored key. */
router.delete(
  '/hevy/sync',
  asyncHandler(async (req, res) => {
    const status = await disconnectHevy(req.user.id);
    res.json({ ok: true, status });
  })
);

/** Enable real-time webhook (registers the subscription with Hevy). */
router.post(
  '/hevy/sync/webhook',
  asyncHandler(async (req, res) => {
    try {
      const status = await enableWebhook(req.user.id);
      res.json({ ok: true, status });
    } catch (err) {
      throw new HttpError(err.status || 502, err.message);
    }
  })
);

/** Disable the real-time webhook. */
router.delete(
  '/hevy/sync/webhook',
  asyncHandler(async (req, res) => {
    try {
      const status = await disableWebhook(req.user.id);
      res.json({ ok: true, status });
    } catch (err) {
      throw new HttpError(err.status || 502, err.message);
    }
  })
);

export default router;
