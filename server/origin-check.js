// Origin check for state-changing requests (CSRF defence in depth).
//
// When PUBLIC_URL is configured we know the exact browser origin the app is
// served from, so we can reject cross-site POST/PATCH/PUT/DELETE that carry a
// foreign (or absent) Origin. SameSite=Lax cookies already block most CSRF;
// this is an additional layer and a guard for older clients.
//
// We trust `Sec-Fetch-Site: same-origin|none` when present (sent by modern
// browsers and not forgeable from script), and otherwise compare the Origin
// header to the expected origin. Requests with no Origin and no Sec-Fetch-Site
// (e.g. curl, native apps, server-to-server) are allowed through — they are not
// browser CSRF vectors and still need a valid session cookie.

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Build the Origin-check middleware.
 * @param {string} publicUrl e.g. "https://fitlog.example.com" (no trailing /).
 *   When empty, the middleware is a no-op (we cannot know the origin).
 * @param {(path:string)=>boolean} [isExempt] paths to skip (e.g. the webhook).
 */
export function originCheck(publicUrl, isExempt = () => false) {
  let expectedOrigin = null;
  if (publicUrl) {
    try {
      expectedOrigin = new URL(publicUrl).origin;
    } catch {
      expectedOrigin = null;
    }
  }

  return function originChecker(req, res, next) {
    if (!expectedOrigin) return next();
    if (!STATE_CHANGING.has(req.method)) return next();
    if (isExempt(req.path)) return next();

    const fetchSite = req.get('sec-fetch-site');
    if (fetchSite) {
      // same-origin and none (user typed URL / PWA) are fine; anything else
      // (cross-site, same-site subdomain) is rejected for a mutation.
      if (fetchSite === 'same-origin' || fetchSite === 'none') return next();
      return res.status(403).json({ error: 'Origen no permitido' });
    }

    const origin = req.get('origin');
    if (!origin) return next(); // non-browser client; session cookie still required
    if (origin === expectedOrigin) return next();
    return res.status(403).json({ error: 'Origen no permitido' });
  };
}
