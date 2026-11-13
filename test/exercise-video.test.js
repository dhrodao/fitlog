// The exercise animation is served by the app itself from the locally dumped
// file (a file:// URL in exercise_catalog.video_url), never from Hevy's CDN,
// and only when that file lives inside the data directory. This verifies the
// serialized catalog exposes the same-origin app route, that the route streams
// the on-disk bytes, and that a poisoned path outside the data root is refused.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { setupTestEnv, createTestApp, cleanupTestApp } from './helpers/app.js';

const dbPath = setupTestEnv();
const dataRoot = path.dirname(dbPath);

const { db, agent } = await createTestApp();

import { loginDev } from './helpers/fixtures.js';
const { getCatalogExercise } = await import('../server/catalog.js');

test.after(() => cleanupTestApp(db));

const now = () => new Date().toISOString();
function insertCatalog(id, videoUrl) {
  db.prepare(
    `INSERT INTO exercise_catalog
       (id, name, category, muscles, primary_muscles, secondary_muscles,
        equipment, instructions, level, force, mechanic,
        image_url, image_url_2, thumbnail_url, video_url, description, updated_at)
     VALUES (?, ?, ?, '[]','[]','[]','[]','[]', NULL, NULL, NULL,
             NULL, NULL, NULL, ?, NULL, ?)`
  ).run(id, `Name ${id}`, 'Piernas', videoUrl, now());
}

test('catalog video is served from disk via the app route, not Hevy CDN', async () => {
  await loginDev(agent);
  db.prepare('DELETE FROM exercise_catalog').run();

  // A dumped .mp4 lives inside the data directory, referenced by a file:// URL.
  const videosDir = path.join(dataRoot, 'hevy-catalog', 'videos');
  fs.mkdirSync(videosDir, { recursive: true });
  const filePath = path.join(videosDir, 'demo.mp4');
  const bytes = Buffer.from('fake-mp4-bytes');
  fs.writeFileSync(filePath, bytes);
  insertCatalog('Vid_Demo', pathToFileURL(filePath).href);

  // The serialized catalog exposes the same-origin app route — not the file://
  // URL and not any cloudfront host.
  const serialized = getCatalogExercise('Vid_Demo');
  assert.equal(serialized.videoUrl, '/api/exercises/video/Vid_Demo');
  assert.ok(!/cloudfront|file:\/\//.test(serialized.videoUrl));

  // The route streams the on-disk bytes with a video content type.
  const res = await agent.get('/api/exercises/video/Vid_Demo').expect(200);
  assert.match(res.headers['content-type'], /video\/mp4/);
  assert.deepEqual(res.body, bytes);

  fs.rmSync(path.join(dataRoot, 'hevy-catalog'), { recursive: true, force: true });
});

test('an exercise without a video returns 404', async () => {
  await loginDev(agent);
  insertCatalog('No_Vid', null);
  assert.equal(getCatalogExercise('No_Vid').videoUrl, null);
  await agent.get('/api/exercises/video/No_Vid').expect(404);
});

test('a video path escaping the data root is refused (no path traversal)', async () => {
  await loginDev(agent);

  // Write a secret genuinely OUTSIDE the data root (the data root is a temp
  // dir, so a file under the project cwd is reliably outside it) and point a
  // crafted catalog row at it.
  const secret = path.join(process.cwd(), `fitlog-secret-${process.pid}.mp4`);
  fs.writeFileSync(secret, Buffer.from('top-secret'));
  assert.ok(
    path.relative(dataRoot, secret).startsWith('..'),
    'test precondition: secret must be outside the data root'
  );

  // A direct file:// to the outside file and a ../ traversal that climbs out of
  // the data root must both be refused.
  insertCatalog('Escape_Abs', pathToFileURL(secret).href);
  insertCatalog(
    'Escape_Rel',
    pathToFileURL(path.join(dataRoot, '..', '..', path.basename(secret))).href
  );

  await agent.get('/api/exercises/video/Escape_Abs').expect(404);
  await agent.get('/api/exercises/video/Escape_Rel').expect(404);

  fs.rmSync(secret, { force: true });
});

test('a non-existent catalog id returns 404 (no SQL/path injection surface)', async () => {
  await loginDev(agent);
  await agent.get('/api/exercises/video/..%2F..%2Fetc%2Fpasswd').expect(404);
  await agent.get('/api/exercises/video/does-not-exist').expect(404);
});
