import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const { dumpEntryToDatasetItem } = await import('../server/hevy-catalog-seed.js');

const DUMP_DIR = '/tmp/hevy-dump-test';

test('maps a Hevy dump entry to a free-exercise-db-style item', () => {
  const entry = {
    id: 'ABC123',
    name: 'Bench Press',
    type: 'weight_reps',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps', 'upper_back'],
    equipment: 'barbell',
    images: ['images/ABC123.jpg'],
  };

  const item = dumpEntryToDatasetItem(entry, DUMP_DIR);

  assert.equal(item.id, 'ABC123');
  assert.equal(item.name, 'Bench Press');
  assert.deepEqual(item.primaryMuscles, ['chest']);
  // upper_back is remapped to the free-exercise-db vocabulary.
  assert.deepEqual(item.secondaryMuscles, ['triceps', 'middle back']);
  assert.equal(item.equipment, 'barbell');
  assert.deepEqual(item.instructions, []);

  const expectedUrl = pathToFileURL(
    path.join(DUMP_DIR, 'images/ABC123.jpg')
  ).href;
  assert.deepEqual(item.images, [expectedUrl]);
  assert.ok(item.images[0].startsWith('file://'));
});

test('handles entries without an image and cardio type', () => {
  const entry = {
    id: 'CARDIO1',
    name: 'Climbing',
    type: 'cardio',
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: null,
    images: [],
  };

  const item = dumpEntryToDatasetItem(entry, DUMP_DIR);
  assert.deepEqual(item.images, []);
  assert.equal(item.equipment, null);
  assert.equal(item.category, 'cardio');
  assert.deepEqual(item.primaryMuscles, []);
});
