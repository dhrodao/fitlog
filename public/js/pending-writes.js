// Per-key debounced writer for the active workout.
//
// The active view previously used ONE shared debounce for every set, so editing
// two sets within the window persisted only the last one, and navigating away
// cancelled the pending write entirely — silent data loss.
//
// This is a thin layer over a plain debounce that fixes the root causes:
//   1. one debounce PER key (per set) instead of a single shared one;
//   2. flush() forces pending writes instead of cancelling them, so navigation,
//      completion and backgrounding never drop an edit;
//   3. a failed write is retried automatically with capped backoff, so a flaky
//      gym connection recovers on its own without the user re-editing the set.
//
// Writes send absolute values (current PATCH semantics), so retrying, flushing
// or re-running is idempotent (last write wins).

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_BACKOFF = 1000;

/**
 * @param {object} options
 * @param {(key: string|number) => Promise<void>} options.write
 *        Persists the current value for `key`. Should throw on failure.
 * @param {number} [options.wait] Debounce window in ms.
 * @param {number} [options.maxRetries] Max automatic retries per failed write.
 * @param {number} [options.baseBackoff] Base backoff in ms (exponential).
 * @param {(error: Error, key: string|number) => void} [options.onError]
 *        Called when a write fails after exhausting retries (value stays dirty).
 * @param {() => void} [options.onSettled]
 *        Called after each write promise settles (success, give-up, or after
 *        all retries), once it has left the in-flight set. Use it to refresh
 *        UI derived from hasPending().
 */
export function createWriteScheduler({
  write,
  wait = 500,
  maxRetries = DEFAULT_MAX_RETRIES,
  baseBackoff = DEFAULT_BASE_BACKOFF,
  onError = null,
  onSettled = null,
} = {}) {
  if (typeof write !== 'function') {
    throw new TypeError('createWriteScheduler requires a write(key) function');
  }

  const timers = new Map(); // key -> debounce timer
  const retrying = new Set(); // keys with a scheduled retry in flight
  const pending = new Set(); // in-flight write promises (so flush() can await)

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // Persist one key. On failure, retry with capped exponential backoff. The
  // value stays dirty (we re-run write(), which always reads the latest value)
  // until it succeeds or retries are exhausted.
  function runWrite(key, attempt = 0) {
    const p = Promise.resolve()
      .then(() => write(key))
      .catch(async (error) => {
        if (attempt < maxRetries) {
          retrying.add(key);
          await delay(baseBackoff * 2 ** attempt);
          retrying.delete(key);
          return runWrite(key, attempt + 1);
        }
        onError?.(error, key); // give up; value remains dirty for next flush
      });
    pending.add(p);
    p.finally(() => {
      pending.delete(p);
      onSettled?.();
    });
    return p;
  }

  return {
    /** Mark `key` dirty and (re)start its debounce. Call on every edit. */
    schedule(key) {
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          runWrite(key);
        }, wait)
      );
    },

    /** Force `key` to persist now, bypassing its debounce. */
    flushKey(key) {
      if (timers.has(key)) {
        clearTimeout(timers.get(key));
        timers.delete(key);
        return runWrite(key);
      }
      return Promise.resolve();
    },

    /** Flush every debounced key and wait for all in-flight writes to settle. */
    async flush() {
      for (const [key, timer] of timers) {
        clearTimeout(timer);
        timers.delete(key);
        runWrite(key);
      }
      await Promise.allSettled([...pending]);
    },

    /** True while any edit is debouncing, retrying or being written. */
    hasPending() {
      return timers.size > 0 || pending.size > 0 || retrying.size > 0;
    },
  };
}
