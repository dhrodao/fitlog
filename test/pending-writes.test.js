import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteScheduler } from '../public/js/pending-writes.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('active-set persistence scheduler', async (t) => {
  await t.test('edits to two different sets within the window both persist', async () => {
    const values = { 1: 'a1', 2: 'a2' };
    const written = [];
    const s = createWriteScheduler({
      wait: 20,
      write: async (key) => {
        written.push([key, values[key]]);
      },
    });

    // The old shared-debounce bug persisted only the last edited set.
    s.schedule(1);
    s.schedule(2);
    await s.flush();

    assert.deepEqual(
      written.sort(),
      [[1, 'a1'], [2, 'a2']],
      'both sets must be persisted, not just the last one'
    );
  });

  await t.test('flush persists a pending edit when navigating away', async () => {
    let value = 'start';
    const written = [];
    const s = createWriteScheduler({
      wait: 10000, // long window: the debounce would not fire on its own
      write: async () => {
        written.push(value);
      },
    });

    value = 'edited';
    s.schedule(1);
    assert.equal(written.length, 0, 'nothing written yet');

    await s.flush(); // simulates route cleanup / pagehide
    assert.deepEqual(written, ['edited'], 'navigating away must flush, not cancel');
  });

  await t.test('a failed write surfaces via onError and stays pending', async () => {
    const errors = [];
    const s = createWriteScheduler({
      wait: 5,
      baseBackoff: 2,
      maxRetries: 2,
      write: async () => {
        throw new Error('boom');
      },
      onError: (e) => errors.push(e),
    });

    s.schedule(1);
    await s.flush();
    await tick(30); // allow backoff retries to run

    assert.equal(errors.length, 1, 'onError fires once after retries are exhausted');
  });

  await t.test('a transient failure recovers on its own via retry', async () => {
    let attempts = 0;
    const errors = [];
    const s = createWriteScheduler({
      wait: 5,
      baseBackoff: 2,
      maxRetries: 3,
      write: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('flaky'); // fail once, then succeed
      },
      onError: (e) => errors.push(e),
    });

    s.schedule(1);
    await tick(10);
    await s.flush();
    await tick(20);

    assert.equal(attempts, 2, 'the write is retried automatically after a transient failure');
    assert.equal(errors.length, 0, 'onError must NOT fire when a retry succeeds');
    assert.equal(s.hasPending(), false, 'no pending work after a successful retry');
  });

  await t.test('completing a set flushes the latest typed value', async () => {
    const snapshots = [];
    const set = { weightKg: 60, reps: 8, completed: false };
    const s = createWriteScheduler({
      wait: 30,
      write: async () => {
        snapshots.push({ ...set }); // write reads the latest absolute value
      },
    });

    set.weightKg = 62.5;
    s.schedule(1); // debounced edit
    set.completed = true;
    await s.flushKey(1); // "complete" flushes the same key immediately

    const last = snapshots[snapshots.length - 1];
    assert.equal(last.weightKg, 62.5, 'the flushed write includes the typed weight');
    assert.equal(last.completed, true, 'and the completion state');
    assert.equal(s.hasPending(), false, 'no pending work remains');
  });

  await t.test('onSettled fires after each write settles, including after giving up', async () => {
    // The previous code refreshed the "saving" indicator from inside write()'s
    // finally, which does not run again when retries are exhausted (write() is
    // not re-invoked on give-up), so the indicator could stay stuck. onSettled
    // fires on the scheduler promise settling, after it leaves the in-flight
    // set — each retry attempt is its own promise, so it fires per attempt, and
    // crucially the LAST one runs after the final give-up with no pending work.
    const settled = [];
    const s = createWriteScheduler({
      wait: 5,
      baseBackoff: 2,
      maxRetries: 1,
      write: async () => {
        throw new Error('boom');
      },
      onError: () => {},
      onSettled: () => settled.push(s.hasPending()),
    });

    s.schedule(1);
    await s.flush();
    await tick(20); // allow the retry + give-up to run

    assert.ok(settled.length >= 1, 'onSettled fires as writes settle');
    assert.equal(
      settled[settled.length - 1],
      false,
      'hasPending() is false after the write finally gives up'
    );
  });

  await t.test('onSettled fires once per successful write', async () => {
    let settledCount = 0;
    const s = createWriteScheduler({
      wait: 5,
      write: async () => {},
      onSettled: () => {
        settledCount += 1;
      },
    });

    s.schedule(1);
    s.schedule(2);
    await s.flush();

    assert.equal(settledCount, 2, 'one onSettled per in-flight write');
    assert.equal(s.hasPending(), false);
  });

  await t.test('hasPending reflects outstanding work', async () => {
    const s = createWriteScheduler({
      wait: 5,
      write: async () => {
        await tick(5);
      },
    });

    assert.equal(s.hasPending(), false);
    s.schedule(1);
    assert.equal(s.hasPending(), true, 'pending while a set is debouncing');
    await s.flush();
    assert.equal(s.hasPending(), false, 'cleared after flush settles');
  });
});
