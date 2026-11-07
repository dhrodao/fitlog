// Pure rest-timer countdown logic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestTimer } from '../public/js/rest-timer.js';

test('start sets remaining and runs; invalid falls back to default', () => {
  const t = createRestTimer({ defaultSeconds: 90 });
  assert.equal(t.start(60), 60);
  assert.equal(t.running, true);
  assert.equal(t.start(0), 90, 'non-positive uses default');
  assert.equal(t.start(NaN), 90, 'invalid uses default');
  assert.equal(t.start('45'), 45, 'numeric string accepted');
});

test('tick counts down and signals done exactly at zero', () => {
  const t = createRestTimer();
  t.start(3);
  assert.equal(t.tick(), false); // 2
  assert.equal(t.remaining, 2);
  assert.equal(t.tick(), false); // 1
  assert.equal(t.tick(), true); // 0 -> done
  assert.equal(t.remaining, 0);
  assert.equal(t.running, false);
  // No further done signals once stopped.
  assert.equal(t.tick(), false);
});

test('add extends the countdown and can revive a finished timer', () => {
  const t = createRestTimer();
  t.start(2);
  t.tick();
  t.tick(); // done, remaining 0
  assert.equal(t.running, false);
  assert.equal(t.add(15), 15);
  assert.equal(t.running, true, 'adding time resumes running');
});

test('skip stops and clears', () => {
  const t = createRestTimer();
  t.start(60);
  t.skip();
  assert.equal(t.remaining, 0);
  assert.equal(t.running, false);
});
