import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from './config.js';
import { db } from './db.js';

const cacheDir = path.join(path.dirname(config.dbPath), 'exercise-images');

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
