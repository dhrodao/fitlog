// Strength estimates and personal-record definitions.
//
// These are deliberately simple, documented formulas. e1RM is an *estimate*,
// never a tested max, and the UI must label it as such.

/**
 * Estimated one-rep max for a single set using the Epley formula:
 *
 *     e1RM = weight * (1 + reps / 30)
 *
 * The estimate is computed PER SET: a set's own weight and its own reps. It is
 * wrong to multiply the heaviest weight of a session by the highest rep count
 * of a different, lighter set — that overstates strength. Callers take the
 * maximum of the per-set estimates.
 *
 * Returns 0 when weight or reps are missing/non-positive (nothing to estimate).
 * reps === 1 yields exactly the weight.
 *
 * @param {number|null|undefined} weightKg
 * @param {number|null|undefined} reps
 * @returns {number} estimated 1RM in kg (unrounded)
 */
export function epley1rm(weightKg, reps) {
  const w = Number(weightKg);
  const r = Number(reps);
  if (!Number.isFinite(w) || !Number.isFinite(r) || w <= 0 || r <= 0) return 0;
  // At a single rep the 1RM is the weight itself (Epley is defined for r > 1).
  if (r === 1) return w;
  return w * (1 + r / 30);
}

/**
 * Best estimated 1RM across a list of completed sets.
 * @param {Array<{weightKg:number|null,reps:number|null,completed?:boolean}>} sets
 * @returns {number} best per-set e1RM (unrounded); 0 if none qualify
 */
export function bestE1rm(sets) {
  let best = 0;
  for (const s of sets || []) {
    if (s.completed === false) continue;
    const e = epley1rm(s.weightKg ?? s.weight_kg, s.reps);
    if (e > best) best = e;
  }
  return best;
}

/**
 * Personal-record definitions for an exercise, documented explicitly so the UI
 * and tests agree on what a "PR" means:
 *
 *   - maxWeight:  heaviest weight lifted on any completed set.
 *   - bestE1rm:   highest per-set Epley estimate (see epley1rm).
 *   - maxReps:    most reps performed on any completed set (any weight).
 *   - maxVolume:  highest single-session volume (sum of weight*reps of the
 *                 completed sets of that exercise within one workout).
 *
 * @param {Array<{date:string, sets:Array}>} sessions each with its completed sets
 * @returns {{maxWeight:number|null, bestE1rm:number|null, maxReps:number|null, maxVolume:number|null}}
 */
export function personalRecords(sessions) {
  let maxWeight = 0;
  let e1rm = 0;
  let maxReps = 0;
  let maxVolume = 0;

  for (const session of sessions || []) {
    let sessionVolume = 0;
    for (const s of session.sets || []) {
      if (s.completed === false) continue;
      const w = Number(s.weightKg ?? s.weight_kg) || 0;
      const r = Number(s.reps) || 0;
      if (w > maxWeight) maxWeight = w;
      if (r > maxReps) maxReps = r;
      sessionVolume += w * r;
      const e = epley1rm(w, r);
      if (e > e1rm) e1rm = e;
    }
    if (sessionVolume > maxVolume) maxVolume = sessionVolume;
  }

  const round1 = (n) => Math.round(n * 10) / 10;
  return {
    maxWeight: maxWeight > 0 ? round1(maxWeight) : null,
    bestE1rm: e1rm > 0 ? round1(e1rm) : null,
    maxReps: maxReps > 0 ? maxReps : null,
    maxVolume: maxVolume > 0 ? round1(maxVolume) : null,
  };
}
