// e1RM and PR definition tests. Pure functions, no DB.

import test from 'node:test';
import assert from 'node:assert/strict';

import { epley1rm, bestE1rm, personalRecords } from '../server/services/strength.js';

test('epley1rm — per-set Epley estimate', () => {
  // 100kg x 1 rep -> exactly 100.
  assert.equal(epley1rm(100, 1), 100);
  // 100kg x 10 reps -> 100 * (1 + 10/30) = 133.33...
  assert.ok(Math.abs(epley1rm(100, 10) - 133.3333) < 0.01);
  // Missing / non-positive -> 0.
  assert.equal(epley1rm(100, 0), 0);
  assert.equal(epley1rm(0, 5), 0);
  assert.equal(epley1rm(null, 5), 0);
  assert.equal(epley1rm(100, null), 0);
});

test('bestE1rm uses one set, never crossed maxima', () => {
  // A heavy low-rep set and a light high-rep set. The correct e1RM is the max
  // of each set's own estimate, NOT maxWeight * maxReps.
  const sets = [
    { weightKg: 120, reps: 2 }, // 120 * (1 + 2/30) = 128
    { weightKg: 60, reps: 15 }, // 60 * (1 + 15/30) = 90
  ];
  const best = bestE1rm(sets);
  assert.ok(Math.abs(best - 128) < 0.01);
  // The buggy cross-product would be 120 * (1 + 15/30) = 180 -> must NOT happen.
  assert.ok(best < 180);
});

test('bestE1rm skips incomplete sets', () => {
  const sets = [
    { weightKg: 200, reps: 1, completed: false },
    { weightKg: 100, reps: 1, completed: true },
  ];
  assert.equal(bestE1rm(sets), 100);
});

test('personalRecords — documented PR types', () => {
  const sessions = [
    {
      date: '2026-01-01',
      sets: [
        { weightKg: 100, reps: 5 }, // vol 500, e1rm 116.67
        { weightKg: 80, reps: 10 }, // vol 800, e1rm 106.67
      ],
    },
    {
      date: '2026-01-08',
      sets: [
        { weightKg: 110, reps: 3 }, // vol 330, e1rm 121
        { weightKg: 60, reps: 20 }, // vol 1200, e1rm 100
      ],
    },
  ];
  const pr = personalRecords(sessions);
  assert.equal(pr.maxWeight, 110);
  assert.equal(pr.maxReps, 20);
  // Best e1rm is session 2's 110x3 = 121.
  assert.equal(pr.bestE1rm, 121);
  // Session volumes: s1 = 1300, s2 = 1530 -> max 1530.
  assert.equal(pr.maxVolume, 1530);
});

test('personalRecords — empty input yields nulls', () => {
  const pr = personalRecords([]);
  assert.deepEqual(pr, {
    maxWeight: null,
    bestE1rm: null,
    maxReps: null,
    maxVolume: null,
  });
});
