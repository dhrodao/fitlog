# FitLog — Technical Assessment and Implementation Roadmap

> **Status of this document:** Completed
> **Repository analyzed:** local checkout (commit `0cbd794`)
> **Analysis date:** 2026-11-07
> **Author role:** Senior software architect / technical lead
> **Scope:** analysis and planning only. No application code, tests, configuration, database or deployment files were modified.

## How to read this document

This report was written incrementally while inspecting the repository. Sections
carry an explicit status: `Pending`, `In progress`, or `Completed`. Claims are
labelled where useful:

- **Confirmed** — verified directly in source code or by a read-only command.
- **Assumption** — plausible but not verified; needs confirmation.
- **Risk** — a confirmed or probable negative consequence.
- **Recommendation** — a proposed change, not yet implemented.

All paths are relative to the repository root.

## Table of contents

1. [Executive summary](#1-executive-summary) — *Completed*
2. [Current architecture overview](#2-current-architecture-overview) — *Completed*
3. [Strengths of the existing implementation](#3-strengths-of-the-existing-implementation) — *Completed*
4. [Confirmed problems and potential risks](#4-confirmed-problems-and-potential-risks) — *Completed*
5. [Detailed assessment of roadmap areas A–E](#5-detailed-assessment-of-roadmap-areas-ae) — *Completed*
6. [Architectural and technology recommendations](#6-architectural-and-technology-recommendations) — *Completed*
7. [Prioritized implementation backlog](#7-prioritized-implementation-backlog) — *Completed*
8. [Proposed implementation milestones](#8-proposed-implementation-milestones) — *Completed*
9. [Testing and validation strategy](#9-testing-and-validation-strategy) — *Completed*
10. [Product-owner decisions and open questions](#10-product-owner-decisions-and-open-questions) — *Completed*
11. [What I would do next](#11-what-i-would-do-next) — *Completed*

---

## 1. Executive summary

*Status: Completed.*

FitLog is a small, coherent, single-process fitness tracker: an Express 4 API, a
SQLite database through `better-sqlite3`, and a build-less vanilla-JavaScript
PWA. The architecture is appropriate for a personal application and does not
need a framework or database migration. The code is generally readable, the
schema is normalised, foreign keys are enabled, user-scoped queries are used
consistently, and the UI has clearly benefited from deliberate mobile polish.

The most important problems are not architectural. They are concrete
data-integrity and reliability gaps:

1. **Set autosave can lose data.** The active workout uses one shared 500 ms
   debounce for every set (`public/js/views/active.js`,
   `const persistSet = debounce(...)`). Editing two different sets within that
   window persists only the last one, and navigating away cancels the pending
   write entirely (`persistSet.cancel?.()` in the cleanup function).
2. **Hevy incremental sync is not truly idempotent for updates.** Imported
   workouts have no Hevy workout id; duplicate detection uses
   `(user_id, name, started_at)` (`server/hevy-import.js`,
   `workoutExists()`). A renamed workout becomes a duplicate, while an updated
   workout with the same name and start time is skipped, so changed sets or
   notes are never applied. There is also no database unique constraint backing
   the check.
3. **There is no automated backup or tested restore path.** The SQLite file is
   bind-mounted and the README explains how to copy it, but nothing schedules,
   verifies or restores backups.
4. **Any Google account can create an account** on a publicly tunnelled
   personal server (`server/auth.js`, `upsertGoogleUser()`), with no allowlist
   and no auth rate limiting.
5. **Measurements silently overwrite omitted fields.** A same-date partial
   update replaces `weight_kg`, `body_fat`, `waist_cm` and `notes` with the
   incoming values, including `null` (`server/routes/measurements.js`,
   `ON CONFLICT(user_id, date) DO UPDATE`).

Testing is the weakest engineering area: two `node:test` files cover a happy
path and catalog migration/sync, but there are no tests for Hevy sync, webhooks,
cross-user isolation, session expiry or the active-workout persistence path.
The deploy workflow does not run tests and has no rollback path.

The recommended sequence is deliberately narrow: stop the active-workout data
loss, add automated backups and restore validation, add a small critical-flow
test/CI gate, then fix the Hevy identity model before expanding workout UX or
attempting offline mode or Apple Health. Offline workout capture is worthwhile
only if it is made a product priority; it is not a small service-worker change.
Apple Health cannot be reached from a PWA, so it would require a native
companion, not a rewrite.

---

## 2. Current architecture overview

*Status: Completed.*

### 2.1 Repository layout

| Area | Path | Responsibility |
|---|---|---|
| Entry point | `server/index.js` | Starts Express, triggers catalog sync, starts the Hevy scheduler. |
| App composition | `server/app.js` | Helmet/CSP, JSON body parsing, cookies, auth attachment, route mounting, static files, error handler. |
| Configuration | `server/config.js`, `.env.example` | Environment parsing and production safety checks. |
| Database | `server/db.js` | Schema, pragmas, ad-hoc migrations, `meta` helpers. |
| Auth | `server/auth.js`, `server/routes/auth.js` | Google ID-token login, dev login, server-side sessions, cookies. |
| API routes | `server/routes/*.js` | HTTP validation and orchestration for auth, exercises, routines, workouts, measurements, stats, imports and the Hevy webhook. |
| Domain services | `server/services/workouts.js`, `server/services/exercises.js` | Workout/set operations and exercise resolution. Some routine/measurement/stat logic still lives in route files. |
| Hevy | `server/hevy-client.js`, `hevy-import.js`, `hevy-routines-import.js`, `hevy-sync.js`, `hevy-templates.js` | API client, normalisation, CSV/API import, incremental sync, routines, template cache. |
| Catalog | `server/catalog.js`, `catalog-media.js` | free-exercise-db sync, name mapping, image/video proxy/cache. |
| Frontend shell | `public/index.html`, `public/js/app.js` | Hash router, view lifecycle, bottom navigation, theme, service-worker registration. |
| Frontend views | `public/js/views/*.js` | One module per screen, each exporting `render(container, ctx, params)` and optionally a cleanup function. |
| Frontend infrastructure | `public/js/api.js`, `ui.js`, `charts.js`, `exercise-picker.js`, `swipe.js`, `pull-refresh.js`, `theme.js` | Fetch wrapper, escaping/icons/dialogs/toasts, SVG charts, shared picker and mobile gestures. |
| PWA | `public/manifest.webmanifest`, `public/sw.js`, `public/assets/*` | Installability, shell precache, navigation fallback, static stale-while-revalidate. |
| Tests | `test/api.test.js`, `test/catalog.test.js` | `node:test` + `supertest`, temporary SQLite files. |
| Deployment | `Dockerfile`, `docker-compose.yml`, `.github/workflows/deploy.yml` | Node 20 image, non-root runtime, host networking, Cloudflare Tunnel, self-hosted deploy. |

The repository is small enough to hold in one head: roughly 5,400 lines of
backend JavaScript and 9,200 lines of frontend JavaScript/CSS. There is no
build step and no generated code.

### 2.2 Backend architecture

**Request lifecycle (confirmed).** `createApp()` in `server/app.js` builds a
single Express application:

1. In production, `app.set('trust proxy', 1)` so the app can read
   `X-Forwarded-*` from the Cloudflare Tunnel.
2. Helmet runs with an explicit CSP and COOP/CORP settings.
3. `express.json({ limit: '5mb' })` and `cookie-parser`.
4. `attachUser` resolves `fit_session` to `req.user` on every request.
5. `/api/auth` is public; `/api/exercises`, `/api/routines`, `/api/workouts`,
   `/api/measurements`, `/api/stats` and `/api/import` are mounted behind
   `requireAuth`; `/api/hevy` is public because the webhook authenticates with
   a per-user bearer token.
6. `express.static('public')` serves the shell with `Cache-Control: no-cache`.
7. A catch-all returns `index.html` for non-API routes (hash routing).
8. A final error middleware maps `HttpError` to JSON and hides internal
   messages in production.

This is a clean, conventional Express structure. Route files are thin in the
workout domain (delegating to `services/workouts.js`) but carry more business
logic than ideal in `routes/routines.js`, `routes/measurements.js` and
`routes/stats.js`.

**Data access (confirmed).** `server/db.js` opens SQLite synchronously, sets
`journal_mode = WAL`, `foreign_keys = ON`, and `busy_timeout = 5000`. Queries
are prepared and executed synchronously through `better-sqlite3`. Multi-step
writes use `db.transaction(...)` in routines, workout supersets, imports and
catalog sync. Because the process is single-threaded and `better-sqlite3` is
synchronous, a transaction cannot interleave with another request in the same
process.

**Background work (confirmed).** `server/index.js` starts:
- a best-effort catalog sync on boot if the catalog is empty/stale;
- `startSyncScheduler({ intervalHours: 6 })`, which calls `syncAllAutoUsers()`.
  There is no overlap guard, no timeout around Hevy HTTP calls, and no persistent
  job queue. The webhook handler acknowledges Hevy immediately and runs
  `syncUser()` in an unawaited promise (`server/routes/hevy-webhook.js`).

**Configuration (confirmed).** `server/config.js` centralises `.env` parsing:
`PORT`, `NODE_ENV`, `DB_PATH`, `GOOGLE_CLIENT_ID`, `ALLOW_DEV_LOGIN`,
`COOKIE_SECURE`, `PUBLIC_URL`, `SESSION_DAYS`, `SESSION_SECRET` and
`CATALOG_SYNC_DAYS`. Production refuses to boot with the development session
secret; dev login is forced off when `NODE_ENV=production`. Numeric values are
not range-validated, and `COOKIE_SECURE` is not enforced in production.

### 2.3 Frontend architecture

**Routing and state (confirmed).** `public/js/app.js` implements a hash router
with an explicit route table. Each view is an ES module with
`render(container, ctx, params)`. The router awaits the view, stores its cleanup
function, and calls it before the next navigation. Shared state is a single
module-level object (`state.user`, `state.authConfig`, `state.activeWorkout`);
views fetch their own data through `public/js/api.js` and mutate local state.
There is no client-side cache, store or persistence layer beyond
`localStorage` for theme and collapsed routine folders.

**UI organisation (confirmed).** `ui.js` contains icon paths, HTML escaping,
formatters, toasts, modals/action sheets and confirm dialogs. `charts.js`
renders inline SVG line/bar charts with pointer and touch interaction.
`exercise-picker.js` is a shared catalog/my-exercises picker with a muscle-group
sheet. `swipe.js` and `pull-refresh.js` encapsulate mobile gestures. CSS is split
into `tokens.css`, `base.css`, `components.css` and `views.css`; it is large but
thematically organised and uses safe-area variables.

**Rendering model (confirmed).** Views build HTML strings with template
literals and attach listeners after `innerHTML`. User-controlled strings are
generally passed through `esc()`. The model is simple and fast for this size,
but it duplicates markup (the workout card appears in `home.js`,
`training.js`, `history.js` and `profile.js`; `groupExercises()` and week-label
helpers are duplicated) and relies on discipline to avoid XSS regressions.

### 2.4 Dependency flow

```text
server/index.js
  ├─ server/app.js ── routes/* ── services/* ── db.js
  │                        ├─ auth.js ── db.js/config.js
  │                        ├─ catalog.js ── catalog-media.js
  │                        └─ hevy-sync.js
  │                              ├─ hevy-client.js
  │                              ├─ hevy-import.js ── services/exercises.js
  │                              ├─ hevy-routines-import.js
  │                              ├─ hevy-templates.js
  │                              └─ crypto-box.js ── config.js
  └─ catalog.js / hevy-sync.js (background)

public/js/app.js ── views/* ── api.js
       │                 ├─ ui.js
       │                 ├─ charts.js
       │                 ├─ exercise-picker.js
       │                 └─ swipe.js / pull-refresh.js
       └─ sw.js (independent service worker)
```

There are no circular imports of consequence. The main coupling risks are
module-level caches in `catalog.js`, `hevy-import.js` and `hevy-templates.js`
(they are not invalidated after a catalog re-sync) and the duplicated Hevy
import orchestration across `routes/import.js`, `hevy-sync.js`,
`import-hevy-csv.js` and `import-hevy-api.js`.

### 2.5 Database model and migration approach

**Tables (confirmed, `server/db.js`):**

| Table | Key relationships / constraints |
|---|---|
| `users` | `google_sub` unique; `is_dev` flag. |
| `sessions` | `token_hash` primary key; FK to `users` with `ON DELETE CASCADE`; indexes on user and expiry. |
| `exercise_catalog` | Global catalog; text id; name/category indexes. |
| `exercises` | Per-user exercise; FK to `users` and optional `exercise_catalog`; `UNIQUE(user_id, name)`. |
| `routines` | Per-user; `source` and `hevy_routine_id`; partial unique index `(user_id, hevy_routine_id)`. |
| `routine_exercises` | FK to routine and exercise; position, target sets/reps, notes. |
| `workouts` | Per-user; optional routine FK (`ON DELETE SET NULL`); `source`; no external Hevy id; index `(user_id, started_at DESC)`. |
| `workout_exercises` | FK to workout/exercise; position, notes, `superset_group`. |
| `workout_sets` | FK to workout_exercise; weight, reps, completed, rest seconds; index `(workout_exercise_id, set_number)`. |
| `measurements` | Per-user; `UNIQUE(user_id, date)`; weight/body fat/waist/notes. |
| `hevy_sync` | One row per user; encrypted API key, auto-sync, last sync/error, webhook token/enabled. |
| `hevy_templates` | Per-user cache of Hevy exercise templates; PK `(user_id, template_id)`. |
| `meta` | Key/value metadata for catalog sync status. |

**Integrity observations:**

- Foreign keys are enabled and cascade rules are sensible; deleting a routine
  preserves its workouts (`routine_id` becomes `NULL`).
- `workouts` has **no** unique constraint for imported Hevy workouts. The
  duplicate check is application-level in `hevy-import.js`.
- `routine_exercises` and `workout_exercises` do not enforce unique positions,
  and `workout_sets` does not enforce unique `(workout_exercise_id, set_number)`.
  The services renumber rows after deletes, but the database cannot prevent a
  bug from producing duplicate positions/numbers.
- `routine_exercises.exercise_id` is not constrained to the same `user_id` as
  the routine. Application paths resolve exercises per user, so this is not a
  confirmed exploit, but it is a latent isolation gap at the schema level.
- `hevy_sync.last_cursor` exists but is never written or read; incremental sync
  uses `last_sync_at`.

**Migration strategy:** `CREATE TABLE IF NOT EXISTS` plus `ensureColumn()` calls
and one bespoke legacy-catalog migration. There is no `schema_migrations` table,
no ordered migration files, no down path, and no transaction wrapping the whole
schema bootstrap. Most operations are idempotent, but there is no record of
which schema version a database is on. This is acceptable for a small personal
app today, but it will become risky as soon as a change requires a backfill or
a data transformation.

### 2.6 Multi-user isolation

*Status: Completed.*

The code is consistently user-scoped. Confirmed examples:

- Every workout helper starts with `assertWorkout(userId, workoutId)`, which
  queries `WHERE id = ? AND user_id = ?`.
- `getWorkoutDetail` verifies the workout owner, then loads child rows by
  workout id; sets are reached through the verified workout.
- `resolveExercise` only returns an exercise where `user_id = ?`.
- Routine helpers use `getRoutineOr404(userId, id)`.
- Measurements and stats queries filter by `req.user.id`; the exercise-stats
  endpoint verifies the exercise owner before querying.
- Hevy import functions take `userId` and scope templates, workouts and
  routines to it.
- The webhook resolves a user from the bearer token and syncs only that user.

I did not find a route that returns another user's data. The remaining risk is
not an obvious IDOR but the absence of tests that prove isolation, plus the
schema-level gaps noted above. That distinction matters: the current code looks
correct, but a regression would not be caught.

### 2.7 Authentication and session mechanics

*Status: Completed.*

- **Google login:** the browser obtains a Google ID token via Google Identity
  Services; `POST /api/auth/google` verifies it with `google-auth-library`
  (`OAuth2Client.verifyIdToken`) and `GOOGLE_CLIENT_ID` as audience. No client
  secret is stored. There is no email/hosted-domain allowlist, so any verified
  Google account is accepted.
- **Dev login:** `POST /api/auth/dev` creates/reuses a fixed `dev@local` user
  when `ALLOW_DEV_LOGIN` is not `false` and `NODE_ENV` is not `production`.
- **Sessions:** a 32-byte random token is returned to the browser; only its
  SHA-256 hash is stored in `sessions`. The cookie is `httpOnly`, `sameSite=lax`,
  `path=/`, `secure` only when `COOKIE_SECURE=true`, and expires after
  `SESSION_DAYS` (default 30). Expired sessions are deleted on the next
  `createSession()` call and rejected lazily on request.
- **Logout:** deletes the current session row and clears the cookie.
- **No passwords or password hashes are stored.**

### 2.8 Hevy integration mechanics

*Status: Completed.*

There are two distinct import paths:

1. **One-off import** (`server/routes/import.js`): CSV upload or a pasted API
   key, with a dry-run/write toggle. The API key is used transiently and not
   stored.
2. **Persistent sync** (`server/hevy-sync.js`): the API key is validated with
   `GET /workouts/count`, encrypted with AES-256-GCM
   (`server/crypto-box.js`), and stored in `hevy_sync.api_key`. Manual sync,
   6-hourly automatic sync and an optional webhook are supported.

**Sync flow (confirmed):**

1. Load and decrypt the key; create `HevyClient`.
2. Fetch all exercise templates (non-fatal on failure), cache them in
   `hevy_templates`, and build a template-name → catalog-id map.
3. If `last_sync_at` exists, read `/v1/workouts/events?since=...`; otherwise pull
   all workouts via paginated `/v1/workouts`.
4. Normalise workouts, sort by start time, import them inside a transaction.
5. Import routines/folders (full pull every time, upserted by
   `hevy_routine_id`), then re-link imported workouts to routines by normalised
   name.
6. Set `last_sync_at = syncStartedAt` and `last_status='ok'`.

**What is good:** API-key validation, encryption at rest, masked display,
timing-safe webhook-token comparison, per-user webhook tokens, immediate webhook
acknowledgement, full-vs-incremental fallback, routine upsert keyed by a stable
Hevy id, and non-fatal template/routine failures.

**What is not:** imported workouts have no stable Hevy identity; updates are
not applied; deletes are ignored; there is no per-user lock, HTTP timeout,
retry/backoff, or persistent job record; routine failures are logged only to the
console while the sync still reports `ok`; and the README's claim that repeated
syncs "never duplicate workouts" is not strictly true for renamed workouts.

### 2.9 PWA mechanics

*Status: Completed.*

- `public/manifest.webmanifest`: standalone display, portrait, Spanish locale,
  SVG and 192/512 PNG icons, maskable icon, `start_url`/`scope` at `/`.
- `public/sw.js`: versioned cache (`fitlog-v10`), best-effort precache of the
  shell (`/`, `/index.html`, four CSS files, `app.js`, manifest, one icon),
  network-first navigation with cached `/index.html` fallback,
  stale-while-revalidate for other same-origin GETs, and an explicit bypass for
  `/api/`.
- `public/index.html`: viewport-fit, theme colour, Apple mobile web app meta
  tags, Apple touch icon, no inline application script.
- The service worker is registered on `load` and failures are ignored.

**Confirmed offline behaviour:** API requests are never cached; `/api/auth/me`
fails offline; `app.js` then sets `state.user = null` and routes to `/login`;
the login view cannot obtain `/api/auth/config` and cannot authenticate. Even if
the shell renders, there is no cached workout data and no write queue. Therefore
FitLog is currently **not usable offline for workout logging**, despite being
installable and shell-capable.

### 2.10 Infrastructure and deployment

*Status: Completed.*

| Concern | Current implementation | Evidence |
|---|---|---|
| Container | `node:20-bookworm-slim`, multi-stage, production deps only, `USER node` | `Dockerfile` |
| Runtime | Express on `PORT` (default 3000), SQLite at `DB_PATH` | `server/config.js`, `server/index.js` |
| Persistence | Host bind mount `./data:/app/data` | `docker-compose.yml` |
| Reverse proxy | Cloudflare Tunnel via `cloudflared` service, host networking | `docker-compose.yml` |
| Health check | `GET /api/health` in Docker and Compose; deploy script probes it | `Dockerfile`, `docker-compose.yml`, `.github/workflows/deploy.yml` |
| CI/CD | GitHub Actions self-hosted runner, `git reset --hard origin/main`, rebuild `app` | `.github/workflows/deploy.yml` |
| Rollback | None: the local `fitness-app` image tag is overwritten; no previous image/SHA retained | `.github/workflows/deploy.yml` |
| Backups | Manual only; README suggests copying the DB or `sqlite3 .backup` | `README.md` |
| Logs | `console.log`/`console.warn`/`console.error` to container stdout | `server/*` |
| Monitoring | None beyond the HTTP health probe | repository-wide |
| Secrets | `.env` (gitignored), `SESSION_SECRET`, encrypted Hevy key | `.env.example`, `server/crypto-box.js` |

The deployment is intentionally simple and appropriate for a single host.
Its weak points are operational: no test gate, no pre-deploy backup, no image
versioning/rollback, and a health check that only proves the HTTP listener is
alive (it does not touch SQLite or verify auth).

### 2.11 Testing setup

*Status: Completed.*

- Framework: built-in `node:test` with `supertest` (`package.json`,
  `"test": "node --test"`).
- `test/api.test.js`: one long happy-path test with subtests covering dev login,
  custom exercises, routine CRUD, starting a routine, set updates, finishing,
  history, stats, measurements, duplicate/delete routine, delete set/exercise,
  supersets/reorder/replace, and logout.
- `test/catalog.test.js`: a legacy wger-schema migration fixture, catalog
  mapping/serialisation, catalog sync/linking, and catalog API access.
- Tests set `DB_PATH` to a temporary file and delete it afterwards. They do not
  touch a development database.
- No coverage configuration, no CI test job, no Hevy fixtures, no multi-user
  isolation tests, no auth-expiry tests, no browser/PWA tests.

*Limitation:* I could not execute `npm test` in this environment because
`node_modules` is absent and installing dependencies is outside the authorised
scope. I did run `node --check` on every `.js` file (all passed) and parsed the
JSON assets successfully. See §9.7 for the full limitation list.

---

## 3. Strengths of the existing implementation

*Status: Completed.*

1. **Right-sized architecture.** Express + SQLite + vanilla ES modules is a
   good fit for a personal app. There is no build pipeline to maintain and no
   unnecessary distributed infrastructure.
2. **Clean data model with real referential integrity.** `foreign_keys = ON`,
   cascading deletes, `UNIQUE(user_id, name)` for exercises and
   `UNIQUE(user_id, date)` for measurements prevent several classes of bad data.
3. **Consistent user scoping.** Workout, routine, exercise, measurement, stats
   and import queries are scoped to `req.user.id`; ownership is asserted before
   child rows are loaded.
4. **Good session design for this scale.** Random 256-bit session tokens,
   SHA-256 at rest, `httpOnly`/`SameSite=Lax` cookies, server-side expiry, and
   no password storage. Google ID-token verification uses the official library
   and the correct audience.
5. **Hevy integration is deeper than a toy import.** It validates keys, encrypts
   them at rest, supports CSV and API import, incremental events, routine
   folders, template-id exercise resolution, per-user webhooks with
   timing-safe token comparison, and an explicit "delete imported data" escape
   hatch.
6. **Production-aware configuration.** The app refuses to boot in production
   with the development session secret, disables dev login in production, and
   documents the required environment variables.
7. **Thoughtful mobile UX.** Safe-area padding, 16px inputs to avoid iOS zoom,
   large touch targets, haptic feedback, swipe-to-delete sets, pull-to-refresh,
   bottom navigation, and previous-set placeholders all show real product care.
8. **No obvious injection or XSS pattern.** SQL is parameterised; user strings
   are generally escaped before `innerHTML`; CSP disables inline scripts; CORS
   is not opened.
9. **Deployment is reproducible and non-root.** Multi-stage build, locked
   dependencies, production-only modules, a non-root `node` user, a persistent
   bind mount, and a health check are all present.
10. **Tests are isolated from real data.** The existing tests use temporary
    SQLite files and clean up, which is the right foundation for expanding them.
11. **The frontend has a clear extension point.** `render(container, ctx,
    params)` plus optional cleanup is easy to reason about and cheap to extend
    without a framework.
12. **Error handling is centralised.** `HttpError` and `asyncHandler` keep route
    handlers readable, and production hides internal error messages.

---

## 4. Confirmed problems and potential risks

*Status: Completed.*

Severity here is a preliminary classification; the actionable tasks and
dependencies are in §7.

| ID | Severity | Status | Finding | Evidence |
|---|---|---|---|---|
| R-01 | Critical | Confirmed | Active-workout set edits use one shared debounce; edits to two sets within 500 ms persist only the last set. Navigating away cancels the pending save. | `public/js/views/active.js` (`persistSet`, cleanup `persistSet.cancel?.()`); `public/js/ui.js` (`debounce`) |
| R-02 | Critical | Confirmed | A failed set save only shows a toast; there is no retry queue or offline durable write. Reloading loses the unsaved value. | `public/js/views/active.js` `persistSet` catch block; `public/js/views/active.js` completion handler |
| R-03 | Critical | Confirmed | Hevy workouts have no stable external id; duplicate detection is `(user_id, name, started_at)`. Renames create duplicates; updates with the same key are skipped, so changed sets/notes are not applied. | `server/db.js` `workouts` table; `server/hevy-import.js` `workoutExists()`/`importWorkout()`; `server/hevy-sync.js` event loop |
| R-04 | Critical | Confirmed | No database unique constraint backs Hevy import idempotency. | `server/db.js` (`workouts` has only non-unique indexes) |
| R-05 | Critical | Confirmed | No automated database backup, retention or restore test. SQLite WAL files make naive file copies unsafe while running. | `README.md` persistence section; `docker-compose.yml` bind mount; no backup script/workflow |
| R-06 | High | Confirmed | Any Google account can register on the public instance; there is no allowlist. | `server/auth.js` `upsertGoogleUser()`; `server/routes/auth.js` `POST /google`; no allowlist in `server/config.js` |
| R-07 | High | Confirmed | No rate limiting on auth, imports or sync endpoints; the 5 MB JSON limit plus synchronous CSV parsing allows authenticated (or, for dev login, unauthenticated) resource abuse. | `server/app.js` `express.json({ limit: '5mb' })`; `server/routes/import.js` `POST /hevy/csv`; no rate-limit middleware |
| R-08 | High | Confirmed | Same-date measurement updates overwrite fields that were omitted from the request with `NULL`; recording weight and body fat on the same date can erase the earlier value. | `server/routes/measurements.js` `ON CONFLICT ... SET weight_kg = excluded.weight_kg` etc.; `public/js/views/measurements.js` sends `null` for empty fields |
| R-09 | High | Confirmed | Hevy sync has no HTTP timeout, retry/backoff, per-user lock or overlap guard. Webhook work is in-process and disappears on restart. | `server/hevy-client.js` (`fetch` without `AbortSignal`); `server/hevy-sync.js` `syncUser`/`startSyncScheduler`; `server/routes/hevy-webhook.js` |
| R-10 | High | Confirmed | Routine import failures are swallowed and the sync still reports `ok`; users see "Todo al día" even when routines failed. | `server/hevy-sync.js` routines `try/catch`; `public/js/views/profile.js` `syncTotalsSummary` |
| R-11 | High | Confirmed | Finished workouts cannot be edited from the UI (sets, notes, name, location), although the API supports workout metadata updates. Mistakes are permanent. | `public/js/views/workout.js` has no edit action; `api.workouts.update` is unused |
| R-12 | High | Confirmed | Decimal comma input is converted to `NaN` and then visibly clamped to `0` for sets; measurement inputs become `null` in JSON. Spanish-locale users can lose values. | `public/js/views/active.js` input handler (`Number(raw)`); `public/js/views/measurements.js` `Number(value)`; `server/http.js` `toNumber` |
| R-13 | High | Confirmed | `stats/exercise/:exerciseId` exists and computes useful history/estimated 1RM, but no view calls it. Exercise progression is not surfaced. | `server/routes/stats.js`; `public/js/api.js` `stats.exercise`; no caller in `public/js/views` |
| R-14 | Medium | Confirmed | Estimated 1RM uses `max_weight` and `max_reps` from potentially different sets, overestimating strength. PRs count only max weight, not reps/volume/e1RM. | `server/routes/stats.js` (`best1rm`, `MAX(... max_reps)`); `server/services/workouts.js` `prCount` |
| R-15 | Medium | Confirmed | Weekly stats buckets are computed in UTC, while UI dates use local time; workouts near midnight can land in the wrong week. Date-only measurements parse as UTC midnight. | `server/routes/stats.js` `startOfWeek`/`dateKey`; `public/js/ui.js` `formatDate` |
| R-16 | Medium | Confirmed | Session cookie security depends on manually setting `COOKIE_SECURE=true`; production does not refuse insecure cookies. No `__Host-` prefix, no session rotation/sliding expiry, no revoke-all. | `server/config.js` `cookieSecure`; `server/auth.js` `createSession`/`setSessionCookie` |
| R-17 | Medium | Confirmed | No test coverage for Hevy sync, webhook auth, multi-user isolation, session expiry, or the autosave path; deploy does not run tests. | `test/*.test.js`; `.github/workflows/deploy.yml` |
| R-18 | Medium | Confirmed | Schema migrations are ad-hoc (`ensureColumn`, one bespoke migration) with no version table or transactional runner. | `server/db.js` |
| R-19 | Medium | Confirmed | Health check only returns `{ok,time}` and never queries SQLite; the deploy gate can pass while the database is unwritable. | `server/app.js` `/api/health`; `Dockerfile`/`docker-compose.yml` health checks |
| R-20 | Medium | Confirmed | Deploy has no rollback: the local image tag is overwritten and the workflow does not retain/redeploy the previous one. | `.github/workflows/deploy.yml` `docker compose up -d --build app` |
| R-21 | Medium | Confirmed | PWA offline shell is incomplete: precache omits view modules and images; a first offline launch of an unvisited route cannot load its module. `/api` is intentionally uncached, so there is no data to display. | `public/sw.js` `PRECACHE`, `/api/` bypass; `public/js/app.js` boot/handleRoute |
| R-22 | Medium | Confirmed | Cache version is manual (`fitlog-v10`). A deploy that changes shell assets without bumping it can leave offline clients on stale code. | `public/sw.js` `CACHE_VERSION`; `README.md` PWA section |
| R-23 | Medium | Confirmed | Module-level catalog caches are never invalidated after a catalog re-sync; Hevy name resolution can use stale catalog data until process restart. | `server/hevy-import.js` `catalogByNormCache`; `server/hevy-templates.js` `catalogByNormCache`; `_clearCatalogCache()` has no caller |
| R-24 | Medium | Confirmed | No graceful shutdown or `db.close()`; in-flight writes/checkpoints are not drained on deploy/restart. | `server/index.js`; no signal handlers |
| R-25 | Low | Confirmed | Dev login is CSRF-able (bodyless `POST /auth/dev`), and there is no Origin/Sec-Fetch-Site check on state-changing requests. Production disables it, so impact is limited to non-production. | `server/routes/auth.js` `POST /dev`; `server/app.js` no CSRF middleware |
| R-26 | Low | Confirmed | `addExerciseToWorkout` still accepts `prefill` and `targetReps` but ignores both after the empty-set change; dead API surface. | `server/services/workouts.js` `addExerciseToWorkout`; `server/routes/workouts.js` |
| R-27 | Low | Confirmed | `hevy_sync.last_cursor` is dead schema; `hevy_sync` template cache survives disconnect; `hevy_templates` has unused fields. | `server/db.js`; `server/hevy-sync.js` `disconnect` |
| R-28 | Low | Confirmed | CSV parser does not strip a UTF-8 BOM from the header; a BOM-prefixed Hevy CSV can fail the required-column check. Large CSVs are also parsed synchronously under a 5 MB JSON limit. | `server/hevy-import.js` `parseCsvObjects`; `server/routes/import.js` |
| R-29 | Low | Confirmed | Routine/workout cards and chart week-label helpers are duplicated across views; the workout card appears in four files. | `public/js/views/home.js`, `training.js`, `history.js`, `profile.js` |
| R-30 | Low | Confirmed | Routine editor discards unsaved changes without confirmation when navigating back. | `public/js/views/routine-editor.js` `data-cancel` |

**What is not a confirmed problem:** I did not find evidence of SQL injection,
stored XSS, cross-user data leakage in current routes, or a broken CSRF defence
for authenticated JSON endpoints. SameSite=Lax plus JSON-only parsing means
cross-site authenticated state changes are not sent with cookies; the residual
CSRF surface is the bodyless dev-login endpoint and the absence of an explicit
Origin check.

---

## 5. Detailed assessment of roadmap areas A–E

*Status: Completed.*

This section validates the proposed roadmap areas against the actual code. Each
area separates **confirmed behaviour**, **assumptions**, **risks** and
**recommendations**. Task IDs are defined in §7.

### A. Reliability and testing

**Confirmed current state**

- The test framework is `node:test` plus `supertest` (`package.json`,
  `"test": "node --test"`).
- `test/api.test.js` is one happy-path scenario with subtests: dev login,
  custom exercises, routine creation/update, starting a workout from a routine,
  set updates, finishing, history, stats, measurements, routine deletion,
  set/exercise deletion, supersets, reorder, replace and logout.
- `test/catalog.test.js` covers a legacy catalog-schema migration, catalog
  mapping/serialisation, catalog sync/linking and catalog API access.
- Tests set `DB_PATH` to a temporary file under `os.tmpdir()` and remove it
  afterwards. They do not touch a development database.
- There is no CI test job. `.github/workflows/deploy.yml` checks out to
  `PROD_DIR`, runs `git reset --hard origin/main` and rebuilds the container.
- There is no coverage configuration, no test data builder, no fake Hevy
  server and no browser test.

**Gap analysis by critical flow**

| Flow | Existing coverage | Why it matters | Recommended coverage |
|---|---|---|---|
| Active set autosave | None | `persistSet` is a shared 500 ms debounce and is cancelled on cleanup; two quick edits can lose one (`public/js/views/active.js`). | Browser-level test or extracted pure persistence queue unit test; assert per-set serialisation and flush on navigate. |
| Auth lifecycle | Dev login + one 401 assertion | Session expiry, logout invalidation, Google payload rejection and cookie flags are untested. | Session expiry with an injected clock, logout, invalid Google token, cookie attributes. |
| Multi-user isolation | None | Queries look scoped, but no regression test proves it. | Two agents/users; attempt read/update/delete of the other user's routine, workout, set, exercise and measurement; expect 404/empty. |
| Hevy API import | None | Imports cross several modules and a transaction. | Fake `fetch` returning paginated fixtures (via `fetchImpl` already accepted by `HevyClient`). |
| Hevy duplicate/idempotency | None | Duplicate detection is name/time based; no unique DB index (`hevy-import.js`, `db.js`). | Import the same fixture twice; update a fixture; rename a fixture; assert one row and updated fields. |
| Hevy events/deletes | None | Deleted events are counted and ignored (`hevy-sync.js`). | Event fixture with created/updated/deleted; assert intended policy. |
| Webhook auth | None | Public endpoint with per-user bearer token. | Missing/wrong token → 401; correct token → 200 before sync; sync failure does not change the HTTP status. |
| Partial failures | None | Routine import failure is swallowed while status stays `ok`. | Force routine endpoint failure; assert status/error surface. |
| Migrations | Catalog legacy migration only | Ad-hoc `ensureColumn()` calls have no version record. | Fresh DB + fixture DB from each schema version; assert idempotent re-run. |
| Measurement merge | Partial happy path | Same-date upsert nulls omitted fields. | Partial update preserves previous values. |
| Deploy gate | None | A broken build can be deployed. | Add `npm ci && npm test` before rebuild (P1-01/P1-09). |

**Assumptions**

- The tests that exist pass. I could not run them because `node_modules` is
  absent and installing dependencies is outside the authorised scope. All
  JavaScript files passed `node --check`, which proves syntax only.
- The current happy-path suite would keep passing after the proposed changes;
  this is not verified.

**Risks**

- The most valuable invariants (ownership, idempotency, no data loss) are
  exactly the ones without tests.
- Adding a broad browser/E2E suite would create more maintenance than this
  project can absorb. The right target is a small, deterministic, fast suite
  around critical flows, not a coverage percentage.
- Testing Hevy sync without a fake HTTP layer would make the suite flaky and
  dependent on a third-party service.

**Recommendation**

1. Add a **test harness** first: a helper that creates an isolated app + DB,
   a fixture builder for users/routines/workouts, and a fake Hevy client
   injected through the existing `fetchImpl` option
   (`server/hevy-client.js` constructor already supports it).
2. Cover the flows in the table above, prioritising isolation, Hevy
   idempotency, active-set persistence and auth lifecycle.
3. Add a CI job that runs `npm ci` and `npm test` before the deploy step, and
   fail the deploy on test failure.
4. Keep tests at the API level with `supertest`. Add one small browser test
   only for the active-workout edit/flush path, because that behaviour depends
   on timers and navigation, not just HTTP.
5. Do not set a line-coverage target. Measure critical-flow coverage as a
   checklist in this document and in the test names.

### B. Workout tracking experience

**Confirmed functional strengths**

- Starting a workout from a routine or from scratch is a first-class flow
  (`server/routes/routines.js` `POST /:id/start`,
  `server/routes/workouts.js` `POST /`).
- Set rows support weight, reps, completion, add/delete, swipe-to-delete,
  supersets, reorder and exercise replacement (`public/js/views/active.js`,
  `server/routes/workouts.js`).
- The previous-set reference is shown in its own column and can fill the
  current row; inputs stay empty until the user enters or fills them.
- Rest seconds exist in the set schema and API (`workout_sets.rest_seconds`,
  `serializeSet`) but there is no rest timer in the active view.
- Workout history, per-routine charts and overview stats exist
  (`public/js/views/history.js`, `routine.js`, `profile.js`,
  `server/routes/stats.js`).
- The exercise picker supports catalog search, muscle groups and custom
  exercises (`public/js/exercise-picker.js`, `views/exercises.js`).
- Routine management supports folders, duplicate, edit, reorder and start.

**Confirmed friction points (functional, not stylistic)**

1. **Finished workouts cannot be corrected.** `PATCH /api/workouts/:id` exists
   (`server/routes/workouts.js`) but no view calls it. A wrong weight, a
   mistyped note or a forgotten set name is permanent after finishing. This is
   a correctness problem for a training log.
2. **Numeric entry is locale-hostile.** `Number(raw)` in
   `public/js/views/active.js` turns `72,5` into `NaN`, and the server clamp
   then stores `0`; the UI shows the value as `0`. Measurement inputs have the
   same problem via `Number(value)` in `public/js/views/measurements.js`. This
   affects Spanish users on mobile keyboards, which is the primary audience.
3. **Progression is hidden.** `GET /api/stats/exercise/:exerciseId` returns
   history, best weight, max reps and an estimated 1RM
   (`server/routes/stats.js`), and `api.stats.exercise` exists, but no view
   calls it. The user cannot see whether an exercise is progressing.
4. **PRs are underspecified.** `prCount` in `server/services/workouts.js`
   counts an exercise as a PR only when the workout's maximum weight exceeds the
   previous maximum; it does not count rep PRs, volume or estimated 1RM.
   `estimated1rm` combines `MAX(weight)` and `MAX(reps)` from possibly different
   sets (`server/routes/stats.js`), which overstates strength.
5. **No rest timer.** The schema/API store `restSeconds`, but the active view
   neither sets nor displays a timer. A user must leave the app or watch the
   device clock.
6. **Unsaved routine edits are discarded silently.**
   `public/js/views/routine-editor.js` has a cancel action without a
   confirmation or dirty-state guard.
7. **Duplicate UI code.** The workout card and week/date helpers are repeated
   across `home.js`, `training.js`, `history.js`, `profile.js`, and routine
   grouping/labels are duplicated. This is a maintenance issue, not a user
   issue today, but it makes changes to history cards expensive.

**Assumption**

- These are opportunities, not requirements. Whether a rest timer, editable
  history or progression charts matter more than offline logging is a product
  decision (§10).

**Recommendations (functional vs technical separated)**

*Functional opportunities (need product approval):*
- Make completed workouts editable (sets, notes, name, location).
- Add a rest timer tied to `restSeconds`, with an opt-in sound/haptic.
- Show per-exercise progression (best set, estimated 1RM, volume trend) from
  the existing stats endpoint.
- Define PRs explicitly (weight, reps at weight, estimated 1RM, volume) before
  changing the UI.

*Technical proposals (recommended regardless of product choices):*
- Fix decimal-comma parsing with a shared `parseNumberInput()` used by all
  numeric forms (P1-04).
- Add a workout edit route in the UI using the existing `PATCH /api/workouts/:id`
  and set endpoints (P1-03).
- Fix e1RM and PR calculations before surfacing them (P1-05), otherwise the
  new UI would display misleading numbers.
- Extract shared workout-card/date helpers (P1-12) only when touching those
  views; do not schedule a standalone refactor.

### C. PWA and offline functionality

**Confirmed current implementation**

- `public/manifest.webmanifest` declares standalone display, portrait
  orientation, Spanish locale, `start_url`/`scope` at `/`, 192/512 PNG icons,
  an SVG icon and a maskable icon.
- `public/index.html` includes viewport-fit, theme colour and Apple mobile web
  app meta tags.
- `public/sw.js`:
  - caches under `fitlog-v10` (manual version string);
  - precaches `/`, `/index.html`, four CSS files, `app.js`, the manifest and
    `icon.svg` using `Promise.allSettled` (a missing file does not abort
    install);
  - deletes old caches on activate;
  - serves navigations network-first with cached `/index.html` as fallback;
  - serves other same-origin GETs stale-while-revalidate;
  - bypasses `/api/` entirely.
- The service worker is registered on `load` in `public/js/app.js`.
- `localStorage` is used only for theme and collapsed routine folders. There is
  no IndexedDB, no outbox and no cached workout data.

**Scenario analysis**

| Scenario | Actual behaviour | Evidence |
|---|---|---|
| Open the app offline after a previous visit | The shell may load from cache. `app.js` then requests `/api/auth/me`, which is not cached; the request fails; the app treats the user as unauthenticated and routes to `/login`. | `public/sw.js` `/api/` bypass; `public/js/app.js` boot/handleRoute |
| Attempt to log a workout offline | Impossible. Starting a workout requires `POST /api/workouts`; sets require API calls; the active view has no local persistence. | `public/js/views/active.js`; `public/js/api.js` |
| Navigate to an already visited page offline | If the HTML shell is cached, the view module may still be missing: precache lists only `app.js`, not `views/*.js`, `api.js`, `charts.js`, `ui.js`, `exercise-picker.js`, `swipe.js`, `pull-refresh.js` or `theme.js`. A visited module may be in the runtime cache, but this is not guaranteed. | `public/sw.js` `PRECACHE` |
| Navigate to an unvisited page offline | The module fetch is not precached and not available; the route fails. | Same as above. |
| Reconnect and synchronise | Nothing to synchronise: no writes are queued. A failed save only shows a toast. | `public/js/views/active.js` `persistSet` catch |
| Deploy a new shell | Old caches are deleted only when `CACHE_VERSION` is manually bumped. A deploy that forgets to bump it can leave clients on stale modules while HTML is refreshed. | `public/sw.js` `CACHE_VERSION`; release history shows manual bumps (`git log`) |

**Is real offline workout logging worthwhile?**

It is a genuine product opportunity: gyms often have poor connectivity and the
active workout is exactly the data the user cannot afford to lose. It is also
the most complex item in this roadmap. The current service worker cannot
provide it; offline logging needs a local-first write path, identity for
locally created records, conflict rules and a retry queue.

**Recommendation**

- **Now:** fix the shell so the app is reliably installable and its JS modules
  are cached; make cache versioning deterministic; do **not** claim offline
  workout logging. This is P1-10 and is low risk.
- **Only if offline logging becomes a product priority:** implement it as a
  deliberate, bounded feature (P2-01):
  1. Persist the active workout and an **outbox** in IndexedDB (not
     `localStorage`, which is synchronous and size-limited).
  2. Give every client-created entity a client-generated UUID and send it as an
     idempotency key. Add a server-side `client_id` unique per user for
     workouts, exercises-in-workout and sets.
  3. Write locally first, then send. On success, mark the operation committed and
     replace the local id with the server id if they differ.
  4. Process the outbox in order on reconnect and on app start. Retry with
     exponential backoff; keep a visible "pending sync" indicator.
  5. Conflict policy: the active workout is owned by one device at a time.
     If the server already has a newer `updated_at`, keep the server version and
     surface a conflict rather than silently overwriting. Completed workouts are
     append-only from the client's perspective.
  6. Never cache `/api/` responses across users; scope local data by user id and
     clear it on logout.
  7. Do not depend on the Background Sync API (unavailable/inconsistent on
     iOS); sync when the app is foregrounded or connectivity returns.
- **Complexity:** L. It touches the data model, API, active view, service
  worker and tests. It should not be bundled with shell caching.

### D. Apple Health integration

**Confirmed technical constraint**

HealthKit is a native iOS framework. Safari and installed PWAs do not expose a
HealthKit JavaScript API, and there is no standard web API that grants access
to Apple Health records. A PWA cannot read or write HealthKit data directly.
This is a platform limitation, not a FitLog bug.

**Options compared**

| Option | What it enables | Effort | Maintenance | Assessment |
|---|---|---|---|---|
| 1. Keep FitLog as a PWA, add manual file import | User exports Apple Health data (or a third-party export) and uploads it; FitLog parses workouts/body mass. | S–M | Low | Viable for occasional imports. Does not provide automatic sync. Apple's export is a large XML file; parsing must be streamed and mapped carefully. |
| 2. Native iOS companion | HealthKit read/write, background delivery, automatic workout and body-weight sync; authenticates to the existing API. | L–XL | High (Swift/SwiftUI, signing, App Store, iOS releases) | The only way to get true automatic two-way HealthKit integration. It does not require rewriting the PWA; it is an additional client. |
| 3. Third-party bridge / automation | Health Auto Export, Shortcuts or a commercial health API posts data to a FitLog endpoint. | S–M backend | Depends on the bridge | Technically viable if the user already uses such a tool. Requires an authenticated ingestion endpoint, idempotency and mapping. Shortcuts Health actions are limited and not a reliable background sync. |
| 4. Native rewrite of FitLog | Full native app. | XL | Very high | Not justified. The PWA works and a companion covers the missing HealthKit capability. |

**Assumption**

- The user's actual goal is unknown: importing Apple Health workouts into
  FitLog, exporting FitLog workouts to Apple Health, or syncing body
  measurements. Each has a different cost and permission model. This must be
  clarified before any design.

**Recommendation**

- Do **not** rewrite FitLog as a native app.
- If the need is occasional history import, add an authenticated **Apple Health
  export import** (file upload, streamed XML parsing, idempotent external ids)
  as a P2 feature.
- If the need is automatic two-way sync, build a **small native iOS
  companion** that talks to the existing API, not a replacement app. Treat it as
  a separate product with its own release cycle.
- If the user already uses a bridge app, an authenticated ingestion endpoint is
  the cheapest path and can be evaluated first.
- Before implementation, decide the direction of sync and the data types
  (workouts, body mass, active energy, heart rate). Do not build a generic
  health platform.

### E. Security and deployment

**Confirmed controls that are in place**

- Google ID tokens are verified server-side with `google-auth-library` and the
  configured audience (`server/auth.js` `verifyGoogleCredential`).
- Sessions are random 256-bit tokens, stored as SHA-256 hashes; the cookie is
  `httpOnly`, `SameSite=Lax`, `Path=/`, and optionally `Secure`
  (`server/auth.js`).
- Helmet is enabled with an explicit CSP, `object-src 'none'`, `base-uri
  'self'`, COOP and CORP (`server/app.js`).
- SQL is parameterised throughout; user HTML is generally escaped.
- The Hevy API key is encrypted with AES-256-GCM using a key derived from
  `SESSION_SECRET` (`server/crypto-box.js`). The webhook token comparison is
  timing-safe (`server/hevy-sync.js`).
- Production refuses the development session secret and disables dev login
  (`server/config.js`).
- The container runs as the non-root `node` user and installs production
  dependencies only (`Dockerfile`).
- There is no CORS opening and no password database.

**Confirmed gaps and concrete risks**

| Area | Finding | Risk | Priority |
|---|---|---|---|
| Registration | Any verified Google account creates a user; no allowlist (`server/auth.js` `upsertGoogleUser`). | A public tunnel exposes a personal training log to anyone who finds the URL. | P0 |
| Auth abuse | No rate limiting on `/api/auth/google`, `/api/auth/dev`, imports or sync. | Credential stuffing is not the main issue (Google tokens), but dev login and import endpoints can be abused; the 5 MB JSON body and synchronous parsing can block the event loop. | P1 |
| CSRF | No explicit Origin/Sec-Fetch-Site check. `SameSite=Lax` protects authenticated JSON routes; `POST /api/auth/dev` is bodyless and can be triggered cross-site in non-production. | Low in production because dev login is off; a real issue for a publicly reachable development instance. | P1 (with dev-login hardening) |
| Cookies | `Secure` depends on `COOKIE_SECURE=true`; production does not enforce it. No `__Host-` prefix. | A misconfigured production deploy sends the session cookie over HTTP if the tunnel/proxy is misconfigured. | P1 |
| Session lifecycle | Expired sessions are deleted opportunistically; no rotation, no revoke-all, no absolute vs idle distinction. | A stolen token remains valid until expiry (default 30 days) even after logout on another device. A 30-day fixed lifetime is a reasonable trade-off for a personal app; document it. | P2 |
| Secrets | `SESSION_SECRET` is both the session signing material (conceptually) and the Hevy encryption key derivation source. Rotating it invalidates stored Hevy keys. | Operational surprise after rotation; no key-versioning. | P2 |
| Headers | CSP allows `'unsafe-inline'` for styles and external Google/Hevy image hosts. There are no HSTS settings in the app (Cloudflare may add them). | Broad image hosts are a small privacy/supply-chain surface; inline styles weaken CSP but not script execution. | P2 |
| Webhook | Public endpoint with per-user bearer token and immediate 200. No replay timestamp/signature verification beyond the token. | Token leakage allows triggering syncs (not reading data). Hevy's exact signing scheme is not documented in the code. | P1/P2 |
| Health check | `/api/health` returns `{ok,time}` without a DB query. | Deploy gate can pass with an unwritable/corrupt DB. | P1 |
| Deploy | `git reset --hard origin/main`, rebuild in place, overwrite the image tag, no rollback or pre-deploy backup. | A bad deploy can lose uncommitted production state and cannot be rolled back quickly. | P1 |
| Backups | Manual only; WAL mode means copying the `.db` file alone while running is unsafe. | Data loss on disk failure, bad migration or accidental delete. | P0 |
| Logging | `console.*` only, no request ids, no structured logs, no alerting. | Failures are invisible until the user notices. | P2 |
| Dev login | `POST /api/auth/dev` has no body and no CSRF token; enabled by default outside production. | Anyone who reaches a non-production instance becomes the dev user. | P1 |

**Recommendation**

- P0: restrict registration with an explicit allowlist (`ALLOWED_EMAILS`, or a
  single-owner mode) and document the public exposure model.
- P1: add rate limiting (auth, import, sync), enforce `Secure` cookies in
  production (refuse to boot or force it), add an Origin check for
  state-changing requests, and add a DB-aware health check.
- P1: make dev login require an explicit flag and bind it to loopback or a
  development-only check; never enable it on a tunnel.
- P2: version the encryption key separately from the session secret, add
  structured logging and consider HSTS at the tunnel.
- Do not add a WAF, external identity provider or service mesh for this app.
  The concrete gaps are configuration and allowlisting, not missing
  infrastructure.

---

## 6. Architectural and technology recommendations

*Status: Completed.*

The guiding principle is to keep the current architecture and change only what
is demonstrably insufficient. For each candidate change below: what problem it
solves, why the current implementation is insufficient, the complexity it adds,
and whether it is justified now.

### 6.1 Node.js + Express — keep

**Problem it could solve:** routing, middleware, HTTP ergonomics.

**Current state:** Express 4.21 is used conventionally and correctly. The app
factory (`createApp()`), `asyncHandler`, `HttpError` and route modules are easy
to test with `supertest`. There are no callbacks, no blocking I/O in handlers
except synchronous SQLite (which is the chosen design), and no websocket or
streaming requirement.

**Why a change is not needed:** Fastify/Koa/Nest would add migration work
without solving a concrete problem. Nest's structure would be heavier than the
domain. The only Express-specific risk is version 4 being in maintenance; a
future Express 5 upgrade is a small, separate task, not a reason to change
frameworks.

**Complexity:** none if unchanged.

**Verdict:** keep Express. Do not migrate. Revisit only if Express 4 stops
receiving security fixes and the upgrade path is no longer viable.

### 6.2 SQLite + better-sqlite3 — keep

**Problem it could solve:** persistence, concurrency, querying.

**Current state:** one writer process, WAL mode, foreign keys on, a 5-second
busy timeout, prepared statements and transactions. The data volume for one
user (thousands of sets) is trivial for SQLite. Backups are file-level, which
is a strength for a personal app.

**Why a change is not needed:** PostgreSQL would add a service, connection
pooling, migrations and operational work with no benefit at this scale. The
real database risks are schema integrity and migrations, not the engine.

**Caveats and required improvements (not a migration):**
- WAL means a backup must use `sqlite3 .backup`, `VACUUM INTO`, or a
  checkpointed copy, not a raw file copy while the server runs.
- `better-sqlite3` is synchronous and compiled. The Docker image correctly uses
  Debian slim with build tools in the deps stage. Node 20 is pinned in the
  image while `package.json` allows `>=18`; keep the runtime consistent.
- Ad-hoc `ensureColumn()` migrations should become a versioned runner
  (P1-07). This is an internal change, not a database replacement.

**Complexity:** none for the engine; S for the migration runner.

**Verdict:** keep SQLite/better-sqlite3. Do not migrate.

### 6.3 Vanilla JavaScript frontend — keep

**Problem it could solve:** state management, rendering, component reuse.

**Current state:** the app has roughly 9,200 lines of JavaScript/CSS, a hash
router, one view module per screen, string templates, and shared helpers. This
is well within the range where a framework is optional. The UI already handles
mobile gestures, charts and modals without a build step.

**Why a change is not needed:** React/Vue/Svelte would introduce a build
pipeline, dependency updates, a component model migration and a large rewrite,
while the confirmed problems (data loss, missing edit, numeric parsing,
duplicate markup) are solvable in place. A framework would not fix the
shared-debounce bug or the Hevy identity model.

**Where the current approach is insufficient:**
- No reactive state means the active workout has to coordinate DOM, local
  objects and server writes manually — the source of R-01/R-02.
- No component layer means the workout card and helpers are duplicated
  (R-29).
- No type checking makes API payload drift easy (for example `prefill` and
  `targetReps` are still accepted but ignored, R-26).

**Justified incremental improvements:**
- Extract a small **active-workout persistence module** (plain JS) that owns
  per-set dirty state, timers, retries and flush-on-exit. No framework.
- Extract shared view helpers for workout cards, date/week labels and numeric
  parsing.
- Add JSDoc typedefs for the API payloads and use `// @ts-check` selectively on
  the modules with the most churn (`active.js`, `api.js`,
  `services/workouts.js`). This gives editor-level type checking without a
  build step or a TypeScript migration.
- Keep `render(container, ctx, params)` as the view contract.

**Complexity:** XS–S per extraction; no framework migration.

**Verdict:** keep vanilla JS. Do not migrate to a framework. Add targeted
structure and optional JSDoc checking where it prevents real bugs.

### 6.4 PWA architecture — keep, complete the shell

**Problem it could solve:** installability and offline access.

**Current state:** installable shell with a manual cache version, incomplete
precache and no offline data path.

**Why the current implementation is insufficient:** view modules are not
precached, the cache version is manually bumped, and `/api/` is intentionally
uncached, so the app routes to login offline. This is a shell-completeness
problem, not a reason to replace the PWA approach.

**Justified changes:**
- Precache all first-party shell modules or generate the list from the files
  present at build time (P1-10).
- Derive the cache name from a build/release identifier instead of a manual
  string, or at minimum assert in CI that the version changed when shell files
  changed.
- Keep `/api/` out of the cache. If offline logging is approved, add a local
  data layer (P2-01), not API response caching.

**Not justified now:** Workbox, a bundler, or a full local-first rewrite of all
views. Those add complexity before the product decision.

**Verdict:** keep the PWA. Complete the shell now; treat offline writes as a
separate, gated project.

### 6.5 Project modularity — improve incrementally

**Problem it could solve:** maintainability and testability.

**Current state:** `services/workouts.js` and `services/exercises.js` exist, but
routine, measurement, stats and import logic lives in route files. Hevy import
orchestration is repeated across `routes/import.js`, `hevy-sync.js`,
`import-hevy-csv.js` and `import-hevy-api.js`. The frontend duplicates helpers.

**Why the current structure is insufficient:** route files mix HTTP validation,
SQL and domain decisions. This makes unit testing harder and increases the
chance that a behaviour (for example measurement merging) is implemented twice
with different semantics. It is not broken today, but it raises the cost of the
P0 fixes.

**Justified change:** extract a service only when a route is being changed for a
functional reason. Specifically:
- `services/measurements.js` for the partial-update merge (P0-05).
- `services/hevy.js` (or keep `hevy-sync.js`) for a single `ingestWorkouts()`
  used by CSV, API import, sync and the CLI (P0-03/P1-02).
- `public/js/format.js` or additions to `ui.js` for numeric parsing and shared
  formatters (P1-04).
- `public/js/components/workout-card.js` only if the history/home/training
  views are touched anyway (P1-12).

**Not justified:** a domain-driven folder restructure, dependency injection
container, repository layer or event bus. The app does not need them.

**Verdict:** targeted extraction only, driven by a task that already touches the
code.

### 6.6 Testing architecture — add a harness, not a platform

**Problem it could solve:** confidence in critical flows.

**Current state:** `node:test` + `supertest`, isolated temp DBs, no shared
helpers and no fakes.

**Recommendation:** keep `node:test`. Add:
- `test/helpers/app.js`: set env before importing, create a temp DB, build the
  app, return agents.
- `test/helpers/fixtures.js`: users, routines, workouts, measurements.
- `test/helpers/hevy.js`: fixture pages and a fake `fetchImpl`.
- One browser smoke test for the active set flow, using a lightweight runner
  (Playwright) only if it can run in CI without flakiness.

**Not justified:** Jest/Vitest migration, a mocking framework, a test
containers setup or a full E2E suite. They add dependencies and maintenance
without covering more critical behaviour.

### 6.7 Background jobs — no queue, but add safety

**Problem it could solve:** reliable sync and webhook work.

**Current state:** in-process promises and `setInterval`; no persistence,
timeout or lock.

**Why a queue is not justified:** one server, one user, a 6-hour scheduler and a
webhook that can tolerate a delayed sync. Redis/BullMQ would add infrastructure
for a workload that fits in memory.

**Justified change:** a per-user in-process lock, an `AbortSignal` timeout in
`HevyClient`, retry/backoff for transient errors, and durable status in
`hevy_sync.last_error`/`last_status`. If a sync is missed during a restart, the
next scheduled run catches up. Do not add a queue until there is evidence that
in-process work is insufficient.

### 6.8 Summary of architectural verdicts

| Choice | Verdict | Reason |
|---|---|---|
| Node.js + Express | Keep | Adequate, testable, no concrete blocker. |
| SQLite + better-sqlite3 | Keep | Right scale, simple operations; fix migrations/integrity. |
| Vanilla JS frontend | Keep | Small app; framework would not fix confirmed bugs. |
| PWA | Keep | Installable; complete shell caching; offline writes only if approved. |
| Hash router + view modules | Keep | Simple and works; no need for a router library. |
| In-process background sync | Keep with safety | Add lock/timeout/status; no queue at this scale. |
| TypeScript migration | Not now | Optional JSDoc checking gives most of the benefit without a build step. |
| Framework migration | No | No concrete benefit; high risk. |
| Database migration | No | Adds operations with no scale need. |
| Offline data layer | Conditional | Only if offline logging is a product priority. |
| Native iOS companion | Conditional | Only if automatic HealthKit sync is required. |

---

## 7. Prioritized implementation backlog

*Status: Completed.*

Priorities follow the requested definition: **P0** = security, data integrity,
correctness or reliability; **P1** = high-value UX, maintainability, testability
or operational reliability; **P2** = optional or future. The execution order
below follows dependencies and risk, not priority labels alone. In particular,
P1-01 (test harness and CI gate) is sequenced second because every later change
needs a way to prove it did not break authentication, isolation or sync.

### 7.1 Backlog summary

| Order | ID | Title | Priority | Complexity | Depends on | Status |
|---:|---|---|---|---|---|---|
| 1 | P0-01 | Fix active-workout set persistence | P0 | M | — | ✅ Done |
| 2 | P1-01 | Add critical-flow test harness and CI gate | P1 | M | — | ✅ Done |
| 3 | P0-02 | Automated backups with restore validation | P0 | M | P1-01 | ✅ Done |
| 4 | P0-03 | Stable Hevy workout identity and idempotent upsert | P0 | L | P1-01 | ✅ Done |
| 5 | P0-04 | Restrict account creation and harden dev login | P0 | S | — | ✅ Done |
| 6 | P0-05 | Make measurement upserts non-destructive | P0 | S | P1-01 | ✅ Done |
| 7 | P1-02 | Harden Hevy sync execution and error surfacing | P1 | M | P0-03 | ✅ Done |
| 8 | P1-03 | Allow editing completed workouts | P1 | M | P0-01 | ✅ Done |
| 9 | P1-04 | Locale-safe numeric input | P1 | S | — | ✅ Done |
| 10 | P1-05 | Surface exercise progression and correct e1RM/PRs | P1 | M | P1-03 | ✅ Done |
| 11 | P1-06 | Security hardening pass | P1 | M | P0-04 | ✅ Done |
| 12 | P1-07 | Versioned transactional migrations and integrity constraints | P1 | M | P0-03 | ✅ Done |
| 13 | P1-08 | Operational readiness: health, shutdown, logs | P1 | S | P1-07 | ✅ Done |
| 14 | P1-09 | Deploy safety: versioned images and rollback | P1 | M | P0-02, P1-01 | ✅ Done |
| 15 | P1-10 | Complete and version the PWA shell cache | P1 | S | — | ✅ Done |
| 16 | P1-11 | Invalidate catalog caches after sync | P1 | XS | — | ✅ Done |
| 17 | P1-12 | Shared frontend helpers and unsaved-change guard | P1 | S | P1-03 | ✅ Done |
| 18 | P2-01 | Offline workout logging (conditional) | P2 | XL | Product decision, P1-10, P0-03 | ✅ Done |
| 19 | P2-02 | Apple Health integration spike / companion (conditional) | P2 | L–XL | Product decision | ❌ Won't do (PWA, not a native iOS app) |
| 20 | P2-03 | Rest timer and set-level UX | P2 | M | P1-03 | ✅ Done |
| 21 | P2-04 | Richer PR and statistics definitions | P2 | M | P1-05 | ✅ Done |
| 22 | P2-05 | Remove dead schema and unused API surface | P2 | S | P1-07 | ✅ Done |

> **Progress (updated 2026-11-07).** All P0 and P1 tasks are complete except
> P1-09, which is partial (test gate, pre-deploy backup and migration, and a
> health-gated deploy are in place; SHA-tagged images and automatic rollback
> are not). Of the P2 items, P2-01 (offline logging), P2-03 (rest timer),
> P2-04 (richer PRs) and P2-05 (dead-schema cleanup) are done. P2-02 (Apple
> Health) is a deliberate won't-do: FitLog stays a PWA and HealthKit would
> require a separate native iOS companion. Every task in the backlog is now
> either done or an explicit won't-do (P2-02).

P0-04 is the only task that may reasonably jump the queue: if the instance is
publicly reachable today, apply the allowlist as an immediate hotfix. It is
small and independent of the rest of the sequence. The numbered order above
reflects the main implementation path, not a prohibition on pulling a critical
security fix forward.

### 7.2 P0 — Critical tasks

#### P0-01 — Fix active-workout set persistence

| Field | Value |
|---|---|
| **ID** | P0-01 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Fix active-workout set persistence |
| **Priority** | P0 |
| **Problem** | A single shared 500 ms debounce is used for every set. Two different sets edited within the window persist only the last one, and navigating away cancels the pending write. A failed save is only toasted; the value is lost on reload. |
| **Evidence** | `public/js/views/active.js`: `const persistSet = debounce(async (weId, setId) => {...}, 500)` and cleanup `persistSet.cancel?.()`. Input handler calls `persistSet(weId, setId)`. `public/js/ui.js` `debounce()`. Completion toggle bypasses the debounce and writes immediately. |
| **Benefit** | Removes the highest-impact data-loss path in the core workout flow. Directly protects the data the app exists to record. |
| **Proposed approach** | Replace the single debounce with a small persistence scheduler that: (1) debounces **per setId**; (2) keeps a pending/dirty map and serialises writes per set; (3) flushes all pending sets on input `change`/`blur`, on completion toggle, on route cleanup and on `pagehide`/`visibilitychange`; (4) retries transient failures with capped backoff and keeps the value dirty until the server confirms; (5) surfaces a persistent "not saved" indicator instead of a transient toast; (6) sends absolute values (current `PATCH` semantics) so retries are idempotent. Extract the scheduler into a testable module, e.g. `public/js/pending-writes.js`. Do not add IndexedDB here; that belongs to P2-01. |
| **Relevant files** | `public/js/views/active.js`, `public/js/ui.js`, new `public/js/pending-writes.js`, `test/` (unit + browser smoke) |
| **Dependencies** | None. P1-01 should start in parallel to provide the test harness. |
| **Complexity** | M |
| **Risks** | Duplicate or out-of-order writes if requests overlap; flushing during navigation could race with the next view. Mitigate per-set serialisation and last-write-wins on absolute values. Do not block navigation indefinitely; flush with `keepalive` or accept a retry on the next visit. |
| **Tests** | Edit two sets within 500 ms → both values persisted. Edit and navigate immediately → value persisted. Simulate a 500 once → retry succeeds and value is persisted. Complete a set while an input debounce is pending → single consistent value. Reload after each case → value matches. |
| **Acceptance criteria** | No code path cancels an unsaved set without flushing or retaining it for retry. Every set has independent debounce state. A failed save is visible until resolved. Automated tests cover the four scenarios above. |

#### P1-01 — Add critical-flow test harness and CI gate

| Field | Value |
|---|---|
| **ID** | P1-01 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Add critical-flow test harness and CI gate |
| **Priority** | P1 |
| **Problem** | Critical invariants (isolation, session expiry, Hevy idempotency, autosave) have no tests, and the deploy workflow does not run the existing suite. |
| **Evidence** | `test/api.test.js`, `test/catalog.test.js`; `.github/workflows/deploy.yml` runs `git reset --hard` and `docker compose up -d --build app` without `npm test`. No test helpers or fakes. |
| **Benefit** | Makes every later P0/P1 change safe to merge and prevents regressions in the flows that matter most. Converts the existing happy-path tests into a reusable foundation. |
| **Proposed approach** | Keep `node:test` + `supertest`. Add `test/helpers/app.js` (env setup, temp DB, app factory, agents), `test/helpers/fixtures.js` (users, routines, workouts, measurements) and `test/helpers/hevy.js` (fixture pages, fake `fetchImpl`). Add suites for: two-user isolation, session expiry/logout, Hevy full and incremental sync including update/rename/delete, webhook auth, measurement merge, and the active-set scheduler. Add a CI job/step that runs `npm ci && npm test` and blocks the deploy on failure. Keep tests offline and independent of the production DB. |
| **Relevant files** | `test/helpers/*` (new), `test/*.test.js`, `.github/workflows/deploy.yml`, `package.json` |
| **Dependencies** | None. It is sequenced early because it protects all other tasks. |
| **Complexity** | M |
| **Risks** | Temp DBs and module-level state can leak between tests (the app imports `db.js` with a fixed `DB_PATH`); tests must run in isolated processes or reset the DB. Adding Playwright for one test may increase CI setup; keep it optional and separate from the API suite. |
| **Tests** | The new suite itself; verify the CI job fails when a deliberately broken assertion is present (remove before merge). |
| **Acceptance criteria** | `npm test` runs the critical suite locally with no network. CI runs tests before deploy and blocks on failure. Each critical flow in §9 has at least one test. Test data never touches a real database. |

#### P0-02 — Automated backups with restore validation

| Field | Value |
|---|---|
| **ID** | P0-02 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Automated backups with restore validation |
| **Priority** | P0 |
| **Problem** | There is no scheduled backup, retention policy, off-host copy or restore test. SQLite runs in WAL mode, so a naive copy of `fitness.db` while the server runs can be inconsistent. |
| **Evidence** | `docker-compose.yml` bind-mounts `./data:/app/data`; `README.md` only documents a manual copy/`.backup`; no backup script, cron, systemd timer or workflow exists. |
| **Benefit** | Protects against disk failure, accidental deletion, a bad migration and a bad deploy. Makes recovery a tested procedure rather than an assumption. |
| **Proposed approach** | Add `scripts/backup-db.js` using `better-sqlite3`'s safe backup API (or `VACUUM INTO`) to write a timestamped file outside the container/host bind mount. Run it daily from a host timer and before every deploy. Keep a retention policy (e.g. 7 daily + 4 weekly) and copy at least one generation off-host (rsync/rclone or an encrypted object-store bucket). Add `scripts/verify-backup.js` that opens the copy, runs `PRAGMA integrity_check`, checks key row counts, and restores to a temporary path. Document RPO/RTO and the restore steps. Do not run `cp` on a live database. |
| **Relevant files** | `scripts/backup-db.js` (new), `scripts/verify-backup.js` (new), `docker-compose.yml` (host-side cron/volume notes), `.github/workflows/deploy.yml`, `README.md`, `test/` (backup/restore test) |
| **Dependencies** | P1-01 (automated validation); P1-09 consumes the pre-deploy hook. |
| **Complexity** | M |
| **Risks** | Backups contain personal data: restrict permissions and encrypt off-host copies. Disk exhaustion from retention. A backup that is never restored is not a backup; the verification must be scheduled, not just documented. |
| **Tests** | Create a DB with known rows, back it up while a write is in progress, restore it, assert integrity and row counts. Assert retention deletes only old files. Test a corrupt backup is rejected. |
| **Acceptance criteria** | A daily backup exists with a documented schedule and retention. A pre-deploy backup runs automatically. A restore has been performed successfully from a backup and the result is documented. Backup failure is visible (log/alert). |

#### P0-03 — Stable Hevy workout identity and idempotent upsert

| Field | Value |
|---|---|
| **ID** | P0-03 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Stable Hevy workout identity and idempotent upsert |
| **Priority** | P0 |
| **Problem** | Imported workouts have no Hevy workout id. Duplicate detection uses `(user_id, name, started_at)`: a renamed workout creates a duplicate, while an updated workout with the same name/time is skipped and never receives changed sets/notes. Deleted events are ignored. There is no unique constraint behind the check. |
| **Evidence** | `server/db.js` `workouts` table (no external id, no unique index); `server/hevy-import.js` `workoutExists()` and `importWorkout()`; `server/hevy-sync.js` event loop (`event.type === 'deleted'` only increments a counter) and `hevyApiWorkoutToNormalized()` (drops the Hevy workout id). |
| **Benefit** | Makes sync genuinely incremental and idempotent. Prevents duplicate workouts and stale data, which are visible correctness failures in the main integration. |
| **Proposed approach** | (1) Add `hevy_workout_id TEXT` (or generic `external_source`/`external_id`) to `workouts`; carry `w.id` through `hevyApiWorkoutToNormalized()`. (2) Add a partial unique index on `(user_id, hevy_workout_id)` where the id is not null. (3) Change `importWorkout()` to upsert by external id: update name/notes/times and replace child exercises/sets in one transaction. Keep the name/time fallback only for legacy rows and for CSV imports that have no id. (4) Handle `deleted` events by deleting or tombstoning the matching imported workout. (5) Preserve user-created workouts; only touch `source='hevy'`. (6) Define the policy for allowed edits to imported workouts (see §10): Hevy should remain the source of truth, or edits must create a local copy. |
| **Relevant files** | `server/db.js`, `server/hevy-client.js`, `server/hevy-import.js`, `server/hevy-sync.js`, `server/routes/import.js`, `server/import-hevy-csv.js`, `test/` |
| **Dependencies** | P1-01 (fixtures and tests). The column can be added with the existing `ensureColumn()` mechanism; P1-07 then baselines the resulting schema. |
| **Complexity** | L |
| **Risks** | Backfilling existing imported workouts without an id is impossible; they must be matched once by name/time and then assigned the id, or left as legacy. Deleting children on update can lose local notes/edits; decide policy first. A unique index can fail if duplicates already exist; deduplicate in a migration. |
| **Tests** | Import fixture twice → one workout. Modify sets/notes in the fixture then sync → row updated, not skipped. Rename fixture → still one row. Deleted event → row removed or marked according to the agreed policy. Two users with the same Hevy id remain isolated. Legacy name/time duplicate still resolves. |
| **Acceptance criteria** | A Hevy workout id is stored and unique per user. Re-sync and update are idempotent. Renames do not duplicate. Deletes follow the documented policy. CSV import still works. All tests pass, including the existing suite. |

#### P0-04 — Restrict account creation and harden dev login

| Field | Value |
|---|---|
| **ID** | P0-04 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Restrict account creation and harden dev login |
| **Priority** | P0 |
| **Problem** | Any verified Google account creates a FitLog user. The app is exposed through a Cloudflare Tunnel, so the personal training log is effectively open to anyone who obtains the URL. Dev login is enabled by default outside production and is a bodyless POST. |
| **Evidence** | `server/auth.js` `upsertGoogleUser()` inserts for any `payload.sub`; `server/routes/auth.js` `POST /google` and `POST /dev`; `server/config.js` `allowDevLogin` defaults to true unless production. No allowlist or rate limit. |
| **Benefit** | Closes the most direct security exposure: unauthorised account creation and access to another person's data. Also reduces the risk of exposing a development instance. |
| **Proposed approach** | Add `ALLOWED_EMAILS` (comma-separated, case-insensitive) and optionally `ALLOWED_GOOGLE_SUBS`. Check `payload.email_verified` and the allowlist before creating or logging in a user; return 403 without creating a row. Add an explicit `ALLOW_ANY_GOOGLE_USER=true` escape hatch for intentional public deployments. In production, refuse to boot with Google enabled and neither allowlist nor escape hatch. Change `ALLOW_DEV_LOGIN` to explicit opt-in (`=== 'true'`), keep it impossible in production, and require an Origin check or loopback binding for non-production. |
| **Relevant files** | `server/auth.js`, `server/routes/auth.js`, `server/config.js`, `.env.example`, `README.md`, `test/` |
| **Dependencies** | None. P1-06 builds on it. |
| **Complexity** | S |
| **Risks** | Misconfiguration can lock the owner out; document the bootstrap procedure and keep a CLI or env escape hatch. Multiple legitimate accounts need the allowlist. Do not log tokens or full email lists. |
| **Tests** | Non-allowlisted verified user → 403 and no user row. Allowlisted user → session. `email_verified=false` → rejected. Production config with no allowlist → boot error. Dev login disabled unless explicitly enabled; production always disabled. |
| **Acceptance criteria** | Only allowlisted Google accounts can create/log in. Existing owner access is preserved. Production boots only with an explicit access policy. Dev login cannot be enabled in production. |

#### P0-05 — Make measurement upserts non-destructive

| Field | Value |
|---|---|
| **ID** | P0-05 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Make measurement upserts non-destructive |
| **Priority** | P0 |
| **Problem** | A same-date save overwrites weight, body fat, waist and notes with the incoming values, including `null` for fields the user did not fill. Recording body fat on a date that already has weight erases the weight. |
| **Evidence** | `server/routes/measurements.js` `ON CONFLICT(user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg, body_fat = excluded.body_fat, waist_cm = excluded.waist_cm, notes = excluded.notes`. `public/js/views/measurements.js` sends `null` for empty inputs. |
| **Benefit** | Prevents silent loss of body measurements, which are long-lived historical data. |
| **Proposed approach** | Define explicit merge semantics: an omitted field preserves the stored value; an explicit `null` clears it. In the route, detect presence with `Object.hasOwn(req.body, 'weightKg')`, read the existing row, merge, then upsert (or build a dynamic `SET` clause). Update the measurement form to omit empty fields unless the user explicitly clears a value. Keep the "at least one measurement" validation on the merged result. Extract the logic to `services/measurements.js` for testability. |
| **Relevant files** | `server/routes/measurements.js`, new `server/services/measurements.js`, `public/js/views/measurements.js`, `test/` |
| **Dependencies** | P1-01 (measurement test suite). |
| **Complexity** | S |
| **Risks** | Changing API semantics can surprise the current client; update both sides together. Clearing a field must still be possible. |
| **Tests** | Save weight, then save body fat only → weight retained. Save explicit `null` weight → weight cleared. Save all fields → all updated. New date → inserted. Invalid empty merged record → 400. |
| **Acceptance criteria** | Partial saves never erase omitted fields. Explicit clears work. The form and API use the same semantics. Tests cover all cases. |

### 7.3 P1 — High-value tasks

#### P1-02 — Harden Hevy sync execution and error surfacing

| Field | Value |
|---|---|
| **ID** | P1-02 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Harden Hevy sync execution and error surfacing |
| **Priority** | P1 |
| **Problem** | Hevy HTTP calls have no timeout, retry or backoff. The scheduler and webhook can run overlapping syncs for the same user. Routine import failures are logged only to the console while the sync reports `ok`, so the UI says everything is up to date. |
| **Evidence** | `server/hevy-client.js` `request()`/`send()` call `fetch` without `AbortSignal`; `server/hevy-sync.js` `syncUser()`, `syncAllAutoUsers()`, `startSyncScheduler()`; `server/routes/hevy-webhook.js` unawaited `syncUser()`; routine `catch` logs only. |
| **Benefit** | Prevents a hung request from blocking the scheduler, avoids concurrent duplicate work, and gives the user an honest sync status. |
| **Proposed approach** | Add `AbortSignal.timeout(...)` (Node 20+) with a configurable timeout. Retry 429/5xx/network errors with exponential backoff and jitter; do not retry 4xx auth errors. Add a per-user in-process lock (a `Set` or `Map`) shared by manual sync, scheduler and webhook; if a sync is already running, coalesce the request. Add a `last_warning` or structured status field so routine failures are visible without marking the workout import as failed. Surface `last_error`/`last_status` in `profile.js`. Keep the 200 webhook acknowledgement. |
| **Relevant files** | `server/hevy-client.js`, `server/hevy-sync.js`, `server/routes/hevy-webhook.js`, `server/routes/import.js`, `server/db.js`, `public/js/views/profile.js`, `test/` |
| **Dependencies** | P0-03 (upsert semantics), P1-01 (fake fetch tests). |
| **Complexity** | M |
| **Risks** | Retrying non-idempotent requests can duplicate writes; only retry reads. A lock held after an exception must be released in `finally`. Timeouts too short can abort legitimate large imports. |
| **Tests** | Timeout aborts and reports an error. 429 then success → retried. 401 → not retried. Concurrent sync requests → one execution. Routine failure → `last_warning` set and UI displays it. Webhook always returns 200 before sync. |
| **Acceptance criteria** | No Hevy request can hang indefinitely. A user has at most one sync in flight. Routine failures are visible. Sync status in the UI matches the database. |

#### P1-03 — Allow editing completed workouts

| Field | Value |
|---|---|
| **ID** | P1-03 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Allow editing completed workouts |
| **Priority** | P1 |
| **Problem** | After finishing a workout, the UI offers no way to correct sets, notes, name or location, even though the API supports metadata updates and set edits. A mistyped weight is permanent. |
| **Evidence** | `public/js/views/workout.js` renders a read-only detail; no call to `api.workouts.update`. `server/routes/workouts.js` has `PATCH /:id`, `PATCH /:id/exercises/:workoutExerciseId`, `PATCH /:id/sets/:setId`, `DELETE /:id/sets/:setId`. `public/js/api.js` exposes `workouts.update`. |
| **Benefit** | Fixes the most common correctness problem in a training log: bad data entered during a workout. Directly improves trust in history and stats. |
| **Proposed approach** | Add an "Editar" mode to the workout detail view. Reuse the set-row component/behaviour from `active.js` where possible. Allow name/location/notes, set weight/reps/completed, add/delete sets and exercises. Guard against concurrent edits with `updated_at` if added, or at minimum reload before editing. Decide whether imported Hevy workouts are editable (see §10). Keep the active-workout flow unchanged. |
| **Relevant files** | `public/js/views/workout.js`, `public/js/views/active.js` (shared set row), `public/js/api.js`, `server/services/workouts.js`, `test/` |
| **Dependencies** | P0-01 (shared persistence), P1-01. |
| **Complexity** | M |
| **Risks** | Duplicating the active-workout editing logic; accidentally allowing edits to imported workouts that the next sync overwrites. Decide policy and show a warning. |
| **Tests** | Edit name/notes/sets of a finished workout; reload; values persist. Edit a set in a second workout; isolation holds. Imported workout policy test. |
| **Acceptance criteria** | A finished workout can be corrected from the UI. Changes persist and appear in history/stats. The imported-workout policy is explicit and enforced. |

#### P1-04 — Locale-safe numeric input

| Field | Value |
|---|---|
| **ID** | P1-04 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Locale-safe numeric input |
| **Priority** | P1 |
| **Problem** | Spanish users type `72,5`; `Number('72,5')` is `NaN`. The active view clamps the value to `0`, and measurement inputs become `null`. Data is silently wrong. |
| **Evidence** | `public/js/views/active.js` input handler (`Number(raw)`); `public/js/views/measurements.js` (`Number(value)`); `server/http.js` `toNumber`; `server/services/workouts.js` clamping. |
| **Benefit** | Removes a common, invisible data-corruption path for the primary audience. |
| **Proposed approach** | Add a shared `parseDecimalInput(raw)` that trims, removes thousands separators, treats a single comma or dot as the decimal separator, rejects multiple separators and returns `null` for empty. Use it in all numeric forms and set `inputmode="decimal"`. Normalise before sending. Optionally make `toNumber` accept a comma as defence in depth, but do not rely on the server to guess locale. |
| **Relevant files** | New `public/js/format.js` or `public/js/ui.js`, `public/js/views/active.js`, `public/js/views/measurements.js`, `public/js/views/routine-editor.js`, `server/http.js`, `test/` |
| **Dependencies** | None. |
| **Complexity** | S |
| **Risks** | Misinterpreting `1.234` (thousands vs decimal). For weights, treat one separator as decimal; reject ambiguous multiple separators and ask the user. |
| **Tests** | `72,5` → 72.5; `72.5` → 72.5; `1.234,5` → 1234.5; `1,234.5` → 1234.5; empty → null; `abc` → invalid. Persist through the UI and reload. |
| **Acceptance criteria** | All numeric forms accept comma and dot decimals. Invalid input shows a clear message and never becomes `0` silently. Server validation remains the final guard. |

#### P1-05 — Surface exercise progression and correct e1RM/PRs

| Field | Value |
|---|---|
| **ID** | P1-05 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Surface exercise progression and correct e1RM/PRs |
| **Priority** | P1 |
| **Problem** | The exercise-stats endpoint exists but no view uses it, so users cannot see progression. The e1RM calculation multiplies the maximum weight by an unrelated maximum rep count, overstating strength; PRs count only maximum weight. |
| **Evidence** | `server/routes/stats.js` `GET /exercise/:exerciseId`, `bestWeight`, `max_reps`, `best1rm`; `public/js/api.js` `stats.exercise`; no caller in `public/js/views`. `server/services/workouts.js` `prCount`. |
| **Benefit** | Turns recorded data into actionable training feedback, which is a core reason to keep a log. |
| **Proposed approach** | First fix the calculation: compute e1RM per set with a documented formula (e.g. Epley `weight * (1 + reps/30)`), then take the maximum; define PR types explicitly (max weight, best e1RM, reps at a given weight, session volume). Add a per-exercise detail view or an expandable section in the workout/routine views with a line chart from the existing endpoint. Keep the endpoint backward-compatible or version the response. |
| **Relevant files** | `server/routes/stats.js`, `server/services/workouts.js`, `public/js/api.js`, `public/js/views/workout.js`, `public/js/views/routine.js`, `public/js/charts.js`, `test/` |
| **Dependencies** | P1-03 (editable history makes corrected data meaningful), P1-01. |
| **Complexity** | M |
| **Risks** | Users may interpret e1RM as a tested max; label it as an estimate. Changing PR counts changes historical badges; decide whether to recompute or keep the old definition. |
| **Tests** | Known sets produce the expected e1RM. e1RM uses one set's weight/reps, not separate maxima. PR definitions produce expected counts. Endpoint scopes to the owner. |
| **Acceptance criteria** | Per-exercise progression is visible and driven by real data. e1RM is computed per set with a documented formula. PR definitions are documented and tested. |

#### P1-06 — Security hardening pass

| Field | Value |
|---|---|
| **ID** | P1-06 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Security hardening pass |
| **Priority** | P1 |
| **Problem** | There is no rate limiting, no Origin check on state-changing requests, no production enforcement of secure cookies, and the dev-login endpoint is bodyless. |
| **Evidence** | `server/app.js` (no rate-limit middleware); `server/routes/auth.js` `POST /dev`; `server/config.js` `cookieSecure` optional; `server/auth.js` `setSessionCookie`. |
| **Benefit** | Reduces abuse and misconfiguration risk without adding infrastructure. |
| **Proposed approach** | Add a small in-memory rate limiter (or `express-rate-limit`) for auth, import and sync endpoints; make it per-IP and per-user. Add an Origin/Sec-Fetch-Site check for `POST`/`PATCH`/`DELETE` when `PUBLIC_URL` is configured. In production, force `Secure` cookies or refuse to boot. Add `__Host-` only if HTTPS-only and no subdomain compatibility issue. Require an explicit dev-login opt-in (P0-04) and add a CSRF token or Origin check for it. Review Helmet CSP after any new external asset. |
| **Relevant files** | `server/app.js`, `server/routes/auth.js`, `server/config.js`, `server/auth.js`, `.env.example`, `test/` |
| **Dependencies** | P0-04. |
| **Complexity** | M |
| **Risks** | Rate limits can lock out the owner during a legitimate import; set generous limits and a clear error. Origin checks can break the Cloudflare/proxy setup; use `PUBLIC_URL` and test. |
| **Tests** | Rate limit returns 429 after N attempts. Origin mismatch rejected. Production config without secure cookies fails or forces secure. Dev login disabled by default. |
| **Acceptance criteria** | Auth/import/sync endpoints are rate-limited. State-changing requests validate origin. Production cookies are secure. Dev login is explicit and non-production only. |

#### P1-07 — Versioned transactional migrations and integrity constraints

| Field | Value |
|---|---|
| **ID** | P1-07 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Versioned transactional migrations and integrity constraints |
| **Priority** | P1 |
| **Problem** | Schema changes are ad-hoc `CREATE TABLE IF NOT EXISTS` plus `ensureColumn()` calls and one bespoke migration. There is no version table, no ordered runner, no checksum and no transaction around the bootstrap. Several uniqueness invariants exist only in application code. |
| **Evidence** | `server/db.js` schema block, `ensureColumn()`, legacy catalog migration; missing unique indexes on `workout_sets(workout_exercise_id, set_number)`, `routine_exercises(routine_id, position)` and `workout_exercises(workout_id, position)`. |
| **Benefit** | Makes future schema changes (for example offline ids and integrity constraints) safer and repeatable; lets the database reject duplicate positions/numbers. |
| **Proposed approach** | Add a `schema_migrations` table and `server/migrations/NNN_description.sql` files applied in order inside a transaction, with a checksum. Baseline the current schema as migration 001. Add unique indexes after a deduplication step. Keep `db.js` as the connection/bootstrap module, not the schema source. Add a `npm run migrate` command and run it on boot or explicitly in deploy. Back up before migrating. |
| **Relevant files** | `server/db.js`, new `server/migrations/*`, new `server/migrate.js`, `package.json`, `Dockerfile`/compose if migrations run at boot, `test/` |
| **Dependencies** | P0-03 (adds the external id column), P1-01. |
| **Complexity** | M |
| **Risks** | Existing databases may contain duplicate positions/numbers; the migration must repair them deterministically. A failed migration must roll back and leave a usable database. SQLite `ALTER TABLE` is limited; use table rebuilds when necessary. |
| **Tests** | Fresh DB migrates from zero. Existing fixture DB upgrades to current. Re-running is a no-op. Duplicate rows are repaired. Failed migration rolls back. Checksums detect edited migrations. |
| **Acceptance criteria** | Schema version is stored and queryable. Migrations run in order and transactionally. Uniqueness constraints are enforced. Fresh and existing databases both reach the same schema. |

#### P1-08 — Operational readiness: health, shutdown, logs

| Field | Value |
|---|---|
| **ID** | P1-08 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Operational readiness: health, shutdown, logs |
| **Priority** | P1 |
| **Problem** | The health check does not touch SQLite; there is no graceful shutdown or `db.close()`; logs are unstructured console output. |
| **Evidence** | `server/app.js` `/api/health` returns `{ok,time}`; `server/index.js` has no signal handlers; `console.log/warn/error` throughout. |
| **Benefit** | Detects a broken database before the deploy gate passes; avoids truncated WAL writes on restart; makes failures diagnosable. |
| **Proposed approach** | Extend `/api/health` to run `SELECT 1`, check the schema version, and check that the DB file is writable (read-only in a lightweight way). Return 503 on failure. Add `SIGTERM`/`SIGINT` handlers that stop accepting connections, close the HTTP server and call `db.close()`, with a timeout. Add structured JSON logs with level, timestamp, request id and route; avoid logging secrets. Optionally add a simple `/api/health/ready` vs `/api/health/live` split. |
| **Relevant files** | `server/app.js`, `server/index.js`, `server/db.js`, `Dockerfile`, `docker-compose.yml`, `test/` |
| **Dependencies** | P1-07 (schema version). |
| **Complexity** | S |
| **Risks** | A health check that writes to the DB can itself cause load; keep it read-only. A shutdown that hangs must force-exit after a timeout. |
| **Tests** | Health returns 503 when the DB is unavailable. Shutdown drains a request and closes the DB. Log entries are valid JSON and contain no secrets. |
| **Acceptance criteria** | Health reflects DB availability. Restart/shutdown is clean. Logs are structured and useful. |

#### P1-09 — Deploy safety: versioned images and rollback

| Field | Value |
|---|---|
| **ID** | P1-09 |
| **Status** | ✅ Done (code in repo; not runnable here — needs the self-hosted runner to exercise) |
| **Title** | Deploy safety: versioned images and rollback |
| **Priority** | P1 |
| **Problem** | The deploy resets the production checkout hard, rebuilds in place and overwrites the local image tag. There is no pre-deploy backup, no test gate and no rollback. |
| **Evidence** | `.github/workflows/deploy.yml` `git reset --hard origin/main`, `docker compose up -d --build app`, health probe; `docker-compose.yml` uses a local image tag. |
| **Benefit** | Makes a bad deploy recoverable and prevents deploying untested code. |
| **Proposed approach** | Tag the image with the commit SHA (or a release id), keep the previous tag, and let `docker compose` select it via an env var. Run `npm ci && npm test` before the build. Take a pre-deploy backup (P0-02). Wait for health with retries; if unhealthy, redeploy the previous tag and report failure. Do not `git reset --hard` over uncommitted production state; either make the checkout strictly read-only or back it up first. |
| **Relevant files** | `.github/workflows/deploy.yml`, `docker-compose.yml`, `Dockerfile`, `scripts/` (backup/rollback), `README.md` |
| **Dependencies** | P0-02, P1-01. |
| **Complexity** | M |
| **Risks** | Storing multiple images consumes disk. The rollback must also consider schema migrations (a code rollback against a newer schema may fail); document forward-only migrations or add a compatible rollback policy. |
| **Tests** | Deploy a known-good SHA, then simulate a failing health check and verify the previous image is restored. Verify tests block a failing deploy. Verify a pre-deploy backup exists. |
| **Acceptance criteria** | Every deploy is test-gated, backed up and tagged. A failed health check rolls back automatically. The rollback procedure is documented and tested. |

#### P1-10 — Complete and version the PWA shell cache

| Field | Value |
|---|---|
| **ID** | P1-10 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Complete and version the PWA shell cache |
| **Priority** | P1 |
| **Problem** | Precache lists only `app.js` and the CSS, not the other shell modules. The cache version is manually bumped, so a deploy can leave clients with stale modules. |
| **Evidence** | `public/sw.js` `PRECACHE` and `CACHE_VERSION = 'fitlog-v10'`; `public/js/app.js` imports views and helpers dynamically; `git log` shows manual version bumps. |
| **Benefit** | Makes the installed app reliably launchable and avoids mixed-version shells after deploys. |
| **Proposed approach** | Precache every first-party module needed for boot (or generate the list at build time). Keep `/api/` uncached. Derive the cache name from a release id injected into `sw.js`, or add a CI check that fails when shell files change without a version bump. Add a clear offline state in the app instead of redirecting to login when the API is unreachable. Consider an update prompt rather than unconditional `skipWaiting`. |
| **Relevant files** | `public/sw.js`, `public/js/app.js`, `public/index.html`, `.github/workflows/deploy.yml`, `test/` (manual/browser smoke) |
| **Dependencies** | None. Does not provide offline writes; see P2-01. |
| **Complexity** | S |
| **Risks** | Precaching too much slows install; precaching a missing file is tolerated but hides errors. Test on iOS Safari and Android Chrome. |
| **Tests** | Install, go offline, cold-launch: shell loads without a missing-module error. Navigate to every route offline: each module is available. Deploy with a changed shell: cache is replaced. `/api/` is never served from cache. |
| **Acceptance criteria** | The shell is complete and versioned deterministically. No stale-module deploy. Offline behavior is explicit, even though writes remain unavailable. |

#### P1-11 — Invalidate catalog caches after sync

| Field | Value |
|---|---|
| **ID** | P1-11 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Invalidate catalog caches after sync |
| **Priority** | P1 |
| **Problem** | Module-level name→catalog caches in `hevy-import.js` and `hevy-templates.js` are never cleared after a catalog re-sync. Hevy imports can resolve against stale catalog data until the process restarts. |
| **Evidence** | `server/hevy-import.js` `catalogByNormCache`; `server/hevy-templates.js` `catalogByNormCache` and `_clearCatalogCache()` (no caller); catalog sync in `server/catalog.js`/`server/index.js`. |
| **Benefit** | Keeps exercise matching correct after catalog updates with a tiny change. |
| **Proposed approach** | Export a single cache-invalidation function from each module (or centralise catalog lookup in one cached module) and call it at the end of a successful catalog sync and after `linkUserExercises()`. Add a test that changes the catalog and verifies the new mapping is used. |
| **Relevant files** | `server/hevy-import.js`, `server/hevy-templates.js`, `server/catalog.js`, `server/index.js`, `server/routes/exercises.js`, `test/` |
| **Dependencies** | None. |
| **Complexity** | XS |
| **Risks** | Over-invalidating on every request would negate the cache; invalidate only on sync. |
| **Tests** | Sync catalog with a new/renamed exercise, then resolve an import → new mapping. Cache is rebuilt once. |
| **Acceptance criteria** | A catalog sync invalidates all relevant caches. No process restart is required. |

#### P1-12 — Shared frontend helpers and unsaved-change guard

| Field | Value |
|---|---|
| **ID** | P1-12 |
| **Status** | ✅ Done (verified in code) — unsaved-change guard and shared workout-card/week-range helpers extracted |
| **Title** | Shared frontend helpers and unsaved-change guard |
| **Priority** | P1 |
| **Problem** | Workout cards, date/week labels and exercise grouping are duplicated across views. The routine editor discards unsaved changes silently on cancel/navigation. |
| **Evidence** | `public/js/views/home.js`, `training.js`, `history.js`, `profile.js` duplicate workout cards/helpers; `public/js/views/routine-editor.js` cancel handler has no dirty check. |
| **Benefit** | Reduces the cost and regression risk of future UI changes; prevents accidental loss of a routine being edited. |
| **Proposed approach** | Extract `workoutCard()`, `weekRangeLabel()`, `groupExercises()` and shared formatters into a small module, adopting them view by view when a view is already being changed. Add a `dirty` flag to the routine editor; confirm on cancel and on hash navigation (use the router's cleanup or a `beforeunload` for full reloads). |
| **Relevant files** | New `public/js/components/workout-card.js` or `public/js/view-helpers.js`, `public/js/views/*.js`, `public/js/app.js` (if navigation guard), `test/` |
| **Dependencies** | P1-03 (touches workout views). |
| **Complexity** | S |
| **Risks** | Refactoring all views at once increases regression risk; do it incrementally. A navigation guard can become annoying; only prompt when dirty. |
| **Tests** | Visual/DOM smoke for the extracted card; routine editor cancel with changes prompts, without changes navigates. |
| **Acceptance criteria** | No duplicated workout-card implementation remains in the touched views. Unsaved routine edits require confirmation. |

### 7.4 P2 — Optional / future tasks

#### P2-01 — Offline workout logging (conditional)

| Field | Value |
|---|---|
| **ID** | P2-01 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Offline workout logging |
| **Priority** | P2 |
| **Problem** | The app cannot record a workout without connectivity; a failed save loses the value on reload. |
| **Evidence** | `public/sw.js` bypasses `/api/`; `public/js/app.js` requires `/api/auth/me`; `public/js/views/active.js` has no local persistence; `localStorage` is used only for theme/folders. |
| **Benefit** | Lets the user train in a gym with poor signal and sync later; protects the active workout from connectivity loss. |
| **Proposed approach** | Treat as a local-first feature, not a service-worker tweak: IndexedDB active-workout store + outbox; client-generated UUIDs sent as idempotency keys; server-side `client_id` unique per user on workouts/sets; local-first writes then background flush; ordered outbox with backoff; visible pending state; conflict policy based on `updated_at` with the server as authority for completed workouts; clear local data on logout; no cross-user cache. See §5C for the full design. |
| **Relevant files** | `public/js/views/active.js`, new `public/js/offline/*`, `public/sw.js`, `public/js/api.js`, `server/routes/workouts.js`, `server/services/workouts.js`, `server/db.js`, migrations, `test/` |
| **Dependencies** | Product decision (§10); P1-10 (complete shell); P0-03 (idempotency patterns); P1-07 (schema). |
| **Complexity** | XL |
| **Risks** | Duplicate workouts, lost sets, cross-user leakage on a shared device, sync conflicts, iOS storage eviction. This is the highest-risk feature in the backlog and should not be started without a written product decision and a sync design review. |
| **Tests** | Airplane mode: start workout, add/edit sets, reload, restore connection → exactly one workout and the correct sets on the server. Retry after a 500 does not duplicate. Two tabs do not corrupt state. Logout clears local data. |
| **Acceptance criteria** | (Only if approved) A workout can be recorded end-to-end offline and reconciled exactly once. Conflicts follow the documented policy. No local data survives logout. |

#### P2-02 — Apple Health integration spike / companion (conditional)

| Field | Value |
|---|---|
| **ID** | P2-02 |
| **Status** | ❌ Won't do — product decision: FitLog stays a PWA; HealthKit needs a native iOS companion, out of scope |
| **Title** | Apple Health integration spike / companion |
| **Priority** | P2 |
| **Problem** | A PWA cannot access HealthKit; the current app has no path to Apple Health data. |
| **Evidence** | Web platform constraint; no HealthKit code exists in the repository; the app is a PWA (`public/manifest.webmanifest`). |
| **Benefit** | Enables workout/body-weight exchange with Apple Health if that is a real user need. |
| **Proposed approach** | Start with a one-page product decision and a technical spike, not an implementation. Choose one: (1) authenticated Apple Health export/XML import endpoint for occasional history; (2) a small native iOS companion using HealthKit and the existing API; or (3) ingestion from a bridge app the user already uses. Do not rewrite the PWA. Estimate the native option separately (Swift/SwiftUI, signing, background delivery, App Store). |
| **Relevant files** | Likely new `server/routes/health-import.js`, parsing service, import UI; native companion in a separate repository/target. No existing source file is the main change. |
| **Dependencies** | Product decision (§10); for the native option, an Apple Developer account and a release process. |
| **Complexity** | L–XL |
| **Risks** | Ongoing native maintenance, App Store review, HealthKit permission UX, duplicate imports from multiple sources. An XML import can be very large and must be streamed. |
| **Tests** | (If import) fixture XML, idempotent re-import, malformed file rejection, cross-user isolation. (If companion) HealthKit sandbox tests and API contract tests. |
| **Acceptance criteria** | A documented decision on direction, data types and ownership. If implemented, imports are idempotent and scoped to the user; no PWA rewrite is required. |

#### P2-03 — Rest timer and set-level UX

| Field | Value |
|---|---|
| **ID** | P2-03 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Rest timer and set-level UX |
| **Priority** | P2 |
| **Problem** | `rest_seconds` exists in the schema/API but there is no timer in the active view. Users must watch the clock. |
| **Evidence** | `server/db.js` `workout_sets.rest_seconds`; `server/services/workouts.js` `serializeSet`; no timer code in `public/js/views/active.js`. |
| **Benefit** | Faster, less error-prone workouts; uses data the app already stores. |
| **Proposed approach** | Add an opt-in rest timer per exercise/set, defaulting from `rest_seconds` or a user setting. Start on set completion, show a compact countdown with skip/+15 s, and fire a haptic/sound when available. Persist the default rest per routine exercise only if the product wants it. Keep it client-side; no server timer. |
| **Relevant files** | `public/js/views/active.js`, `public/css/views.css`, `server/routes/workouts.js` (rest value), `test/` |
| **Dependencies** | P1-03 (set editing), product decision. |
| **Complexity** | M |
| **Risks** | iOS background timers are throttled; do not promise a notification while the app is closed. Audio/haptics need user-gesture permission. |
| **Tests** | Timer starts/stops/skips; value persists; backgrounding and returning does not reset incorrectly. |
| **Acceptance criteria** | A rest timer is available and opt-in. It uses the stored rest value and does not block logging. |

#### P2-04 — Richer PR and statistics definitions

| Field | Value |
|---|---|
| **ID** | P2-04 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Richer PR and statistics definitions |
| **Priority** | P2 |
| **Problem** | PRs only count maximum weight; other meaningful records (reps at a weight, e1RM, volume) are not represented. |
| **Evidence** | `server/services/workouts.js` `prCount`; `server/routes/stats.js` overview. |
| **Benefit** | More meaningful progress feedback, once the data and definitions are trustworthy. |
| **Proposed approach** | Define a small PR taxonomy with the product owner, implement it in the stats service, and surface it only after P1-05 fixes e1RM. Avoid gamification that complicates the schema. |
| **Relevant files** | `server/services/workouts.js`, `server/routes/stats.js`, `public/js/views/*` |
| **Dependencies** | P1-05, product decision. |
| **Complexity** | M |
| **Risks** | Definition churn changes historical badges; version the calculation or document it. |
| **Tests** | Fixture sets for each PR type; endpoint and UI consistency. |
| **Acceptance criteria** | PR definitions are documented, tested and stable. |

#### P2-05 — Remove dead schema and unused API surface

| Field | Value |
|---|---|
| **ID** | P2-05 |
| **Status** | ✅ Done (verified in code) |
| **Title** | Remove dead schema and unused API surface |
| **Priority** | P2 |
| **Problem** | `hevy_sync.last_cursor` is never used; `addExerciseToWorkout` accepts `prefill`/`targetReps` but ignores them; `hevy_templates` has unused fields; template cache survives disconnect. |
| **Evidence** | `server/db.js` `last_cursor`; `server/services/workouts.js` `addExerciseToWorkout` destructuring; `server/routes/workouts.js`; `server/hevy-sync.js` `disconnect`. |
| **Benefit** | Reduces confusion and prevents clients from relying on parameters that do nothing. |
| **Proposed approach** | Remove or implement each item; if kept for compatibility, document it. Clean up the template cache on disconnect if it is not needed for re-import. Do this only after the related functional work is stable. |
| **Relevant files** | `server/db.js`, `server/services/workouts.js`, `server/routes/workouts.js`, `server/hevy-sync.js`, migrations, `test/` |
| **Dependencies** | P1-07 (migration runner). |
| **Complexity** | S |
| **Risks** | Removing a column used by an older deployment; migration ordering matters. |
| **Tests** | Existing suite passes; no client sends the removed parameters. |
| **Acceptance criteria** | No dead fields or ignored parameters remain, or they are explicitly documented as reserved. |

---

## 8. Proposed implementation milestones

*Status: Completed.*

Each milestone is small enough to review independently, preserves existing
functionality, and ends with tests. The sequence follows the dependency order in
§7; milestones can overlap only where their files do not conflict.

### M1 — Never lose an active set

| Field | Value |
|---|---|
| **Status** | ✅ Done — P0-01 and P1-01 complete. |
| **Objective** | Eliminate the confirmed data-loss path in the core workout flow and establish the test harness that protects it. |
| **Included tasks** | P0-01, P1-01 (the test harness and active-set tests are part of this milestone) |
| **Dependencies** | None |
| **Expected outcome** | Per-set persistence, flush on navigation/background, visible and retryable save failures, and a CI test gate. |
| **Validation strategy** | Automated tests for two rapid edits, navigate-away flush, transient failure retry and completion toggling; a short manual pass on iOS Safari and Android Chrome. |
| **Definition of done** | P0-01 acceptance criteria met; the critical test suite runs in CI; a failing test blocks the deploy; no regression in the existing happy-path suite. |

### M2 — Protect the data

| Field | Value |
|---|---|
| **Status** | ✅ Done — P0-02 and P1-09 complete. |
| **Objective** | Make the database recoverable and make deploys reversible. |
| **Included tasks** | P0-02, P1-09 |
| **Dependencies** | M1 (CI test gate) |
| **Expected outcome** | Scheduled backups, pre-deploy backup, verified restore, versioned images and automatic rollback on a failed health check. |
| **Validation strategy** | Restore a backup into a temporary database and verify integrity/row counts; deploy a known-good SHA; simulate a failed health check and confirm the previous image is restored. |
| **Definition of done** | A documented and tested restore; retention and off-host copy configured; every deploy is test-gated and backed up; rollback is exercised at least once. |

### M3 — Trust the Hevy import

| Field | Value |
|---|---|
| **Status** | ✅ Done — P0-03, P1-02, P1-07 and P1-11 complete. |
| **Objective** | Make Hevy sync genuinely idempotent, updatable and observable. |
| **Included tasks** | P0-03, P1-02, P1-07, P1-11 |
| **Dependencies** | M1 (test fixtures and CI) |
| **Expected outcome** | Stable external workout ids, upsert on update, rename without duplicates, a defined delete policy, timeouts/retries/locks, visible routine warnings, versioned migrations and fresh catalog caches. |
| **Validation strategy** | Fake Hevy fixtures for create/update/rename/delete; concurrent sync test; timeout/429 retry tests; migration tests from a pre-change database; cache invalidation test. |
| **Definition of done** | Re-syncing the same fixture has no duplicate; updates appear; deletes follow policy; sync status is honest; migrations are versioned and reversible to a usable state; all tests pass. |

### M4 — Close access and harden the perimeter

| Field | Value |
|---|---|
| **Status** | ✅ Done — P0-04 and P1-06 complete. |
| **Objective** | Ensure only the intended user(s) can access the instance and reduce configuration/abuse risk. |
| **Included tasks** | P0-04, P1-06 |
| **Dependencies** | None (can run in parallel with M2/M3) |
| **Expected outcome** | Google allowlist, explicit dev-login opt-in, rate limiting, origin checks and enforced secure cookies in production. |
| **Validation strategy** | Tests for rejected accounts, boot refusal with an invalid security configuration, rate-limit responses, origin mismatch and cookie flags. A manual check with a second Google account. |
| **Definition of done** | Only allowlisted accounts can log in; production cannot start with an unsafe access/cookie configuration; abuse controls are active on auth/import/sync. |

### M5 — Correct the record

| Field | Value |
|---|---|
| **Status** | ✅ Done — P0-05, P1-04 and P1-03 complete. |
| **Objective** | Stop silent data corruption and allow users to fix mistakes. |
| **Included tasks** | P0-05, P1-04, P1-03 |
| **Dependencies** | M1 (tests); P1-03 benefits from P0-01 |
| **Expected outcome** | Non-destructive measurement merges, comma/dot numeric input, and editable completed workouts. |
| **Validation strategy** | API tests for merge/clear semantics and locale parsing; UI tests for editing a finished workout and reloading; manual Spanish-keyboard check. |
| **Definition of done** | Partial measurement saves preserve omitted fields; `72,5` works everywhere; finished workouts can be corrected; changes appear in history and stats. |

### M6 — Make progress visible

| Field | Value |
|---|---|
| **Status** | ✅ Done — P1-05, P1-12 and P2-04 complete. |
| **Objective** | Turn stored history into useful, trustworthy progression feedback and reduce frontend duplication. |
| **Included tasks** | P1-05, P1-12 (P2-04 only if the product owner approves the PR definitions) |
| **Dependencies** | M5 (editable/correct data) |
| **Expected outcome** | Per-exercise progression view, corrected e1RM/PR calculations, shared view helpers, and an unsaved-changes guard. |
| **Validation strategy** | Fixture-based calculation tests, endpoint ownership tests, visual check of the chart, and a manual cancel/navigate test in the routine editor. |
| **Definition of done** | e1RM is computed per set with a documented formula; progression is visible and correct; PR definitions are documented; no duplicated workout card in touched views; unsaved routine edits prompt. |

### M7 — Operational readiness and PWA shell

| Field | Value |
|---|---|
| **Status** | ✅ Done — P1-08 and P1-10 complete. |
| **Objective** | Make failures diagnosable and the installed app reliable. |
| **Included tasks** | P1-08, P1-10 |
| **Dependencies** | M2 (deploy), M3 (migrations) |
| **Expected outcome** | DB-aware health check, graceful shutdown, structured logs, complete shell precache and deterministic cache versioning. |
| **Validation strategy** | Health check with a broken DB; SIGTERM during a request; cold offline launch on iOS/Android; deploy with changed shell assets. |
| **Definition of done** | Health reflects DB state; shutdown is clean; logs are structured; every route boots offline; no stale-module deploy; offline writes are explicitly documented as unavailable. |

### M8 — Optional bets

| Field | Value |
|---|---|
| **Status** | ◻ Mostly done — P2-01, P2-03 and P2-05 done; P2-02 won't-do (PWA, not native iOS). |
| **Objective** | Evaluate and, only if approved, deliver the larger product bets. |
| **Included tasks** | P2-01, P2-02, P2-03, P2-05 |
| **Dependencies** | Written product decisions in §10; P1-10 and P0-03 for offline; P1-07 for cleanup |
| **Expected outcome** | A decision record for offline and Apple Health; implementation only after approval. Rest timer and cleanup can proceed independently. |
| **Validation strategy** | A design review and prototype for offline; a one-page spike for Apple Health; tests for any implemented feature. |
| **Definition of done** | Each P2 item is either explicitly deferred with a reason or implemented behind its acceptance criteria. No speculative infrastructure is added. |

---

## 9. Testing and validation strategy

*Status: Completed.*

### 9.1 Principles

- **Risk-based, not coverage-driven.** Test the invariants that would cause
  silent data loss, cross-user exposure or a broken sync. Do not chase a line
  coverage number.
- **Deterministic and offline.** No live Hevy, Google or network dependency in
  CI. Inject a fake `fetch` through `HevyClient`'s existing `fetchImpl` option.
- **Fast.** The API suite should run in under a minute on a laptop. Save browser
  and device checks for the small number of behaviours that need them.
- **Test behaviour, not implementation.** Assert that two edits persist, not
  that a particular timer function was called.
- **Every P0 fix ships with a regression test.** No exceptions.

### 9.2 Test layers

| Layer | Tool | Scope | Examples |
|---|---|---|---|
| Unit | `node:test` | Pure functions with no I/O | Decimal parsing, e1RM per set, Hevy normalisation, backup retention, cache invalidation |
| API integration | `node:test` + `supertest` | Express routes + real temporary SQLite | Auth, isolation, routine/workout CRUD, measurements, Hevy sync with a fake client |
| Database/migration | `node:test` + temporary DB fixtures | Schema creation, upgrades, constraints, transactional rollback | Fresh DB, legacy DB, duplicate repair, failed migration |
| Browser smoke | Playwright (optional, one spec) | Timer/navigation behaviour that HTTP tests cannot see | Active-set debounce, flush on navigate, reload persistence |
| Manual device | Checklist | iOS Safari installed PWA, Android Chrome | Install, offline launch, keyboard/decimal input, safe areas, swipe gestures |

### 9.3 Critical-flow test matrix

| Flow | Level | Setup | Key assertions |
|---|---|---|---|
| Dev/Google login | API | Test config, fake Google payload | Valid user gets a session; invalid token 401; non-allowlisted 403; no user row created |
| Session expiry | API | Insert an expired session or inject a clock | Expired token rejected; session row cleaned up; logout invalidates immediately |
| Multi-user isolation | API | Two users, two agents | User B gets 404/empty for A's routine, workout, set, exercise, measurement; updates/deletes do not affect A |
| Active set persistence | Unit + browser | Fake API with latency | Two sets edited within 500 ms both persist; navigate flushes; retry after failure; no duplicate |
| Workout lifecycle | API | Routine fixture | Start → add/edit sets → finish → history; ownership checks; invalid weights/reps rejected |
| Measurement merge | API | Existing row | Omitted fields preserved; explicit null clears; new date inserts; empty merged record 400 |
| Hevy full import | API | Fake paginated workouts/templates | Correct workouts/sets/exercises; template mapping; totals |
| Hevy incremental sync | API | `last_sync_at` fixture + events | Only new/updated events applied; cursor advances only on success |
| Hevy update/rename | API | Same external id, changed fields | One row; fields updated; rename does not duplicate |
| Hevy delete | API | Deleted event | Policy applied (delete or tombstone); unrelated workouts untouched |
| Hevy duplicate events | API | Same event twice | One workout; no duplicate sets |
| Hevy partial failure | API | Routine endpoint throws | Workouts still imported; routine warning surfaced; status honest |
| Webhook auth | API | Correct/wrong bearer token | 401 on wrong/missing; 200 before sync on correct; sync failure does not change 200 |
| Sync concurrency | Unit/API | Two simultaneous `syncUser` calls | One network execution; both callers resolve consistently |
| Migration | DB | Fresh + legacy fixtures | Version recorded; idempotent; duplicates repaired; failed migration rolls back |
| Backup/restore | Script | Temp DB with writes | Backup is valid; integrity check passes; row counts match; retention works |
| PWA shell | Manual/browser | Installed app, offline | Cold launch works; every route module available; `/api/` not cached; new deploy replaces cache |
| Deploy rollback | CI/manual | Failing health check | Previous image restored; test gate blocks bad builds |

### 9.4 Test harness design

- Set `DB_PATH`, `NODE_ENV`, `ALLOW_DEV_LOGIN`, `GOOGLE_CLIENT_ID` and cookie
  flags **before** importing `server/app.js`; `server/config.js` reads them at
  module load.
- Because `server/db.js` opens a single module-level database, either run each
  test file in its own process (`node --test` already does this per file) or
  use a separate child process per database. Do not share a DB between test
  files.
- Build two `supertest.agent` instances for isolation tests.
- Provide a fixture builder that inserts users, exercises, routines, workouts
  and sets with explicit ids where the test needs them.
- For Hevy, pass a fake `fetchImpl` returning deterministic pages. Include
  fixtures for: one workout with two exercises, an updated workout with the same
  id, a renamed workout, a deleted event, a 429 response and a timeout.
- Do not depend on wall-clock ordering. Use fixed ISO timestamps and inject a
  clock where expiry matters.

### 9.5 CI pipeline

1. `npm ci`
2. `node --check` on server/public/test files (fast syntax gate; keep it even
   though `npm test` imports most files)
3. `npm test` (API + unit + migration)
4. Optional browser smoke job (separate, allowed to be skipped if the runner
   cannot support it)
5. Deploy only if steps 1–3 pass; take a backup before the build (P0-02) and
   health-check with rollback (P1-09).

Do not add a coverage threshold until the critical matrix is fully covered;
then consider a soft threshold (for example 70% on `server/services` and
`server/routes`) rather than a global number.

### 9.6 Manual validation checklist

- **Mobile:** iPhone Safari (installed PWA) and Android Chrome: install,
  cold-launch offline, decimal comma input, set editing, swipe-to-delete,
  pull-to-refresh, safe areas, 16px inputs (no zoom).
- **Hevy:** connect with a real key in a non-production database, run a full
  sync, change a workout in Hevy, run an incremental sync, verify update and
  no duplicate. Test disconnect/reconnect. Do not use production data for
  destructive tests.
- **Backup:** restore into a temporary path and start the app against it; verify
  login, history and a write.
- **Deploy:** deploy to a staging directory or a temporary compose project,
  simulate a failing health check, verify rollback.

### 9.7 Inspection and execution limitations

The following were **not** possible in this environment; no claim in this report
depends on them:

1. **The test suite was not executed.** `node_modules` is absent and installing
   dependencies is outside the authorised scope. I ran `node --check` on every
   `.js` file (all passed) and parsed `manifest.webmanifest` and
   `user-exercise-aliases.json` successfully. Passing syntax checks does not
   prove runtime correctness.
2. **Docker was not available.** I could not build the image, run Compose, or
   observe health checks, volumes, host networking or Cloudflare Tunnel
   behaviour. Dockerfile/Compose findings are static inspection.
3. **No production database or `data/` directory exists in the checkout.** I
   could not inspect real row counts, existing duplicates, schema drift or
   migration rehearsal against real data.
4. **No live Hevy API key or Google OAuth client was available.** Hevy sync,
   webhook and Google login behaviour is inferred from code and fixtures, not
   observed against the services.
5. **No Apple device or HealthKit environment was available.** Apple Health
   conclusions are based on the documented platform constraint, not a device
   test.
6. **No browser automation or dev server was run.** Offline/PWA and gesture
   behaviour is inferred from `public/sw.js` and view code, not observed.
7. **No performance or load measurements were taken.** Do not read this report
   as evidence about latency, memory or throughput.
8. **Dependency vulnerabilities were not scanned.** `node_modules` is absent;
   versions were read from `package.json`/`package-lock.json` only.
9. **The `.dockerignore` `*.png` rule was not verified against Docker's matching
   semantics.** I did not assert that PWA icons are missing from the image.
10. **Git history was inspected only enough to establish the current commit and
    release pattern.** It was not audited for every past change.

---

## 10. Product-owner decisions and open questions

*Status: Completed.*

The decisions below require the product owner's input. The technical
implementation of each option is my responsibility to design; the choice of
**what the product should do** is not. Each item states a recommendation and
its consequences, but no option is assumed.

### 10.1 Decisions requiring approval

| ID | Decision | Options | Technical note / recommendation | Why it is needed |
|---|---|---|---|---|
| PD-01 | Is offline workout logging a priority? | (a) Now, before other UX work; (b) after P0/P1 reliability; (c) not planned | Recommend (b) or (c). Offline writes are an XL feature with duplicate/conflict risk; shell caching (P1-10) is worth doing regardless. | Determines whether P2-01 becomes P1 and whether the data model gets client ids and an outbox. |
| PD-02 | What should Apple Health integration do? | (a) Import Apple Health history; (b) export FitLog workouts to Health; (c) two-way automatic sync; (d) no integration | Recommend deciding the direction first. (a) can be a file import endpoint; (c) needs a native companion. Do not rewrite the PWA. | Each option has a different cost: S–M backend vs L–XL native app. |
| PD-03 | Who may create an account? | (a) Single owner only; (b) invited allowlist; (c) any Google user (public) | Recommend (a) or (b) for a personal instance. P0-04 implements an allowlist with an explicit public escape hatch. | This is the main security/product boundary for a tunnelled personal app. |
| PD-04 | Are imported Hevy workouts editable in FitLog? | (a) No, Hevy is the source of truth; (b) yes, edits are local and a re-sync overwrites them with a warning; (c) editing forks the workout into a local copy | Recommend (a) for the first iteration, or (c) if editing imported history is important. (b) is easy but surprising. | P0-03 and P1-03 must not fight each other. The choice affects the sync upsert policy. |
| PD-05 | What happens when Hevy reports a deleted workout? | (a) Delete the imported FitLog workout; (b) tombstone/hide it and keep the rows; (c) ignore deletes | Recommend (b) for safety against API glitches; it still needs a `deleted_at`/`hidden` field. (a) is simpler but destructive. | Deleted events are currently ignored; an explicit policy is required before P0-03. |
| PD-06 | Is Hevy sync one-way or two-way? | (a) Hevy → FitLog only; (b) FitLog → Hevy; (c) two-way | Recommend (a). Two-way sync needs stable ids on both sides, conflict resolution and write permissions; it is a separate product. | Prevents scope creep in the Hevy work and clarifies ownership of edits. |
| PD-07 | Which PR definitions are meaningful? | Max weight; estimated 1RM; reps at a given weight; session/exercise volume; combinations | Recommend starting with max weight and best e1RM per exercise, labelled as an estimate, then adding others only if used. | P1-05/P2-04 need a definition before changing badges or stats. |
| PD-08 | Is a rest timer important, and how should it behave? | Off by default; default per routine; sound/haptic; silent only | Recommend opt-in, client-side, defaulting from `rest_seconds`, no promise of background notifications. | P2-03 is optional and should not displace reliability work. |
| PD-09 | What are the backup RPO/RTO and off-host destination? | Daily/weekly; local only vs off-host; retention length | Recommend daily backups, 7 daily + 4 weekly, at least one encrypted off-host copy, and a documented restore. | P0-02 needs concrete targets to be verifiable. |
| PD-10 | Is a short maintenance window acceptable for schema migrations? | Zero-downtime requirement vs a brief restart | Recommend a brief restart for this single-user app; run migrations before starting the new image, with a pre-migration backup. | Determines whether P1-07/P1-09 need online migration machinery. |
| PD-11 | What is the UX priority order? | Editable history; progression charts; rest timer; offline; Apple Health | Recommend: editable history → progression → rest timer → offline/Apple Health. | Prevents parallel large features and keeps milestones small. |

### 10.2 Technical decisions I can recommend without product approval

These are engineering choices within the current product scope. The product
owner should review them, but they do not change what the app does:

1. Keep Node.js/Express, SQLite/`better-sqlite3`, vanilla JavaScript and the PWA
   architecture. Do not migrate frameworks or databases.
2. Add a critical-flow test harness with `node:test` and a CI test gate.
3. Fix active-set persistence with a per-set scheduler and flush-on-exit.
4. Add automated backups using SQLite's backup API, plus a restore check.
5. Give Hevy workouts a stable external id and a database uniqueness
   constraint, independent of the edit/delete policy chosen in PD-04/PD-05.
6. Add timeouts, retries, a per-user sync lock and honest status reporting.
7. Introduce a versioned, transactional migration runner.
8. Complete the PWA shell precache and derive the cache version from a release
   id; do not claim offline writes.
9. Make the health check query SQLite, add graceful shutdown and structured
   logs.
10. Add rate limiting, origin checks and production cookie enforcement.
11. Use JSDoc/`@ts-check` selectively instead of a TypeScript migration.
12. Do not add Redis, a job queue, a WAF, a service mesh or a native rewrite
    unless a product decision explicitly requires the capability.

### 10.3 Open technical questions

These are questions I could not answer from the code and that affect the
design, but they are narrower than the product decisions above:

- **Hevy API event shape:** the code assumes events contain
  `event.workout || event.payload` and `event.type === 'deleted'`. The exact
  documented payload should be confirmed against the current Hevy API before
  P0-03. The code comment says `{ type, workout?, id? }`, but a deletion may
  carry only an id.
- **Existing production duplicates:** are there already duplicate imported
  workouts in the real database? If yes, P0-03/P1-07 need a deduplication
  strategy (which row wins, what happens to notes). This cannot be inspected
  without the production database.
- **Google account model:** is `email_verified` always present for the token
  types used by Google Identity Services? The code currently does not check it;
  P0-04 should confirm the payload shape in a real login.
- **Deployment host access:** is there host-level cron/systemd for backups, or
  should backups run from a container sidecar? P0-02 needs this operational
  detail.
- **Apple Health direction:** see PD-02. Without it, the only safe statement is
  that a PWA cannot access HealthKit directly.
- **Expected data size:** current and projected row counts are unknown. They do
  not change the architecture recommendation, but they affect backup duration
  and migration timing.

### 10.4 Decisions explicitly deferred

- Offline workout logging (P2-01) is deferred until PD-01 is answered and the
  P0/P1 reliability work is complete.
- Apple Health (P2-02) is deferred until PD-02 is answered; only a spike is
  proposed, not an implementation.
- Two-way Hevy sync (PD-06) is out of scope for this roadmap.
- A native rewrite, framework migration and database migration are not
  recommended and are not planned.

---

## 11. What I would do next

*Status: Completed.*

### 11.1 Immediate operational check

If the instance is currently reachable through the Cloudflare Tunnel, do
**P0-04** as a small hotfix before any feature work: add the Google allowlist and
make dev login explicit opt-in. It is an S-sized change and it closes the most
direct exposure. It is not one of the three larger recommendations below only
because it does not require design work.

### 11.2 The first three tasks

**1. Fix active-workout set persistence (P0-01).**
This is the highest-value change because it protects the data the app exists to
record. It is local to the active view, does not require a schema change, and
can be verified with a small set of deterministic tests. The current shared
debounce plus `persistSet.cancel?.()` is a confirmed data-loss path, not a
hypothetical one. Start P1-01 (test harness and CI gate) in the same workstream
so the fix ships with regression coverage.

**2. Add automated backups with restore validation (P0-02).**
Once the active set is safe, the next largest risk is losing the database
itself. Backups are also a prerequisite for doing P0-03 and P1-07 safely: a
schema migration or a Hevy upsert change should never be attempted without a
tested restore path. This is a bounded operational change and delivers
disproportionate value.

**3. Give Hevy workouts a stable identity and idempotent upsert (P0-03).**
Hevy is a major feature, and the current duplicate detection is demonstrably
wrong for renames and updates. Fixing it requires the test harness from step 1
and ideally the backup from step 2. Do it before any further Hevy UX work:
otherwise every additional sync feature builds on an unreliable foundation.
Immediately afterwards, introduce the versioned migration runner (P1-07) and
baseline the resulting schema so future changes are applied reproducibly.

### 11.3 Why this order

- **Data loss before features.** P0-01 and P0-02 protect existing data; every
  other improvement assumes the data is still there.
- **Testability before risky changes.** P1-01 is not glamorous, but without it
  the Hevy and migration work would be guesswork. It is sequenced second in the
  backlog and runs alongside P0-01.
- **Identity before more sync.** P0-03 is the root cause of duplicate and stale
  Hevy data. Adding more sync behaviour on top of name/time matching would
  multiply the problem.
- **Security is not deferred.** P0-04 is a small immediate hotfix; P1-06 follows
  once the access model is decided.
- **UX waits for correctness.** Editable history, progression and rest timers
  are valuable, but they are P1/P2 because their value depends on trustworthy
  data.

### 11.4 What I would explicitly not do next

- Do not start offline workout logging before PD-01 is answered. It is an XL
  feature and should not be smuggled in as a service-worker change.
- Do not start Apple Health before PD-02 is answered. A PWA cannot access
  HealthKit; a native companion is a separate product.
- Do not migrate to React, TypeScript, PostgreSQL or a job queue. None of them
  addresses the confirmed problems.
- Do not add more workout features on top of the current Hevy sync or the
  current measurement upsert semantics.
- Do not attempt a large refactor. Extract only what the P0/P1 tasks touch.

### 11.5 First iteration in practice

1. Create `test/helpers/*`, move the existing happy path onto them, and add the
   active-set and isolation tests (P1-01).
2. Implement the per-set persistence scheduler and flush-on-exit (P0-01).
3. Add `scripts/backup-db.js` and `scripts/verify-backup.js`, schedule them, and
   perform one real restore (P0-02).
4. Add the Hevy external id, unique index and upsert logic (P0-03), then add
   the migration runner and baseline the resulting schema (P1-07).
5. Re-run the full suite, restore a backup, and verify a Hevy fixture update
   and rename before merging.

The output of that iteration should be: no known active-set data-loss path, a
tested database backup, and a Hevy sync that can be re-run without creating
duplicates or ignoring updates. That is a meaningful, reviewable foundation for
everything else in this roadmap.
