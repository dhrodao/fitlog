import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import { db } from './db.js';

const cacheDir = path.join(path.dirname(config.dbPath), 'exercise-images');

// Root under which locally-dumped catalog assets (Hevy images/videos) legitimately
// live. Any file:// URL stored in the catalog must resolve inside this directory;
// anything escaping it (via a poisoned dump path, "..", a symlink target outside)
// is refused, so a crafted catalog row can never make the app serve an arbitrary
// file from disk.
const dataRoot = path.resolve(path.dirname(config.dbPath));

/**
 * Convert a file:// URL to a real path that is guaranteed to be inside
 * `dataRoot`. Returns null if it is not a file:// URL or escapes the root.
 */
function safeLocalPath(url) {
  if (typeof url !== 'string' || !url.startsWith('file://')) return null;
  let localPath;
  try {
    localPath = path.resolve(fileURLToPath(url));
  } catch {
    return null;
  }
  const rel = path.relative(dataRoot, localPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return localPath;
}

/** Best-effort content type from a local file extension. */
function contentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

/** Content type for a locally-dumped exercise animation. */
function videoContentTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

function cacheFileFor(url) {
  const hash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
  return path.join(cacheDir, `${hash}.jpg`);
}

function upstreamUrl(id, index) {
  const row = db
    .prepare('SELECT image_url, image_url_2 FROM exercise_catalog WHERE id = ?')
    .get(String(id));
  if (!row) return null;
  return index === 1 ? row.image_url_2 : row.image_url;
}

export function catalogImageUrl(id, index = 0) {
  return `/api/exercises/image/${encodeURIComponent(id)}/${index}`;
}

export async function getCatalogImageFile(id, index = 0) {
  const url = upstreamUrl(id, index);
  if (!url) return null;

  // Locally-dumped images (e.g. the Hevy catalog) are stored as file:// URLs
  // and served straight from disk — no network fetch, no cache copy. The path
  // is confined to the data directory so a poisoned catalog row cannot escape.
  if (url.startsWith('file://')) {
    const localPath = safeLocalPath(url);
    if (!localPath) return null;
    try {
      const stat = await fs.stat(localPath);
      if (stat.size > 0) {
        return { file: localPath, contentType: contentTypeForPath(localPath) };
      }
    } catch {
      // Missing local file: treat as no image.
    }
    return null;
  }

  const file = cacheFileFor(url);
  try {
    const stat = await fs.stat(file);
    if (stat.size > 0) return { file, contentType: 'image/jpeg' };
  } catch {
    // cache miss
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'image/jpeg',
      'User-Agent': 'fitness-app/1.0 (personal workout tracker)',
    },
  });
  if (!response.ok) {
    throw new Error(`imagen no disponible (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(cacheDir, { recursive: true });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temp, buffer);
  await fs.rename(temp, file);

  return { file, contentType };
}

/** App route that serves the exercise animation from disk (no CDN at runtime). */
export function catalogVideoUrl(id) {
  return `/api/exercises/video/${encodeURIComponent(id)}`;
}

/**
 * Resolve the local animation file for a catalog id. The catalog stores the
 * video as a file:// URL pointing at the dumped .mp4, so it is served straight
 * from disk — the browser never touches Hevy's CDN. Returns null when the
 * exercise has no video or the file is missing/empty.
 */
export async function getCatalogVideoFile(id) {
  const row = db
    .prepare('SELECT video_url FROM exercise_catalog WHERE id = ?')
    .get(String(id));
  const localPath = safeLocalPath(row?.video_url);
  if (!localPath) return null;

  try {
    const stat = await fs.stat(localPath);
    if (stat.size > 0) {
      return { file: localPath, contentType: videoContentTypeForPath(localPath) };
    }
  } catch {
    // Missing local file: treat as no video.
  }
  return null;
}
