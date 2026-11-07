/**
 * Minimal client for the Hevy public API (https://api.hevyapp.com/docs/).
 *
 * Authentication is done with an API key sent in the `api-key` header.
 * You can create a key in the Hevy app (Pro): Settings -> Developer / API.
 *
 * Only read endpoints needed for importing are implemented:
 *   - GET /v1/exercise_templates   (paginated)
 *   - GET /v1/workouts             (paginated)
 *   - GET /v1/workouts/count
 */

const DEFAULT_BASE_URL = 'https://api.hevyapp.com/v1';

// Defaults used when the client is constructed without explicit options (e.g.
// in tests). The server passes values derived from config.hevy.
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 500;

export class HevyApiError extends Error {
  constructor(status, body, url) {
    super(`Hevy API ${status} for ${url}: ${body}`);
    this.name = 'HevyApiError';
    this.status = status;
    this.body = body;
  }
}

/** A read is worth retrying on 429, any 5xx, or a network/timeout failure. */
function isRetriableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HevyClient {
  constructor(
    apiKey,
    {
      baseUrl = DEFAULT_BASE_URL,
      fetchImpl = fetch,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxRetries = DEFAULT_MAX_RETRIES,
      backoffMs = DEFAULT_BACKOFF_MS,
    } = {}
  ) {
    if (!apiKey) throw new Error('Falta la API key de Hevy.');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(0, maxRetries);
    this.backoffMs = backoffMs;
  }

  /** Backoff for retry attempt `n` (0-based): base * 2^n + random jitter. */
  retryDelay(attempt) {
    const expo = this.backoffMs * 2 ** attempt;
    const jitter = Math.floor(Math.random() * this.backoffMs);
    return expo + jitter;
  }

  /** fetch wrapped with a per-request timeout via AbortSignal. */
  async fetchWithTimeout(url, options = {}) {
    // A manual controller + cleared timer, rather than AbortSignal.timeout, so
    // the timer never outlives the request (an uncleared timer would keep the
    // event loop busy after the call settles).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      // Normalize an abort into a clear, retriable timeout error.
      if (controller.signal.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        const e = new Error(
          `La petición a Hevy superó el tiempo límite (${this.timeoutMs} ms)`
        );
        e.name = 'HevyTimeoutError';
        e.retriable = true;
        throw e;
      }
      // A network failure (fetch rejects) is also retriable.
      if (err && !(err instanceof HevyApiError)) err.retriable = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async request(pathname, params = {}) {
    const url = new URL(`${this.baseUrl}${pathname}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    const target = url.toString();

    let attempt = 0;
    // One initial try + up to maxRetries retries. Only reads go through here,
    // so retrying is safe (idempotent).
    for (;;) {
      try {
        const res = await this.fetchWithTimeout(target, {
          headers: {
            'api-key': this.apiKey,
            Accept: 'application/json',
          },
        });
        const text = await res.text();
        if (!res.ok) {
          if (isRetriableStatus(res.status) && attempt < this.maxRetries) {
            await sleep(this.retryDelay(attempt));
            attempt += 1;
            continue;
          }
          throw new HevyApiError(res.status, text.slice(0, 300), target);
        }
        try {
          return JSON.parse(text);
        } catch {
          throw new HevyApiError(res.status, 'Respuesta no JSON', target);
        }
      } catch (err) {
        // Retry network/timeout failures; never retry a definitive API error.
        if (err?.retriable && attempt < this.maxRetries) {
          await sleep(this.retryDelay(attempt));
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * Perform a write request (POST/DELETE) with a JSON body. Writes are NOT
   * retried: a retry could duplicate a non-idempotent mutation. They still get
   * a timeout so they cannot hang.
   */
  async send(pathname, method, body) {
    const url = `${this.baseUrl}${pathname}`;
    const res = await this.fetchWithTimeout(url, {
      method,
      headers: {
        'api-key': this.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new HevyApiError(res.status, text.slice(0, 300), url);
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }

  /** Current webhook subscription (throws 404 if none). */
  async getWebhookSubscription() {
    return this.request('/webhook-subscription');
  }

  /** Create/replace the webhook subscription. */
  async createWebhookSubscription({ url, authToken }) {
    return this.send('/webhook-subscription', 'POST', { url, authToken });
  }

  /** Remove the webhook subscription. */
  async deleteWebhookSubscription() {
    return this.send('/webhook-subscription', 'DELETE');
  }

  /** Iterate over every page of a paginated collection. */
  async *paginate(pathname, collectionKey, { pageSize = 10 } = {}) {
    let page = 1;
    // Hevy caps pageSize (commonly at 10 for workouts); respect what it returns.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const data = await this.request(pathname, { page, pageSize });
      const items = Array.isArray(data[collectionKey])
        ? data[collectionKey]
        : [];
      for (const item of items) yield item;

      const pageCount = Number(data.page_count ?? data.pageCount ?? 1);
      if (!items.length || page >= pageCount) break;
      page += 1;
    }
  }

  async workoutCount() {
    const data = await this.request('/workouts/count');
    return Number(data.workout_count ?? data.count ?? 0);
  }

  async *exerciseTemplates({ pageSize = 100 } = {}) {
    yield* this.paginate('/exercise_templates', 'exercise_templates', {
      pageSize,
    });
  }

  async *workouts({ pageSize = 10 } = {}) {
    yield* this.paginate('/workouts', 'workouts', { pageSize });
  }

  async *routines({ pageSize = 10 } = {}) {
    yield* this.paginate('/routines', 'routines', { pageSize });
  }

  async *routineFolders({ pageSize = 10 } = {}) {
    yield* this.paginate('/routine_folders', 'routine_folders', { pageSize });
  }

  /**
   * Incremental sync feed. Yields event objects of the form
   * { type: 'updated'|'deleted', workout?: {...}, id?: string }.
   * `since` is an ISO timestamp; only events after it are returned.
   */
  async *workoutEvents({ since, pageSize = 10 } = {}) {
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const params = { page, pageSize };
      if (since) params.since = since;
      const data = await this.request('/workouts/events', params);
      const events = Array.isArray(data.events) ? data.events : [];
      for (const event of events) yield event;

      const pageCount = Number(data.page_count ?? data.pageCount ?? 1);
      if (!events.length || page >= pageCount) break;
      page += 1;
    }
  }
}

/**
 * Convert a Hevy API workout object into the normalized shape consumed by
 * server/hevy-import.js (importWorkout).
 */
export function hevyApiWorkoutToNormalized(w) {
  const exercises = (w.exercises || [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((ex) => ({
      name: ex.title,
      templateId: ex.exercise_template_id || null,
      notes: ex.notes || null,
      supersetId:
        ex.superset_id === null || ex.superset_id === undefined
          ? null
          : ex.superset_id,
      sets: (ex.sets || [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((set) => ({
          weightKg:
            set.weight_kg === undefined ? null : set.weight_kg,
          reps: set.reps === undefined ? null : set.reps,
        })),
    }));

  return {
    hevyWorkoutId: w.id != null ? String(w.id) : null,
    name: w.title || 'Entreno',
    startedAt: w.start_time ? new Date(w.start_time).toISOString() : null,
    finishedAt: w.end_time ? new Date(w.end_time).toISOString() : null,
    notes: w.description || null,
    exercises,
  };
}

/** Derive a target-reps string ("8-12", "10", or null) from a routine set. */
function setTargetReps(set) {
  if (!set) return null;
  const range = set.rep_range;
  if (range && (range.start != null || range.end != null)) {
    if (range.start != null && range.end != null) return `${range.start}-${range.end}`;
    return String(range.start ?? range.end);
  }
  if (set.reps != null) return String(set.reps);
  return null;
}

/**
 * Convert a Hevy API routine object into the shape consumed by the routine
 * importer. Target sets = number of sets; target reps are derived from the
 * first set that declares reps or a rep range.
 */
export function hevyApiRoutineToNormalized(r) {
  const exercises = (r.exercises || [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((ex) => {
      const sets = ex.sets || [];
      const repsSet = sets.find((s) => setTargetReps(s) != null);
      return {
        name: ex.title,
        templateId: ex.exercise_template_id || null,
        notes: ex.notes || null,
        targetSets: sets.length || 1,
        targetReps: setTargetReps(repsSet) || null,
      };
    });

  return {
    hevyRoutineId: r.id != null ? String(r.id) : null,
    name: r.title || 'Rutina',
    folderId: r.folder_id == null ? null : r.folder_id,
    updatedAt: r.updated_at || null,
    exercises,
  };
}
