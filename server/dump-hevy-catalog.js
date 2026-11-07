import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { HevyClient } from './hevy-client.js';

/**
 * Dump the full Hevy exercise catalog to a local, free-exercise-db-style
 * folder for PERSONAL backup (e.g. before cancelling a Hevy Pro subscription,
 * which also revokes API access).
 *
 * Usage:
 *   node server/dump-hevy-catalog.js [--api-key KEY] [--out DIR] [--no-images]
 *
 * The API key can also come from the HEVY_API_KEY environment variable.
 *
 * Output (default DIR = data/hevy-catalog):
 *   <DIR>/exercises.json       every template, normalized
 *   <DIR>/exercises.raw.json   the untouched Hevy objects (nothing is lost)
 *   <DIR>/images/<id>.<ext>    the thumbnails Hevy actually exposes
 *
 * NOTE: Hevy only returns a single `thumbnail_url` per template, and for the
 * official (non-custom) catalog it is frequently empty, so most standard
 * exercises will have no image here. Fitlog already backfills those from
 * free-exercise-db by name; this dump is mainly valuable for your CUSTOM
 * exercises and for the canonical template ids.
 */

function parseArgs(argv) {
  const args = { apiKey: null, out: null, images: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--api-key') args.apiKey = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-images') args.images = false;
  }
  return args;
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

/** Map a Hevy template into a free-exercise-db-like shape. */
function normalizeTemplate(t, localImages) {
  return {
    id: t.id != null ? String(t.id) : null,
    name: t.title || null,
    type: t.type || null,
    primaryMuscles: t.primary_muscle_group ? [t.primary_muscle_group] : [],
    secondaryMuscles: Array.isArray(t.secondary_muscle_groups)
      ? t.secondary_muscle_groups
      : [],
    equipment: t.equipment || null,
    isCustom: Boolean(t.is_custom),
    thumbnailUrl: t.thumbnail_url || null,
    images: localImages,
  };
}

/** Pick a file extension from a thumbnail URL, defaulting to .jpg. */
function extFromUrl(url) {
  const m = String(url || '').match(/\.(png|jpe?g|webp|gif)(?:\?|#|$)/i);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

async function downloadImage(client, url, destPath) {
  // Reuse the client's timeout-wrapped fetch; the thumbnail CDN needs no api-key
  // header but sending it is harmless.
  const res = await client.fetchWithTimeout(url, {
    headers: { Accept: 'image/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buf);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = args.apiKey || process.env.HEVY_API_KEY;
  if (!apiKey) {
    fail('Falta la API key: usa --api-key KEY o la variable HEVY_API_KEY.');
  }

  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(path.dirname(config.dbPath), 'hevy-catalog');
  const imagesDir = path.join(outDir, 'images');
  fs.mkdirSync(outDir, { recursive: true });
  if (args.images) fs.mkdirSync(imagesDir, { recursive: true });

  const client = new HevyClient(apiKey, {
    timeoutMs: config.hevy.requestTimeoutMs,
    maxRetries: config.hevy.maxRetries,
    backoffMs: config.hevy.retryBackoffMs,
  });

  console.log('Conectando con la API de Hevy…');
  console.log(`Carpeta de salida: ${outDir}`);

  // Collect every template (the client paginates through all pages).
  const raw = [];
  try {
    for await (const t of client.exerciseTemplates()) raw.push(t);
  } catch (err) {
    fail(`No se pudieron leer las plantillas de Hevy: ${err.message}`);
  }
  console.log(`Plantillas descargadas: ${raw.length}`);

  const custom = raw.filter((t) => t.is_custom).length;
  const withThumb = raw.filter((t) => t.thumbnail_url).length;
  console.log(
    `  Personalizadas: ${custom} · con miniatura: ${withThumb} de ${raw.length}`
  );

  // Download the thumbnails Hevy actually exposes.
  const imagesById = new Map();
  let downloaded = 0;
  let failed = 0;
  if (args.images) {
    for (const t of raw) {
      if (!t.id || !t.thumbnail_url) continue;
      const ext = extFromUrl(t.thumbnail_url);
      const fileName = `${String(t.id)}${ext}`;
      try {
        await downloadImage(client, t.thumbnail_url, path.join(imagesDir, fileName));
        imagesById.set(String(t.id), [`images/${fileName}`]);
        downloaded += 1;
      } catch (err) {
        failed += 1;
        console.warn(`  Aviso: no se pudo descargar ${t.thumbnail_url} (${err.message}).`);
      }
    }
    console.log(`Miniaturas guardadas: ${downloaded}${failed ? ` (fallidas: ${failed})` : ''}`);
  }

  const normalized = raw.map((t) =>
    normalizeTemplate(t, imagesById.get(String(t.id)) || [])
  );

  const rawPath = path.join(outDir, 'exercises.raw.json');
  const normPath = path.join(outDir, 'exercises.json');
  fs.writeFileSync(rawPath, `${JSON.stringify(raw, null, 2)}\n`);
  fs.writeFileSync(normPath, `${JSON.stringify(normalized, null, 2)}\n`);

  console.log('─'.repeat(50));
  console.log('Volcado completado:');
  console.log(`  ${normPath}`);
  console.log(`  ${rawPath}`);
  if (args.images) console.log(`  ${imagesDir}/ (${downloaded} imágenes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
