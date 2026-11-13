import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncCatalog } from './catalog.js';

/**
 * Seed the local exercise catalog from a Hevy dump produced by
 * server/dump-hevy-catalog.js, so the app can run without free-exercise-db
 * (and without the Hevy API, which needs a paid subscription).
 *
 * The dump stores a free-exercise-db-style exercises.json plus a local
 * images/ folder. We convert each entry into the exact shape mapExercise()
 * expects and feed it to syncCatalog({ dataset }), which upserts into
 * exercise_catalog without touching the network. Local images are referenced
 * as absolute file:// URLs; catalog-media.js serves those straight from disk.
 */

/** Map Hevy's muscle-group tokens to the free-exercise-db muscle vocabulary. */
const MUSCLE_FROM_HEVY = {
  abductors: 'abductors',
  adductors: 'adductors',
  abs: 'abdominals',
  abdominals: 'abdominals',
  biceps: 'biceps',
  calves: 'calves',
  cardio: null,
  chest: 'chest',
  forearms: 'forearms',
  full_body: null,
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  lower_back: 'lower back',
  'lower back': 'lower back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
  upper_back: 'middle back',
  'upper back': 'middle back',
};

function mapMuscle(token) {
  if (!token) return null;
  const key = String(token).toLowerCase();
  return key in MUSCLE_FROM_HEVY ? MUSCLE_FROM_HEVY[key] : key;
}

/**
 * Convert one dump entry into a free-exercise-db-style item. `imagesDir` is the
 * absolute path that the entry's relative image paths resolve against.
 */
export function dumpEntryToDatasetItem(entry, dumpDir) {
  const primary = (entry.primaryMuscles || []).map(mapMuscle).filter(Boolean);
  const secondary = (entry.secondaryMuscles || []).map(mapMuscle).filter(Boolean);
  const images = (entry.images || [])
    .map((rel) => pathToFileURL(path.join(dumpDir, rel)).href);

  // Exercise animation by file convention: if you have placed a video at
  // <dumpDir>/videos/<templateId>.mp4 (managed manually — not part of the Hevy
  // public API, so the dump never fetches it), link it as a local file:// URL
  // and the app serves it from disk. Otherwise the exercise simply has no video.
  const videoPath = path.join(dumpDir, 'videos', `${String(entry.id)}.mp4`);
  const videoUrl = fs.existsSync(videoPath)
    ? pathToFileURL(videoPath).href
    : null;

  return {
    id: String(entry.id),
    name: entry.name,
    primaryMuscles: primary,
    secondaryMuscles: secondary,
    // Hevy gives a single equipment string; mapExercise expects a scalar.
    equipment: entry.equipment || null,
    // Hevy has no written instructions; keep the category fallback (cardio, …).
    instructions: [],
    category: entry.type === 'cardio' ? 'cardio' : null,
    images,
    // Local file:// URL of the exercise animation (null when none on disk).
    videoUrl,
  };
}

/** Load and parse a dump's exercises.json. Throws a clear error if missing. */
export function loadDump(dumpDir) {
  const jsonPath = path.join(dumpDir, 'exercises.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `No se encontró ${jsonPath}. Genera el volcado primero (dump:hevy-catalog).`
    );
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(data)) {
    throw new Error(`${jsonPath}: el contenido no es un array.`);
  }
  return data;
}

/** Build the catalog dataset (array of items) from a dump directory. */
export function datasetFromDump(dumpDir) {
  return loadDump(dumpDir)
    .filter((entry) => entry && entry.id && entry.name)
    .map((entry) => dumpEntryToDatasetItem(entry, dumpDir));
}

/**
 * Seed exercise_catalog from a Hevy dump directory. Returns the syncCatalog
 * result ({ count, linked, problems, ... }).
 */
export async function seedCatalogFromDump(dumpDir) {
  const dataset = datasetFromDump(dumpDir);
  return syncCatalog({ force: true, dataset, source: 'hevy' });
}
