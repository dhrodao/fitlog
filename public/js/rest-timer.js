// Pure countdown logic for the active-workout rest timer, with no DOM or timer
// dependency so it can be unit tested. The view wires setInterval, haptics and
// rendering to the callbacks. Time is advanced explicitly via tick().
//
// Usage:
//   const t = createRestTimer({ defaultSeconds: 90 });
//   t.start(60);        // remaining = 60, running
//   t.tick();           // remaining = 59
//   t.add(15);          // remaining = 74
//   t.skip();           // stopped, remaining = 0
// onDone fires exactly once, on the tick that reaches zero.

export function createRestTimer({ defaultSeconds = 90 } = {}) {
  let remaining = 0;
  let running = false;

  return {
    get remaining() {
      return remaining;
    },
    get running() {
      return running;
    },
    /** Start (or restart) the countdown. Non-positive/invalid → defaultSeconds. */
    start(seconds) {
      const n = Math.round(Number(seconds));
      remaining = Number.isFinite(n) && n > 0 ? n : defaultSeconds;
      running = true;
      return remaining;
    },
    /** Advance one second. Returns true on the tick that reaches zero. */
    tick() {
      if (!running) return false;
      remaining -= 1;
      if (remaining <= 0) {
        remaining = 0;
        running = false;
        return true; // done
      }
      return false;
    },
    /** Extend the countdown; restarts running if it had finished. */
    add(seconds) {
      const n = Math.round(Number(seconds)) || 0;
      remaining = Math.max(0, remaining + n);
      if (remaining > 0) running = true;
      return remaining;
    },
    /** Stop and clear. */
    skip() {
      remaining = 0;
      running = false;
    },
  };
}
