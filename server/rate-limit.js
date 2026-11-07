// A tiny in-memory fixed-window rate limiter. No external dependency and no
// shared store: this app is a single process behind the Cloudflare Tunnel, so a
// per-process Map is sufficient. It is NOT a distributed limiter.
//
// Each limiter keeps counters per key (client IP by default) within a window;
// when the count exceeds `max` the request gets a 429 with a clear message and
// a Retry-After header. Counters are swept lazily so the map does not grow
// without bound.

/**
 * @param {object} opts
 * @param {number} opts.windowMs   window length in milliseconds
 * @param {number} opts.max        max requests per key per window
 * @param {string} [opts.message]  Spanish 429 message
 * @param {(req:any)=>string} [opts.keyGenerator]  defaults to client IP
 * @returns {import('express').RequestHandler}
 */
export function rateLimit({ windowMs, max, message, keyGenerator } = {}) {
  if (!windowMs || !max) throw new Error('rateLimit requires windowMs and max');
  const hits = new Map(); // key -> { count, resetAt }
  const keyOf = keyGenerator || ((req) => clientIp(req));
  const text = message || 'Demasiadas peticiones, inténtalo de nuevo en un momento';

  // Periodic sweep of expired windows. Unref so it never holds the process up.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  if (typeof sweep.unref === 'function') sweep.unref();

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: text });
    }
    next();
  };
}

/** Best-effort client IP, honoring a single trusted proxy hop. */
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
