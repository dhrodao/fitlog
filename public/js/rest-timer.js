// Pure countdown logic for the active-workout rest timer, with no DOM
// dependency so it can be unit tested. The view wires the interval, haptics
// and rendering to the callbacks.
//
// The countdown is anchored to an ABSOLUTE timestamp (`endAt`) rather than a
// per-tick counter. iOS/Safari freezes JS timers when the PWA goes to the
// background, so a counter that subtracts 1 per tick would stall and drift.
// Deriving `remaining` from `endAt - now()` means the value is always correct
// the moment we recompute it, regardless of how long the tab was frozen.
//
// Usage:
//   const t = createRestTimer({ defaultSeconds: 90 });
//   t.start(60);        // remaining = 60, running
//   t.tick();           // recompute from the clock; true on the tick it hits 0
//   t.add(15);          // push endAt 15s further
//   t.skip();           // stopped, remaining = 0
// onDone fires exactly once, on the first tick that observes remaining <= 0.

export function createRestTimer({ defaultSeconds = 90, now = () => Date.now() } = {}) {
  let endAt = 0; // absolute ms timestamp when the countdown reaches zero
  let running = false;

  /** Seconds left, derived from the wall clock (never negative). */
  const remainingSeconds = () => {
    if (!running) return 0;
    return Math.max(0, Math.ceil((endAt - now()) / 1000));
  };

  return {
    get remaining() {
      return remainingSeconds();
    },
    get running() {
      return running;
    },
    /** Start (or restart) the countdown. Non-positive/invalid → defaultSeconds. */
    start(seconds) {
      const n = Math.round(Number(seconds));
      const secs = Number.isFinite(n) && n > 0 ? n : defaultSeconds;
      endAt = now() + secs * 1000;
      running = true;
      return secs;
    },
    /**
     * Recompute against the clock. Returns true exactly once, on the first call
     * that observes the countdown has reached zero. Safe to call at any cadence
     * (e.g. once per second, or again right after returning from background).
     */
    tick() {
      if (!running) return false;
      if (remainingSeconds() <= 0) {
        running = false;
        endAt = 0;
        return true; // done
      }
      return false;
    },
    /** Extend the countdown; restarts running if it had finished. */
    add(seconds) {
      const n = Math.round(Number(seconds)) || 0;
      // Anchor the extension to whatever is left (or to now if already expired),
      // so adding time after expiry starts a fresh +n window.
      const base = running ? Math.max(endAt, now()) : now();
      endAt = base + n * 1000;
      const left = Math.max(0, Math.ceil((endAt - now()) / 1000));
      running = left > 0;
      return left;
    },
    /** Stop and clear. */
    skip() {
      endAt = 0;
      running = false;
    },
  };
}
