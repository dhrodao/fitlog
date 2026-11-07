// Pure rest-timer countdown logic, anchored to an injectable clock.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestTimer } from '../public/js/rest-timer.js';

/** A fake clock so tests can advance time deterministically. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

test('start sets remaining and runs; invalid falls back to default', () => {
  const clock = fakeClock();
  const t = createRestTimer({ defaultSeconds: 90, now: clock.now });
  assert.equal(t.start(60), 60);
  assert.equal(t.running, true);
  assert.equal(t.remaining, 60);
  assert.equal(t.start(0), 90, 'non-positive uses default');
  assert.equal(t.start(NaN), 90, 'invalid uses default');
  assert.equal(t.start('45'), 45, 'numeric string accepted');
});

test('remaining counts down with the wall clock', () => {
  const clock = fakeClock();
  const t = createRestTimer({ now: clock.now });
  t.start(3);
  assert.equal(t.remaining, 3);
  clock.advance(1000);
  assert.equal(t.tick(), false);
  assert.equal(t.remaining, 2);
  clock.advance(1000);
  assert.equal(t.tick(), false);
  assert.equal(t.remaining, 1);
  clock.advance(1000);
  assert.equal(t.tick(), true, 'done exactly when it reaches zero');
  assert.equal(t.remaining, 0);
  assert.equal(t.running, false);
  assert.equal(t.tick(), false, 'no further done signals once stopped');
});

test('survives a background freeze: a large clock jump settles to zero', () => {
  // This is the Safari/PWA case: JS is frozen while backgrounded, so no ticks
  // fire for a long stretch. On return, one tick must observe the real time.
  const clock = fakeClock();
  const t = createRestTimer({ now: clock.now });
  t.start(90);
  clock.advance(5 * 60 * 1000); // 5 minutes in the background
  assert.equal(t.remaining, 0, 'remaining reflects real elapsed time, not ticks');
  assert.equal(t.tick(), true, 'the first tick after returning signals done');
  assert.equal(t.running, false);
});

test('add extends the countdown and can revive a finished timer', () => {
  const clock = fakeClock();
  const t = createRestTimer({ now: clock.now });
  t.start(2);
  clock.advance(2000);
  assert.equal(t.tick(), true); // done, remaining 0
  assert.equal(t.running, false);
  assert.equal(t.add(15), 15);
  assert.equal(t.running, true, 'adding time resumes running');
  assert.equal(t.remaining, 15);
});

test('add while running pushes the deadline further out', () => {
  const clock = fakeClock();
  const t = createRestTimer({ now: clock.now });
  t.start(30);
  clock.advance(10_000); // 20 left
  assert.equal(t.remaining, 20);
  assert.equal(t.add(15), 35);
});

test('skip stops and clears', () => {
  const clock = fakeClock();
  const t = createRestTimer({ now: clock.now });
  t.start(60);
  t.skip();
  assert.equal(t.remaining, 0);
  assert.equal(t.running, false);
});
