// The Hevy catalog seed links an exercise to its animation by file convention:
// a video at <dumpDir>/videos/<templateId>.mp4 (managed manually) becomes the
// exercise's local file:// videoUrl. No video is fetched or derived by the dump.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { dumpEntryToDatasetItem } from '../server/hevy-catalog-seed.js';

test('links videos/<templateId>.mp4 when the file exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlog-seedvid-'));
  fs.mkdirSync(path.join(dir, 'videos'), { recursive: true });
  const videoPath = path.join(dir, 'videos', 'ABC123.mp4');
  fs.writeFileSync(videoPath, Buffer.from('x'));

  const item = dumpEntryToDatasetItem(
    { id: 'ABC123', name: 'Squat', type: 'weight_reps' },
    dir
  );
  assert.equal(item.videoUrl, pathToFileURL(videoPath).href);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('leaves videoUrl null when no videos/<templateId>.mp4 exists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlog-seedvid-'));
  const item = dumpEntryToDatasetItem(
    { id: 'NOPE', name: 'Bench', type: 'weight_reps' },
    dir
  );
  assert.equal(item.videoUrl, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('links images/<templateId>.<ext> by convention when the JSON has no images', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlog-seedimg-'));
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  const imgPath = path.join(dir, 'images', 'IMG1.png');
  fs.writeFileSync(imgPath, Buffer.from('x'));

  // entry.images is empty (e.g. a --no-images dump), but the file exists.
  const item = dumpEntryToDatasetItem(
    { id: 'IMG1', name: 'Row', type: 'weight_reps', images: [] },
    dir
  );
  assert.deepEqual(item.images, [pathToFileURL(imgPath).href]);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('prefers the JSON images array over the convention when present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fitlog-seedimg-'));
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  // Both a JSON-listed image and a convention file exist; JSON wins.
  fs.writeFileSync(path.join(dir, 'images', 'listed.jpg'), Buffer.from('x'));
  fs.writeFileSync(path.join(dir, 'images', 'IMG2.jpg'), Buffer.from('x'));

  const item = dumpEntryToDatasetItem(
    { id: 'IMG2', name: 'Row', type: 'weight_reps', images: ['images/listed.jpg'] },
    dir
  );
  assert.deepEqual(item.images, [pathToFileURL(path.join(dir, 'images', 'listed.jpg')).href]);

  fs.rmSync(dir, { recursive: true, force: true });
});
