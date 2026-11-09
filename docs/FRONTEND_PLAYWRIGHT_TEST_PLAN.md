# FitLog — Frontend E2E Testing Audit & Playwright Test Strategy

> Analysis and planning document. Nothing in this document is implemented: no
> application code, tests, configuration, dependencies, Docker or CI files are
> modified by it. It audits the existing Playwright integration and the
> frontend, then proposes a prioritized Playwright strategy, a scenario catalog,
> a suite architecture and an implementation roadmap.

**Status legend:** `Pending` · `In progress` · `Completed`

| # | Section | Status |
|---|---|---|
| 0 | Executive summary | Completed |
| 1 | Audit of the existing Playwright integration | Completed |
| 2 | Frontend architecture & user-journey analysis | Completed |
| 3 | Selector / accessible-handle inventory | Completed |
| 4 | Testing strategy (cross-cutting + categories A–I) | Completed |
| 5 | Test scenario catalog | Completed |
| 6 | Suite architecture proposal | Completed |
| 7 | Execution strategy & CI | Completed |
| 8 | Prioritized implementation roadmap | Completed |
| 9 | Product-owner questions | Completed |
| 10 | Assumptions, limitations & open questions | Completed |

> **Update (D-15, §9.0):** the Docker `e2e` stage and the CI `e2e` job that this
> document audits (§1.1, F-3, F-10, §7.2) were **removed**; E2E runs locally only
> (`npm run test:e2e`). Read every CI/Docker mention below as "deferred".

**Evidence convention.** Claims cite `file:line` or a function/element name that
was read while writing this document. Where something was *not* read or *not*
executed it is labelled **Unverified** or **Spike** (a small investigation to
do first during implementation).

---

## 0. Executive summary

**Verdict.** The existing Playwright integration is the right foundation and
should be kept: real browser + real Express/SQLite booted by `webServer`, dev
login to avoid Google, Chromium only, and a Docker `e2e` stage that keeps
browsers out of the production image. It needs **hardening, not replacement**,
before coverage grows.

**What the frontend is.** A build-less, hash-routed vanilla-JS PWA of 12 views
(`public/js/app.js`), one API client where `status 0` means "offline", native
`<dialog>` modals, and a real offline-workout feature (IndexedDB snapshot +
idempotent `POST /api/workouts/sync`). The core loop — start workout → add
exercise → log sets → finish — plus offline logging are the highest-value and
highest-regression-risk behaviours.

**Top findings that shape the plan** (details in §1.3, §3.2, §4):

1. *Isolation:* there is exactly one test user (`dev@local`), one allowed active
   workout, and no reset; the existing 2nd test already leaves state behind (F-1).
2. *Hidden network call:* a fresh test DB still triggers the external catalog
   sync at boot; my earlier config comment claiming otherwise was wrong (F-2).
3. *CI blind spots:* failure artifacts are lost inside `docker run --rm`, and the
   job runs on PRs only while the owner deploys by pushing to `main` (F-3, F-4).
4. *Hevy can't be faked server-side* without a code change (base URL hard-coded);
   the plan uses mocked UI contract tests plus the **local** CSV import path,
   which needs no external call (§4.F).
5. *Accessibility/testability gaps:* form labels not associated, toasts without a
   live region, swipe-delete button `aria-hidden` (§3.2).
6. *Behaviour inconsistencies to decide:* edit-mode numeric input (browser-
   dependent comma handling), exercise removal without confirm, logout wiping an
   unsent offline workout (Q-6, Q-7, Q-8).

**Proposal in one paragraph.** 99 scenarios (P0 17 · P1 67 · P2 15), delivered in
11 milestones: M0 foundation (deterministic config, API-based reset fixture,
seeded catalog, external-host and console guards, CI artifacts), M1 auth+smoke,
M2 core workout loop, M3 routines+catalog, M4 history/measurements/stats, M5
failure states + stubbed Google, M6 Hevy, M7 mobile, M8 PWA/offline (spike
first), M9 accessibility, M10 scale-out. Real backend for anything that
persists data; `page.route` only for failure injection and for Google/Hevy.
Plain helpers instead of Page Objects; no new dependencies; no app changes in
the test work itself (the app changes decided in §9.0 are separate, §8.0).
The realistic target is **P0 + a curated P1 subset**, not all 99.

**Decisions taken (§9.0, all 14 questions answered):** D-1…D-14. They produce
nine **application changes** (AC-1…AC-9, §8.0) in `public/` (+ one server route),
to be done as separate, owner-approved tasks *before* the scenarios that depend
on them; the E2E code itself stays test-only. Notable choices: demo button never
shown without server confirmation (D-1); app opens offline for the last known
user (D-5, the largest change); local-timezone weekly stats (D-9); E2E stays
advisory with `@smoke` on every push to `main` (D-10); a WebKit subset runs
`@smoke` + the core loop (D-12); no `HEVY_BASE_URL` (D-3).

**What this document did not verify:** the Docker/CI path, the
offline-vs-service-worker interaction, and several fixture mechanics are marked
**Spike** or **Unverified** (§10.3).

---

## 1. Audit of the existing Playwright integration

### 1.1 What exists today

| Area | Finding | Evidence |
|---|---|---|
| Playwright version | `@playwright/test` pinned to exactly `1.56.0` (devDependency); lockfile updated; `engines.node >= 18` of 1.56 matches the project's `engines`. `npm audit` was 0 when installed. | `package.json`, `package-lock.json` |
| Script | `npm run test:e2e` → `playwright test`. | `package.json` |
| Config | `playwright.config.js`: `testDir: 'e2e'`, one project (`chromium`, `devices['Desktop Chrome']`), `retries: CI ? 1 : 0`, `forbidOnly` in CI, reporter `list` (+ `html` in CI), `trace: 'on-first-retry'`, `baseURL http://127.0.0.1:${E2E_PORT||3100}`. No explicit `workers`, `fullyParallel`, `timeout`, `expect.timeout`, `locale`, `timezoneId`, `reducedMotion`, `serviceWorkers`, `screenshot`, `video`. | `playwright.config.js` |
| Web server | `webServer.command: node server/index.js`, readiness on `/api/health`, `timeout 60 s`, `reuseExistingServer: !CI`. Env: `NODE_ENV=test`, `PORT`, `DB_PATH=/tmp/fitlog-e2e-<pid>.db`, `ALLOW_DEV_LOGIN=true`, `GOOGLE_CLIENT_ID=''`, `COOKIE_SECURE=false`, `CATALOG_SYNC_DAYS=36500`. | `playwright.config.js`, `server/app.js` (`/api/health`) |
| Specs | One file, two tests: dev login → home; empty workout from the training view. Locators are `[data-*]` attribute selectors. No fixtures, helpers, storage state or teardown. | `e2e/workout-flow.spec.js` |
| Browsers | Chromium only. | config |
| Auth setup | Real UI click on the demo button in every test; no `storageState`. | spec |
| Test data | None. Both tests run against whatever the temp DB contains. | spec |
| Docker | `e2e` stage on `mcr.microsoft.com/playwright:v1.56.0-noble`, `npm ci` (incl. dev deps), copies `server`, `public`, `e2e`, `playwright.config.js`; `CMD npx playwright test`. Not part of the production `runner` image. The Node version bundled in that image is **Unverified**. | `Dockerfile` |
| CI | `ci.yml` job `e2e` on the self-hosted runner: `docker build --network=host --target e2e` then `docker run --rm -e CI=1`. Trigger: `pull_request` and `workflow_dispatch` only. The `test` job (node --test) runs on push/PR. `deploy.yml` gate runs only `npm test`. | `.github/workflows/ci.yml`, `deploy.yml` |
| Execution evidence | Earlier in this session the two specs were run locally (Node 18, Chromium): `2 passed`. The Docker path and the CI job were **not** executed (no runner/Docker here). | session log |

### 1.2 Answers to the required questions

1. **Is the current setup appropriate for FitLog?** Yes as a foundation. A real
   browser against the real Express server + real SQLite is the right shape for
   a build-less vanilla-JS PWA: there is nothing to bundle, so no dev-server
   plumbing is needed. Chromium-only is a reasonable start. Keep Playwright;
   there is no concrete problem that justifies replacing it.
2. **Are tests isolated from production and real user data?** Mostly. The DB is a
   throwaway file under `/tmp`, dev login is enabled only through the
   `webServer.env`, and Google is blank. **Two gaps** (F-1, F-7 below):
   `reuseExistingServer: true` locally can attach to *any* process already
   listening on port 3100, and a fresh DB triggers an external catalog fetch.
3. **Can tests run reliably locally and in CI?** Locally yes (verified). In CI it
   is **unverified**, and the job as designed cannot hand back failure evidence
   (F-3) and may rarely run for this repository's workflow (F-4).
4. **Is the app started automatically?** Yes, via `webServer`.
5. **Are test accounts and data managed safely?** Accounts: yes, but there is
   exactly **one** account (`dev@local`, "Atleta Demo", `ensureDevUser` in
   `server/auth.js`) and the server allows **one active workout per user**
   (`409 Ya tienes un entrenamiento en curso`, `server/routes/workouts.js:46`).
   Data: nothing is created, reset or cleaned (F-1).
6. **Unnecessary dependencies/config?** None. Nothing to remove.
7. **What to reuse?** Everything: config, `webServer` boot, dev-login mechanism,
   `[data-*]` locator convention, the `e2e` Docker stage and CI job. The plan
   below only *adds* fixtures and tightens configuration.

### 1.3 Findings that change the plan

| ID | Finding | Evidence | Impact | Proposed handling (milestone) |
|---|---|---|---|---|
| F-1 | **Shared single user + shared DB, no reset.** The second existing test leaves an *active workout* behind (it never discards). A third test that expects "no active workout" (e.g. `Empezar a entrenar` banner on home) would fail or, worse, pass for the wrong reason (the 409 path navigates to the active screen, masking it). Custom exercises cannot be removed: `server/routes/exercises.js` has no `DELETE` route (only `POST /custom`, `/from-catalog`, sync). | `e2e/workout-flow.spec.js`; `public/js/api.js`; `server/routes/workouts.js:46` | Order-dependent tests, impossible empty-state tests, no parallelism. | M0: API-based reset fixture (`workouts`, `routines`, `measurements`) run before each test; unique names for custom exercises; `workers: 1` until per-worker server+DB exists (M10). |
| F-2 | **Catalog sync still runs on a fresh DB.** `getCatalogStatus().stale` is `!lastSync \|\| …`, so an empty DB is always stale, and `server/index.js` force-syncs when `count === 0 \|\| stale`. `CATALOG_SYNC_DAYS=36500` does **not** prevent the first fetch (`server/catalog.js:131` does a `fetch()` of the pinned dataset). The comment I wrote in `playwright.config.js` claiming otherwise is **inaccurate**. | `server/index.js`, `server/catalog.js:302-316`, `playwright.config.js` | Hidden external network call during E2E boot; non-deterministic catalog contents (empty until the fetch finishes, or forever if offline/blocked). | M0: seed a small fixed catalog *before* the server starts, using the production code path `syncCatalog({ force: true, dataset })` (it already accepts an injected dataset) from a tiny pre-boot script chained in `webServer.command`; this also sets `catalog_last_sync`. **Spike:** confirm dataset shape against `test/catalog.test.js`. Also correct the config comment. |
| F-3 | **Failure evidence is lost in CI.** `docker run --rm` runs Playwright *inside* the container; `playwright-report/` and `test-results/` (traces) die with it. No `upload-artifact`. | `ci.yml` job `e2e` | A red CI run is undiagnosable. | M0: bind-mount (or `docker cp`) the two output dirs to the workspace and upload as artifacts. Run with `--user "$(id -u):$(id -g)"` like the other jobs to avoid root-owned files on the self-hosted runner (same EACCES risk the `test` job comments describe). |
| F-4 | **PR-only trigger vs. the owner's workflow.** The README/deploy docs describe push-to-`main` → deploy; the `e2e` job runs only on `pull_request` + manual dispatch. If the owner pushes directly to `main`, E2E never runs automatically. | `ci.yml`, `deploy.yml`, README | False sense of coverage. | M0/M10: decide trigger (see §7.2); at minimum run `@smoke` on push to `main`. |
| F-5 | **Service worker is left on.** Playwright's default is `serviceWorkers: 'allow'`; the app registers `/sw.js` on `load`. A controlling SW can make `page.route()` mocks unreliable and adds caching state between tests in the same context. | `public/js/app.js` (register on `load`), `public/sw.js` | Flaky mocks; hidden cross-test coupling. | M0: default `serviceWorkers: 'block'`; enable only in the PWA project (§4.I). |
| F-6 | **Environment not pinned.** No `locale`, `timezoneId`, `reducedMotion`, fixed clock. The UI uses `Date`, `Intl('es-ES')`, local-timezone date inputs (`formatDateInput`), "Hoy/Ayer" labels, 1 s / 30 s timers, CSS animations. | `public/js/ui.js`, `views/home.js` (`greeting`), `public/css/*.css` (`prefers-reduced-motion` honoured) | Date/time-dependent and animation-dependent flakiness. | M0: `locale: 'es-ES'`, `timezoneId: 'Europe/Madrid'`, `reducedMotion: 'reduce'` (the CSS already honours it), `page.clock` where time matters. |
| F-7 | **`reuseExistingServer: !CI` can hit a non-test server.** If something (e.g. `npm run dev` with `PORT=3100` and `ALLOW_DEV_LOGIN=true`) is already on 3100, tests would run against it — including writes. | `playwright.config.js` | Potential writes to a real dev/prod-like DB. | M0: `reuseExistingServer: false` (or a distinctive, documented test port). |
| F-8 | **DB file not cleaned.** `/tmp/fitlog-e2e-<pid>.db` (+ `-wal`/`-shm`) remains after each run. | `playwright.config.js`; observed during session | Disk litter only. | M0: remove in a global teardown or use `os.tmpdir()` + unique dir. Low priority. |
| F-9 | **Login duplicated per test; no shared helpers.** | spec | Maintenance cost as the suite grows. | M0/M1: `login` fixture + `storageState` project dependency or per-test API login. |
| F-10 | **Docker `e2e` stage runs on a base image whose bundled Node is Unverified**, and was never built here. | `Dockerfile` | Possible mismatch with `engines`. | M0 spike: `docker run … node -v`. Not a blocker: 1.56 supports Node ≥ 18. |

---

## 2. Frontend architecture & user-journey analysis

### 2.1 Shape of the app

* **No build step.** `public/index.html` loads `/js/app.js` as an ES module;
  everything else is statically imported (`public/js/app.js:1-17`). Root nodes:
  `#app` (`aria-live="polite"`) and `#overlays` (dialogs are appended here).
* **Router (hash-based)** in `app.js`: `routes[]` + `handleRoute()`.

| Route name | Hash path | View | Needs auth |
|---|---|---|---|
| login | `#/login` | `views/login.js` | no |
| home | `#/` | `views/home.js` | yes |
| routines | `#/routines` | `views/training.js` ("Entrenamiento") | yes |
| routine-new | `#/routines/new` | `views/routine-editor.js` | yes |
| routine-edit | `#/routines/:id/edit` | `views/routine-editor.js` | yes |
| routine | `#/routines/:id` | `views/routine.js` | yes |
| active | `#/workout/active` | `views/active.js` | yes |
| history | `#/workouts` | `views/history.js` | yes |
| workout | `#/workouts/:id` | `views/workout.js` | yes |
| exercises | `#/exercises` | `views/exercises.js` | yes |
| measurements | `#/measurements` | `views/measurements.js` | yes |
| profile | `#/profile` | `views/profile.js` | yes |

* **Guards (`handleRoute`)**: unknown path → `#/`; no user and not login →
  `#/login`; user and login → `#/`. A 401 anywhere calls `handleUnauthorized`
  (user cleared → `#/login`). Stale async renders are discarded via
  `state.version`.
* **Boot (`boot()`)**: `GET /api/auth/config` (fallback
  `{googleEnabled:false, devLoginEnabled:true}` on failure — note: the fallback
  *enables* the demo button when config cannot be fetched), `GET /api/auth/me`;
  status `0` (network) with no user → `offlineScreen` with `[data-reboot]`
  instead of the login screen; else `loadActiveState()`, `handleRoute()`, then
  `syncFinishedOffline` on boot and on `window 'online'`.
* **API client (`public/js/api.js`)**: `fetch('/api…', {credentials:'same-origin'})`;
  a thrown `fetch` becomes `Error{status:0}` ("offline" convention used across
  all views); non-2xx becomes `Error{status, data}`; `errorMessage()` maps
  401/0/other to Spanish strings.
* **Shared UI (`public/js/ui.js`)**: `toast()` (`.toast.success|error|default`, 2.6 s,
  no live region), `openModal`/`openActionSheet`/`confirmDialog` built on native
  `<dialog>` + `showModal()`; `loaderScreen`, `errorScreen`, `offlineScreen`,
  `connectionNeeded`, `setLoading` (spinner + `disabled`).
* **`loadView` (`view-helpers.js`)** centralises the initial-load outcomes:
  401 → login; status 0 → `{offline:true}` (view renders an inline "Sin conexión"
  block); other error → "No se pudo cargar" + `Reintentar` (`[data-retry]`).
* **Client storage**: `localStorage` keys `fit-folders-collapsed`,
  `fit-rest-timer` (+ theme); IndexedDB (`public/js/offline/*`) holds the active
  workout snapshot per user, a catalog cache and a routines cache. `logout()`
  calls `clearOfflineData()` (wipes the active-workout and catalog stores).
* **Service worker (`public/sw.js`, `fitlog-v31`)**: precaches the full shell,
  network-first navigations (fallback to cached `/index.html`), stale-while-
  revalidate static assets, **never** caches `/api/`, `skipWaiting` +
  `clients.claim`; the page reloads once on `controllerchange` only when
  replacing an existing controller.

### 2.2 Journeys (traced through code, not README)

1. **Sign in** — login screen → `Entrar en modo demo` (`[data-dev-login]`) →
   `POST /api/auth/dev` → toast `Hola, <name>` → home. Google path: GIS script
   injected from `accounts.google.com`; credential → `POST /api/auth/google`.
2. **Log a workout (the core loop)** — `Entrenar` → `Empezar Entrenamiento Vacío`
   (`[data-start-empty]`) → `POST /api/workouts` (409 → go to active) →
   active screen → `Añadir ejercicio` (picker sheet: search, tabs
   *Catálogo*/*Mis ejercicios*, muscle-group sheet) → `Agregar Serie` → type
   kg / reps (500 ms debounced write per set) → check button (flushes
   immediately, starts the rest timer) → `Terminar` (confirm if 0 completed
   sets) → `POST …/finish` → toast `¡Entrenamiento guardado!` → `#/workouts/:id`.
   `Descartar entrenamiento` → danger confirm → home. On the active screen the
   exercise name/image (`[data-exercise-detail]`) opens the same read-only
   exercise detail modal (Resumen / Historial / Indicaciones), separate from the
   ⋯ exercise menu.
3. **Routines** — `Nueva Rutina` → editor (name, folder, description, add
   exercises via picker, targets, reorder/remove) → `Guardar` → routine detail;
   from the list: `Empezar Rutina`, ⋯ menu (Empezar / Ver / Editar / Duplicar /
   Eliminar-with-confirm); folders collapse state persisted in `localStorage`.
4. **History & detail** — `#/workouts` grouped by month, `Cargar más` (page 20);
   detail shows summary + exercises; ⋯ menu: *Editar entrenamiento*
   (edit mode → *Terminar edición*, set/exercise delete), *Ver rutina*,
   *Eliminar entrenamiento* (confirm). Hevy-imported workouts are read-only.
   Tapping an exercise's name/image (`[data-exercise-detail]`) opens the
   read-only **exercise detail** modal with tabs *Resumen* / *Historial* /
   *Indicaciones* (`public/js/exercise-detail.js`); the old "Ver progresión"
   link is gone, the whole head is the handle now.
5. **Catalog browse** — `#/exercises`: search (280 ms debounce), category chips,
   infinite scroll (`IntersectionObserver`, page 40), detail modal →
   `Añadir a mis ejercicios`.
6. **Measurements** — `#/measurements`: form (date, peso, grasa, cintura, nota),
   upsert by date, edit by clicking a row, delete with confirm, weight line chart
   (needs ≥ 2 weights).
7. **Profile/stats** — stats grid, bar chart with metric switch, links to other
   views, theme toggle, `Cerrar sesión` (confirm).
8. **Hevy** — *Importar de Hevy* modal (CSV file or API key; preview = dry run,
   then import), *Sincronización con Hevy* card (connect with API key, auto-sync
   and webhook toggles, `Sincronizar ahora`, `Desconectar`), *Eliminar datos
   importados* (confirm).
9. **Offline** — implemented (not hypothetical): start an empty workout or a
   cached routine offline, build it from the cached catalog / "Mis ejercicios",
   edit sets, finish offline (kept locally as `finishedOffline`), auto-upload via
   `POST /api/workouts/sync` on next boot / `online` event. Several features
   explicitly degrade offline (see §4.I).

### 2.3 Dependencies and state transitions that matter

* `ctx.activeWorkout` drives the home/training **banner vs. quick-start** and the
  nav dot; it is set by `refreshActive()` and by the active view.
* Only **one active workout per user** is allowed by the server; the UI relies on
  the 409 → navigate-to-active fallback.
* A local (offline) workout uses non-numeric ids (`local-…`); code deliberately
  avoids `Number()` on them (comments in `active.js`).
* The active view mirrors `repo.current`; online/offline decision is per
  mutation inside `createActiveWorkoutRepo`.
* `logout()` clears IndexedDB **including a finished-but-not-yet-uploaded
  workout** (`clearAll` clears the whole active-workout store) — see Q-7.

### 2.4 Regression-prone areas (ranked by likelihood × impact)

1. Set write scheduling (`pending-writes.js`): debounce vs. immediate flush on
   toggle, flush on navigation / `pagehide` / `visibilitychange`; `onSettled`
   save indicator (recently fixed → regression magnet).
2. Offline repo/sync: idempotent `/sync`, local-id handling, reconnect behaviour.
3. Shell/SW cache invalidation (`CACHE_VERSION` / `SHELL_HASH`): the repo
   already unit-tests the hash; the *runtime* update path is untested.
4. Route guards & 401 handling (silent bounce to login).
5. Numeric input parsing (`parseDecimalInput`: comma/point, invalid → flagged,
   negatives clamped).
6. Pagination and infinite scroll (offset handling was fixed recently).
7. Date handling (local-tz date input vs UTC week buckets).
8. Hevy UI state machines (busy/disabled, error vs. warning lines, rollback of
   toggles).
9. `loadView` migration (just refactored across four views).

---

## 3. Selector / accessible-handle inventory

### 3.1 What exists

* **No `data-testid` anywhere** in `public/js` (grep). The app's own
  convention is semantic `data-*` hooks used for event delegation
  (`[data-start-empty]`, `[data-add-exercise]`, `[data-add-set]`, `[data-toggle]`,
  `[data-finish]`, `[data-discard]`, `[data-field="weightKg|reps"]`,
  `[data-set-id]`, `[data-we-id]`, `[data-save]`, `[data-retry]`, `[data-link]`,
  `[data-sync-*]`, `[data-tab]`, `[data-pick]`, `[data-exercise-detail]` (opens
  the exercise detail modal; carries the exercises-table id, with
  `[data-exercise-name]` for the title) …). These are stable because
  production code depends on them.
* **Accessible names present**: icon-only buttons have `aria-label`
  (`Cerrar`, `Volver`, `Opciones`, `Terminar entrenamiento`, `Minimizar`,
  `Temporizador de descanso`, `Saltar descanso`, `Completar serie`,
  `Eliminar serie N`, `Opciones del ejercicio`, `Opciones de rutina`,
  `Nueva rutina`, `Editar medida`, `Eliminar medida`, `Cambiar tema`, `Perfil`);
  set inputs have `aria-label="Peso en kg"` / `"Repeticiones"`; the bottom nav
  is `<nav aria-label="Navegación principal">` with labelled links; charts are
  `role="img" aria-label="Gráfico de progreso"`; the rest timer is
  `role="status"`; headings (`h1`/`h3`) exist per screen; text buttons have
  visible Spanish labels (e.g. `Empezar Entrenamiento Vacío`, `Agregar Serie`).
* **Native `<dialog>`** for modals/sheets/confirms (focus trapping and Escape
  come from the platform; `cancel` is wired to close).

### 3.2 Gaps (affect testability *and* accessibility)

| Gap | Evidence | Consequence for tests |
|---|---|---|
| Form `<label>` elements are **not associated** with inputs (no `for`, no wrapping) in measurements and routine editor. | `views/measurements.js` (`<label>Fecha</label><input …>`), `routine-editor.js`; grep finds no `<label for=`. | `getByLabel('Peso (kg)')` will **not** work; use `[data-field]` / `[data-input]`. Also an a11y defect (A11Y-003). |
| Toasts have no live region/role. | `ui.js toast()` appends to a bare `div.toast-stack` in `body`; `#app`'s `aria-live` does not contain it. | Toasts must be asserted by text (`.toast` + text); screen-reader announcement is untested/unsupported (A11Y-004). |
| Picker search input has only a placeholder. | `exercise-picker.js` | Use `getByPlaceholder('Buscar ejercicio...')`. |
| Active nav item is only a CSS class (`.active`), no `aria-current`. | `app.js navItem` | Assert via class or add `aria-current` later (optional). |
| The per-set delete button sits in an `aria-hidden` background layer under the row and is revealed by a swipe. | `views/active.js setRow`, `swipe.js` | Not clickable by normal user-style actions on desktop; needs a pointer-drag/touch gesture (MOB-004, Spike). |
| `[data-pick]` carries JSON in the attribute; list items have no per-item accessible name beyond text. | `exercise-picker.js` | Locate by visible exercise name inside the sheet. |

### 3.3 Locator policy (recommended)

1. **Role/label/text first** where the accessible name is meaningful and stable:
   `getByRole('button', {name: 'Terminar entrenamiento'})`, `getByLabel('Peso en kg')`,
   `getByRole('navigation', {name: 'Navegación principal'})`,
   `getByRole('dialog')`, `getByRole('heading', …)`, `getByPlaceholder(…)`.
2. **Existing `data-*` hooks second**, scoped by container (e.g. within
   `[data-set-id="…"]`, `[data-we-id]`). They are production contract, not test
   scaffolding.
3. **Do not add `data-testid` now.** Any edit under `public/` is a shell change
   (requires PRECACHE check, `SHELL_HASH` recompute and `CACHE_VERSION` bump per
   `AGENTS.md`). Revisit only if a scenario is otherwise unlocatable.
4. **No CSS-class or positional selectors** except where the class *is* the
   observable state (`input-error`, `.toast.success|error`, `.completed`), and
   then prefer an assertion that also checks visible behaviour.

---

## 4. Testing strategy

### 4.0 Cross-cutting principles

#### 4.0.1 Test pyramid for this repository

| Layer | What it proves | Tooling | Share of effort |
|---|---|---|---|
| Unit / integration (existing) | Server logic, SQL, policies, Hevy client/import/sync, auth policy, PWA shell hash | `node --test` + supertest (185 tests) | Already large — **do not duplicate** in the browser |
| **E2E, real backend** | Browser ↔ server ↔ SQLite wiring, routing, cookies/session, the core loops | Playwright, real `server/index.js`, temp DB | The backbone: ~60 % of E2E scenarios |
| **E2E, mocked API (`page.route`)** | Frontend state machines for states the real backend cannot produce on demand (500s, slow responses, Hevy errors, Google, 401 mid-session) | Playwright routing | ~30 % |
| Offline / PWA (context offline + SW) | Behaviour only a browser can show | Playwright, SW enabled | ~10 %, few but valuable |
| Visual / a11y | Layout overflow, dialog semantics | Playwright assertions (no new libs initially) | Small, P2 |

Rule of thumb: **use the real backend for anything that mutates and persists
data** (workouts, sets, routines, measurements) — mocking those would hide the
exact integration bugs E2E exists to find. **Use mocks for failure injection and
for external systems** (Google, Hevy) and for exact error copy.

#### 4.0.2 Determinism checklist (with the lever for each)

| Source of flakiness | Where it comes from | Control |
|---|---|---|
| Async render / navigation | hash router, `loaderScreen`, per-view fetches | Web-first assertions only (`expect(locator).toBeVisible()/toHaveText()`), auto-wait; never `waitForTimeout`. Wait on **observable outcomes** (a heading, the `[data-save-state]` becoming hidden, a response via `waitForResponse`). |
| 500 ms set-write debounce, 280 ms search debounce | `pending-writes.js`, `exercise-picker.js`, `exercises.js` | Assert the *settled outcome* (`[data-save-state]` hidden; list updated). For "edit then immediately navigate/reload" scenarios assert persistence **after** the flush, via `waitForResponse(PATCH …/sets/*)`. Optionally `page.clock` to fast-forward debounce in P2 tests. |
| Timers (1 s workout clock, 30 s banner, rest countdown) | `active.js`, `home.js`, `training.js` | `page.clock.install()` + `fastForward()` for rest-timer and elapsed-time scenarios; otherwise do not assert exact elapsed strings. |
| "Hoy/Ayer" labels, week buckets, greeting | `Date.now()`, `formatDate`, `greeting()` | `page.clock.setFixedTime('2026-03-04T10:00:00')`-style fixed time for any scenario asserting date text; otherwise assert structure not text. Workouts seeded via `POST /api/workouts/sync` carry explicit timestamps. |
| Timezone | `formatDateInput` uses local offset; server buckets in UTC | `use.timezoneId: 'Europe/Madrid'` + `locale: 'es-ES'` globally; one P2 scenario with a second tz (MEA-009). |
| CSS animations/transitions | `view-in`, `stagger`, folder collapse, toasts | `use.reducedMotion: 'reduce'` — the stylesheets honour `prefers-reduced-motion` (`base.css`, `views.css`), and `haptic()` also no-ops. No app change needed. |
| Toast auto-dismiss (2.6 s) | `ui.js toast` | Assert as soon as the triggering action resolves; never a later "toast gone" without clock control. |
| Infinite scroll | `IntersectionObserver` in `exercises.js` | Scroll the sentinel into view (`scrollIntoViewIfNeeded`) and assert the count increases; seed ≥ 41 matching rows. |
| Generated ids | `createLocalWorkout` (`local-…`) | Never assert ids; assert text/counts. |
| Shared state | single user, single DB (F-1) | Reset fixture (§6.3); unique names; serial execution until per-worker server (M10). |
| External services | Google GIS script, Hevy API, catalog dataset fetch (F-2) | Stub/seed as in §4.A, §4.F, §4.D. Fail the run if an un-mocked external host is hit (§6.4). |
| Service worker | registered on `load` | `serviceWorkers: 'block'` by default (F-5). |

#### 4.0.3 Isolation & data model

* **Account**: only `dev@local` exists via `POST /api/auth/dev` (a Google
  account cannot be minted offline). Tests share it, therefore they must be
  **serial and self-resetting** (§6.3).
* **Reset via the real API** with the browser context's cookies
  (`context.request`): discard the active workout (`DELETE /api/workouts/:id`
  or the discard endpoint used by `repo.discard()`), delete workouts, routines
  and measurements listed by their `GET`s. **Spike:** confirm the exact endpoints
  and whether a bulk "reset" is worth adding server-side — adding a test-only
  reset endpoint would be production code and is **not** recommended; the
  public API is enough.
* **Seeding** also through the public API: custom exercises
  (`POST /api/exercises/custom`), routines (`POST /api/routines`), finished
  historical workouts with explicit dates (`POST /api/workouts/sync`,
  idempotent by client id), measurements (`POST /api/measurements`). Custom
  exercises cannot be deleted, so use a unique suffix per run and assert by that
  name.
* **Catalog**: seed a small fixed dataset before the server starts (F-2) so the
  picker/browse scenarios are deterministic and offline-safe. Scenarios that
  only need *an* exercise should prefer a **custom exercise** (no catalog
  dependency at all).
* **Never** point tests at a shared or production server; the `webServer` DB
  lives under a unique temp path and the port is dedicated.

#### 4.0.4 Mocking policy

| Use `page.route()` mock when… | Use the real backend when… |
|---|---|
| Injecting 401/403/404/500/timeouts or slow responses | The scenario creates, edits or deletes user data |
| Google (`/api/auth/config`, `/api/auth/google`, the GIS script) | Login via `POST /api/auth/dev` |
| Hevy endpoints (`/api/import/hevy/**`) — see §4.F | Anything whose correctness is a server business rule already covered by `node --test` is *not* re-tested; the E2E only asserts the UI reflects it |
| Disabling dev login to see the "acceso no configurado" notice | Navigation / guards / session cookie behaviour |

Trade-off: mocks make the failure UI deterministic but can drift from the real
contract. Mitigation: mock responses are built from **recorded real responses**
(captured once from the real API via the same fixture) and every mocked flow
that has a real-backend sibling (e.g. NAV-006 vs NAV-002) keeps both.

#### 4.0.5 Accessibility approach (no new libraries initially)

* Prefer role/label locators (§3.3): that is itself an accessibility check
  (a control that cannot be found by role/name is a finding).
* Use built-in `expect(locator).toMatchAriaSnapshot()` (available in Playwright
  ≥ 1.49, so in 1.56) for 3-4 stable regions (bottom nav, a confirm dialog, the
  login panel).
* Keyboard & focus: Tab/Enter/Escape on dialogs and the set row; assert focus
  lands inside an opened `<dialog>` and returns after Escape.
* `@axe-core/playwright`: **not recommended now.** It is a new devDependency
  (pinning, `npm audit`, transitive `engines` review per `AGENTS.md`) and would
  report pre-existing structural issues (unassociated labels, no live region for
  toasts) that need product decisions before they can be a green gate. Revisit
  after the A11Y findings in §4.H/§5 are triaged (milestone M9, optional).

---

### 4.A Authentication and session management

**Current behaviour (code).** `login.js` renders the Google slot only when
`config.googleEnabled && config.googleClientId`; the demo button only when
`config.devLoginEnabled`; neither → a danger notice
"El acceso no está configurado…". `POST /api/auth/dev` returns 404 unless
`ALLOW_DEV_LOGIN` is exactly `true`. `POST /api/auth/google` verifies the ID
token with `google-auth-library` (`verifyGoogleCredential`, constructs a real
`OAuth2Client` — **no injection point**) and applies `isGoogleUserAllowed`.
Sessions are cookie-based; `GET /api/auth/me` is the session probe; 401 anywhere
→ login.

**Strategy.**

1. **Default login for all non-auth specs = dev login through the API**
   (`context.request.post('/api/auth/dev')`), reusing the cookie in the page
   context — faster and removes UI coupling. Keep **one** spec that logs in
   through the real button (AUTH-002).
2. **Google must never be real.** Two safe layers, neither weakens production
   auth:
   * *Server policy* (allowlist, unverified e-mail, revoked users) is already
     covered by `test/access-control*.test.js` and `access-revocation.test.js`
     — do not re-test it in the browser.
   * *Frontend behaviour* is tested with stubs: (a) `page.route` returns
     `{googleEnabled:true, googleClientId:'e2e-client', devLoginEnabled:true}` for
     `/api/auth/config`; (b) `page.route('https://accounts.google.com/gsi/client')`
     fulfils a tiny script defining `window.google.accounts.id.{initialize,renderButton}`
     that calls the stored `callback({credential:'fake'})` when the stub button is
     clicked; (c) `page.route('**/api/auth/google')` either returns 403/401 JSON
     (failure cases) or — for the success case — performs
     `context.request.post('/api/auth/dev')` (which sets a genuine session cookie
     in the shared cookie jar) and fulfils with that JSON. Result: the success
     path lands in a **real authenticated session** without any Google account,
     and nothing in `server/` changes.
3. **Expired/invalid session**: with a real session, `context.clearCookies()` and
   trigger any API-backed navigation → expect redirect to login (real backend,
   no mock needed).
4. **"Dev login disabled" UI**: mock `/api/auth/config`; the **server-side** 404
   for `/api/auth/dev` when disabled is a server rule (integration test) — a
   second `webServer` with `ALLOW_DEV_LOGIN=false` is possible but not worth its
   cost for one assertion (record as optional AUTH-012).
5. **Cross-context**: two `browser.newContext()` instances = two cookie jars.
   Because both would be the same `dev@local` user, this checks *session*
   independence (logging out in A leaves B logged in), not data isolation.

**Gaps / risks to record.** `boot()` falls back to `devLoginEnabled: true` when
`/api/auth/config` fails (the demo button appears even if the server would reject
it); resolved by D-1 (AC-1). `clearAll()` on logout also wipes a
finished-offline workout that has not been uploaded; resolved by D-7 (AC-5).

### 4.B Navigation and application initialization

* **Route sweep smoke (NAV-001)**: after login, visit every top-level hash route
  and assert each renders its own landmark (heading/topbar) and that **no
  `pageerror` or `console.error`** occurred. This single test catches broken
  imports in the static module graph (very likely failure for a build-less app)
  and is the cheapest high-value test in the suite. Make console errors fail the
  test through a fixture, with an allowlist for known benign messages.
* **Guards**: unauthenticated deep link → login; authenticated visit to
  `#/login` → home; unknown hash → home.
* **History navigation**: back/forward across *routines → routine detail → back*
  and across the editor `Cancelar`.
* **Reload**: reload on `#/workout/active`, `#/workouts/:id`, `#/exercises`
  keeps the route and renders (hash routing means the server always serves
  `index.html`).
* **Loading / error / empty states**: use `page.route` with a delayed fulfil to
  observe `Cargando…`; 500 on `/api/stats/overview` etc. to observe
  `No se pudo cargar` + `Reintentar`, then **unroute** and click retry to prove
  recovery.
* **Invalid state**: `#/workouts/999999` → "No se pudo cargar el entrenamiento"
  + `Volver` (verified in `workout.js`); `#/workout/active` with no active
  workout → "No hay entrenamiento activo" + link.

### 4.C Workout management

**Implemented (testable now).** Start empty / from routine; add exercise
(catalog, own); add/delete set; edit kg/reps with decimal comma/point; check
set; previous-set suggestion (`[data-prev-fill]`) and prefill; completing a set
with empty kg/reps **auto-fills** them from the previous session (per field; a
typed value, including `0`, is kept); the live
**record trophy** badge (`[data-record]`, `Récord personal`) that appears on a
completed set once it beats the exercise's previous best (weight or estimated
1RM) and hides otherwise; rest timer
(toggle, skip, +15 s); reorder, replace, superset create/remove (server-only);
remove exercise (no confirm); finish (confirm when 0 completed sets); discard
(danger confirm); history with month grouping and pagination; workout detail
with the read-only **exercise detail** modal (tabs *Resumen* with the
progression chart + personal records, *Historial* with every logged session and
its sets, *Indicaciones* with the catalog muscles/equipment/steps when the
exercise is catalog-linked), opened by tapping the exercise name/image
(`[data-exercise-detail]`) on both the finished-workout detail and the active
screen; **edit finished workout** (⋯ → *Editar
entrenamiento*, set/exercise delete, *Terminar edición*) and **delete workout**
(confirm); Hevy-imported workouts read-only.

**Finished-workout edit mode (verified in `workout.js renderEdit`).** Name,
location and notes are editable (`[data-input]`, persisted on `change`/blur via
`PATCH /api/workouts/:id`); set weight/reps persist on `change`; the check button
toggles completion; sets and exercises can be deleted. **Behaviour difference to
record (Q-8):** edit mode renders weight/reps as `<input type="number">` and reads
`Number(field.value)` on `change`; the active screen uses a text input plus
`parseDecimalInput` (accepts comma or point, flags invalid input without saving).
What the user's comma becomes in edit mode is therefore decided by the
**browser**, not by app code. Measured in headless Chromium (Playwright,
`locale` es-ES and en-US, keyboard typing): `72,5` → `725` (the comma is
dropped, i.e. a silent 10× value), `72.5` → `72.5`, `5kg` → `5`, `abc` → empty
(→ `null`), `-3` → `-3` (the code then clamps it to `0`). Real phone browsers
(iOS Safari, Android Chrome with a Spanish keyboard) were **not** measured and
may treat the comma differently. **Decided (D-8):** edit mode adopts the active
screen's rules (text input + `parseDecimalInput`, app change AC-6); WRK-016
tests exactly that once AC-6 exists.

**Not implemented in the UI (do not test; future coverage).** Renaming or
adding notes from the *active* screen (its title is static text), adding an
exercise to a *finished* workout (no such control in the edit view as read),
and a confirmation before `Eliminar Ejercicio` on the active screen (it deletes
immediately — Q-6, a behaviour to pin down, not a missing feature).

**Strategy.**

* The core loop (WRK-002) is the single most valuable E2E: real backend,
  custom exercise (no catalog dependency), one set, kg/reps, complete, finish,
  then assert **three** observable places agree: the detail page totals, the
  history card and the home recent list.
* Persistence of edits (WRK-003): type reps, wait for the PATCH response (or
  `[data-save-state]` hidden), `reload`, assert value restored. A variant types
  and navigates away immediately to cover the "flush on leave" path.
* Gesture-dependent behaviour (swipe-to-delete a set): implement under the
  mobile project with `hasTouch` and pointer-event dragging (**Spike**, MOB-004);
  do **not** click the `aria-hidden` button with `force`/`dispatchEvent`, which
  would test something no user can do.
* Rest timer: `page.clock` so the 90 s countdown is controllable; assert
  `role=status` text changes, skip hides it, preference persists in
  `localStorage`.
* Validation: non-numeric weight (`5kg`) → field flagged and not persisted
  (assert after reload); negative → clamped to `0`; reps rounded to integer.
* Failure injection (mocked): `PATCH …/sets/*` → 500 shows `Reintentando guardar…` (`[data-save-state]`) while the write is retried
  and shows the error toast; `POST …/finish` → 500 leaves the user on the active
  screen with the button restored.
* Record trophy (WRK-023): the active screen flags a record from
  `exercise.previousBests`, so a brand-new custom exercise never shows one on its
  first session — seed a finished workout first (`hist`), then in a new workout
  log one set below that best and one above it. Assert the trophy
  (`[data-record]`) is **visible** on the set that beats the best and **hidden**
  (not merely absent) on the other, and that unchecking the record set hides it.
  Assert visibility with `toBeVisible`/`toBeHidden` rather than the attribute, so
  it guards the CSS regression where a `display` rule on `.set-record` beat the
  `hidden` attribute and the trophy never hid. **When this scenario is
  implemented, delete `test/active-e1rm-parity.test.js`**: that unit test is a
  stopgap that pins the view's reimplemented `epley1rm` to the server's copy; the
  stronger, less fragile guarantee is this end-to-end check, which exercises the
  real record-flagging path in the browser.
* Auto-fill on completion (WRK-024): needs the same seeded history as the
  trophy (`previousSets` come from the last finished workout). Check the set
  with both fields empty and assert both inputs now show the previous values;
  type only one field and assert the other is filled and the typed one is kept;
  type `0` and assert it stays `0`. Because the filled values feed the record
  check, a set auto-filled above the previous best also shows the trophy and
  the `¡Récord batido!` toast (assert once, here or in WRK-023). Assert
  persistence by reloading, not by reading the inputs alone.

### 4.D Exercise catalog

* **Two surfaces**: the *Explore* view (`#/exercises`, online only) and the
  *picker* sheet (used by active workout and routine editor, works offline from
  IndexedDB).
* Real backend with a **seeded catalog** (F-2) for: listing + category chips,
  search (debounced), no-results state, category filter, detail modal,
  `Añadir a mis ejercicios` → appears in picker tab *Mis ejercicios*, infinite
  scroll (needs ≥ 41 matching rows; seed 45 synthetic rows in a dedicated
  category).
* Mocked for: 500 on `/api/exercises/search` (inline danger notice), empty
  `categories` (chips degrade to just "Todos").
* Invalid/missing exercise data: a detail request for a catalog id that does not
  exist → inline notice in the modal (mock 404).
* Do not assert exercise images (loaded from external CDN via the app's own
  `/api/exercises/image/…` proxy, which fetches upstream); the seeded rows
  should have no image so the placeholder icon is used. Block image requests to
  external hosts (§6.4).

### 4.E Routines and templates

* Real backend end-to-end: create (name + ≥ 1 exercise via picker with *Mis
  ejercicios*) → lands on routine detail → listed under *Mis rutinas* or its
  folder → edit (rename, change targets, reorder, remove) → duplicate → delete
  (confirm) → start from routine (active screen shows its exercises/target
  sets).
* Validation (no server call): empty name → toast `Ponle un nombre a la rutina`;
  no exercises → `Añade al menos un ejercicio`.
* Dirty-state guard: edit, press back/`Cancelar` → confirm dialog
  (`Seguir editando` / `Descartar`).
* Hevy-sourced routines: editor shows "Rutina de solo lectura" (needs a routine
  with `source='hevy'`; created by the Hevy flows or an import fixture — see §4.F).
* Empty states: "Aún no tienes rutinas" with the primary action; routine with 0
  exercises shows "Sin ejercicios todavía".
* Folder collapse persistence in `localStorage` (`fit-folders-collapsed`):
  collapse, reload, still collapsed — P2.

### 4.F Hevy integration

**What the frontend does.** `profile.js` calls `api.hevySync.*` and
`api.import.*`; the **server** talks to `api.hevyapp.com`. The Hevy base URL is
**not configurable** at runtime (`DEFAULT_BASE_URL` in `server/hevy-client.js`;
`server/routes/import.js:138` and `server/hevy-sync.js:30` construct the client
without a `baseUrl` option; `fetchImpl`/`baseUrl` can be injected only
in-process, which is how `test/hevy-*.test.js` do it). Consequence: a real
`webServer` **cannot be pointed at a fake Hevy** without a production code
change, and `page.route()` cannot intercept server-to-server traffic.

**Therefore two tiers:**

1. **Tier 1 — frontend UI contract (recommended, no app change).**
   `page.route('**/api/import/hevy/**')` fulfils with recorded-shape JSON for:
   disconnected, connected (with/without `lastError`/`lastWarning`), connect
   success/failure (401 invalid key, 429, network), `Sincronizar ahora`
   success with and without changes ("Ya estabas al día"), webhook unavailable
   (`webhookAvailable:false` hint), toggle failure rollback
   (`auto.checked = !auto.checked`), CSV preview vs import totals, duplicate
   summary row, flush confirm. This validates exactly what the browser owns:
   rendering, disabled-while-busy (`setBusy` disables **all** buttons — the
   duplicate-action guard), toasts, and `ctx.refresh()` after changes.
2. **Tier 2 — real server data path (optional, needs a decision).** The CSV
   import path (`POST /api/import/hevy/csv`) is **entirely local** (no Hevy
   network call): upload a small fixture CSV through the real modal and assert
   imported workouts/routines appear in history, that re-importing reports
   duplicates and creates none, and that *Eliminar datos importados* removes
   them. This gives real end-to-end coverage of the Hevy feature **without any
   external call**. The API-key/sync paths stay Tier 1 unless the owner approves
   a small, env-gated `HEVY_BASE_URL` override plus a local fake server (Q-3).

**Guard rail.** Install a default route that **aborts** any request to
`api.hevyapp.com` seen by the browser (there should be none) and — because the
server-side call cannot be seen — make sure no Tier-1 spec ever submits an API
key to the *real* backend un-mocked (the fixture installs
`page.route('**/api/import/hevy/**', abort)` by default; specs override
selectively). The server's background `startSyncScheduler` only contacts Hevy
for users with a stored key, which a fresh test DB never has.

### 4.G Measurements and statistics

* Real backend: create (weight only), upsert on the same date (edit by clicking
  the row → title "Editar registro", `Guardar cambios`), delete with confirm,
  history ordering (newest first), chart appears only with ≥ 2 weights
  (assert the empty hint first, then the `role=img` chart).
* Validation: invalid number (`abc`, negative) → field flagged + toast
  "Revisa los valores numéricos…"; all measures empty → "Añade al menos una
  medida"; decimal comma accepted (`72,5` stored as 72.5 and displayed
  `72,5`).
* Dates/timezones: default date = local today (`formatDateInput`); with a fixed
  clock near midnight and `timezoneId` set, the default must be the **local**
  date, not the UTC date (P2, MEA-009).
* Statistics: home (`Esta semana`, week bars, tapping a bar swaps the stats and a
  second tap restores) and profile (metric switch Duración/Volumen/Repeticiones,
  bar-chart tooltip) with **seeded historical workouts** at fixed dates →
  deterministic totals. Charts are SVG: assert text/values and `role=img`, not
  pixels. Empty datasets: "Sin entrenamientos aún", "Sin medidas aún".
* Visual regression of charts is a P2 option only (font rendering differs
  between the Docker image and a dev machine).

### 4.H Responsive behaviour and mobile experience

* **Projects**: keep `chromium` (desktop) for the full suite and add
  `mobile-chromium` using a Playwright device descriptor (e.g. Pixel 7, which
  sets viewport, DPR, `isMobile`, `hasTouch`) running only the `@mobile` tagged
  subset: login → start workout → log a set → finish; bottom-nav navigation;
  picker sheet; confirm dialog; measurements form; rest timer visibility over
  the nav.
* **What emulation proves**: layout at that viewport, touch events, mobile UA
  and `matchMedia`. **What it does not**: real browser chrome/safe areas
  (`viewport-fit=cover` + `env(safe-area-inset-*)`), software-keyboard
  resizing and `inputmode` keypads, iOS Safari specifics, real haptics
  (`navigator.vibrate` is stubbed/absent), standalone-PWA install, WebKit
  differences. Those need **manual device checks** (list in §7.6); a WebKit
  Playwright project is a cheap partial proxy for Safari layout but is not iOS.
* **Layout overflow**: assert `document.documentElement.scrollWidth <=
  clientWidth` on each main route at 360×740 (one parameterised test).
* **Targets/interaction**: the key actions must be reachable without hover; the
  `Terminar` check button, `Agregar Serie`, rest-timer controls must not be
  covered by the bottom nav or rest-timer bar (assert `toBeVisible` +
  click succeeds; Playwright's actionability check fails on overlap).
* **Touch**: swipe-to-delete set (MOB-004), pull-to-refresh
  (`pull-refresh.js`, MOB-005, low priority/Spike: depends on scroll position
  and touch events).

### 4.I PWA and offline behaviour

**Implemented today (so testable):** SW registration, shell precache, offline
app boot from cache, offline workout creation / editing / finish with later
idempotent upload, inline "Sin conexión" states per view, offline picker from
IndexedDB, nav dot/banner from the local snapshot, offline→online refill of
"Anterior" suggestions, logout wipe.

**Explicitly *not* available offline (assert the degradation, do not expect
features):** browse catalog, routines create/edit, history, workout detail,
stats, measurements read/write, profile data/Hevy, superset/reorder/replace
(toast `No disponible sin conexión`), starting from a routine only if cached.

**Strategy / constraints (important).**

* The PWA project is the **only** place with `serviceWorkers: 'allow'`.
* Install-ability itself (A2HS prompt) is **not** automatable in Playwright;
  limit to static checks: `manifest.webmanifest` served with required fields and
  icons resolvable, `<meta name="theme-color">`, SW registered
  (`navigator.serviceWorker.ready`) and controlling after a reload.
* Offline simulation: `context.setOffline(true)`. **Spike (must be done first):**
  confirm in this Chromium/Playwright version that `setOffline` also takes the
  *service worker's* network down (so network-first navigation falls back to the
  cache) and that `page.route` does not intercept SW-served requests; if not,
  fall back to blocking via a route handler on the SW-visible origin or to
  `CDPSession` `Network.emulateNetworkConditions`. Until the spike passes,
  OFF-* scenarios are not estimable beyond M.
* Offline cold boot (OFF-002): load online once (SW installs and precaches),
  reload so the SW controls the page, set offline, reload → app shell renders
  and, with a session, shows the offline/inline states rather than the login
  screen (`boot()` treats status 0 with no user as `offlineScreen`; note that
  with **no** `/api/auth/me` answer there is no user, so the cold-offline
  start shows `Sin conexión` + `Reintentar` — verify and record as intended
  behaviour, Q-5).
* Offline workout end-to-end (OFF-004/005): the catalog / "Mis ejercicios" cache
  is warmed by `refreshCatalogCache` **after a successful online start** of a
  workout (`training.js` `startEmpty`/`startRoutine`), and the routines cache
  when the training view loads online. So the realistic sequence is: online →
  open the training view → start a workout online and discard it (warms both) →
  go offline → `Empezar Entrenamiento Vacío` (creates a *local* workout) → add a
  *Mis ejercicios* item from the cache → add set → complete → `Terminar` → toast
  "Entreno guardado localmente…" and navigation home; go online → the `online`
  event triggers `syncFinishedOffline` → `POST /api/workouts/sync`; assert the
  workout appears in history **exactly once** (also after a second
  reload/`online` event: idempotency). Starting offline *without* a previously
  warmed cache leaves the picker empty — a behaviour worth one assertion (OFF-004
  variant) and a question if it is not intended.
* SW update path (OFF-007, P2/Spike): serve a changed `sw.js` version and assert
  a single reload on `controllerchange`. Hard to do against the real static
  server without editing files; the repo already has a hash unit test — keep
  this as a manual release checklist item unless a cheap route-based version
  swap proves reliable.
* Separate "implemented now" from "only after future work": everything listed
  as unavailable offline above is **future coverage**; do not write tests that
  assume it.

---

## 5. Test scenario catalog

### 5.1 Conventions

* **Implementation status markers** (in the ID cell): `✅` = implemented and
  green locally (`npm run test:e2e`, Node 18, Chromium); `🟡` = partially
  implemented (the part that does not need a pending app change is covered).
  Unmarked = not yet implemented.
* **IDs are stable identifiers**: `AUTH`, `NAV`, `WRK` (workouts), `CAT`
  (catalog), `RTN` (routines), `HEV` (Hevy), `MEA` (measurements), `STA`
  (statistics), `MOB` (mobile), `OFF` (PWA/offline), `A11Y`. Per
  `AGENTS.md`, **do not put these IDs in test names, code comments or commit
  messages** — they live only in this planning doc. Test titles are plain
  English sentences.
* **Priority**: P0 critical · P1 important · P2 optional (definitions in the task brief).
* **Test type**: E2E (browser flow) · A11y · Visual. (Server logic stays in
  `node --test`; no scenario below duplicates it.)
* **Approach**: `RB` real local backend + temp DB · `MK` mocked API with
  `page.route` · `RB+MK` real backend with selective failure injection ·
  `SW` real backend with service worker enabled and context offline control.
* **Dependencies (fixtures, defined in §6)**: `reset` per-test API reset ·
  `login` API login (cookie in context) · `mine` seeded custom exercise ·
  `cat` seeded catalog · `hist` seeded finished workouts with fixed dates
  (`POST /api/workouts/sync`) · `clock` `page.clock` fixed time · `sw` service
  worker allowed · `mobile` mobile device project · `console` console-error
  guard (default on) · `ext` external-host guard (default on).
* **Complexity**: XS ≈ a few lines/one assertion · S ≈ ≤ 1 h · M ≈ half a day
  incl. new helper · L ≈ ≥ 1 day or new fixture · XL ≈ multi-day / needs a
  spike first.
* Scenarios already partly covered by the 2 existing specs say *(today: …)* in
  their title cell.

### 5.2 Authentication & session (A)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-001 ✅ | Authentication | Route guards in both directions | No session; then a session | (a) open `#/workouts` signed out; (b) sign in, open `#/login` | (a) login screen, bottom nav hidden; (b) redirected to home (`Empezar a entrenar` visible) | E2E | P0 | RB | login | S |
| AUTH-002 ✅ | Authentication | Demo sign-in through the real button | Signed out, dev login on | Click `Entrar en modo demo` | Toast `Hola, Atleta Demo`; home with greeting heading `Atleta`; nav visible | E2E | P0 | RB | reset | XS |
| AUTH-003 ✅ | Authentication | Session survives reload | Signed in | Reload on home and on `#/profile` | Still authenticated on the same route; no login flash as final state | E2E | P0 | RB | login | XS |
| AUTH-004 ✅ | Authentication | Logout | Signed in | Profile → `Cerrar sesión` → confirm | Toast `Hasta pronto`; login screen; opening `#/` afterwards returns to login; `Cancelar` in the dialog keeps the session | E2E | P0 | RB | login | S |
| AUTH-005 🟡 | Authentication | Expired/invalid session mid-use (**message needs app change AC-2**, D-2) | Signed in on home | `context.clearCookies()`; click the `Entrenar` tab | Redirected to login (no error screen loop) and a toast `Tu sesión ha caducado. Vuelve a entrar.` is shown; before AC-2 only the redirect can be asserted | E2E | P0 | RB | login | S |
| AUTH-006 | Authentication | Demo sign-in failure | Signed out | Mock `POST /api/auth/dev` → 500 (and 404); click demo button | Inline danger notice with the message; button usable again (not stuck in `Entrando…`); still on login | E2E | P1 | MK | — | S |
| AUTH-007 | Authentication | Demo button only when the server says so (**needs app change AC-1**, D-1) | Signed out | (a) Mock `/api/auth/config` → `{googleEnabled:false, devLoginEnabled:false}`; (b) mock `/api/auth/config` → 500 | (a) Notice `El acceso no está configurado…`, no demo button; (b) **no demo button**, an explicit "could not check access" state with a retry that, once the mock is removed, shows the normal login | E2E | P1 | MK | — | XS |
| AUTH-008 | Authentication | Google sign-in success (stubbed) | Config mock enables Google; GIS script stubbed | Click the stub Google button | `/api/auth/google` handled by delegating to `POST /api/auth/dev` (real cookie); lands on home authenticated; reload keeps session | E2E | P1 | RB+MK | login | M |
| AUTH-009 | Authentication | Google credential rejected | Same stub | `/api/auth/google` → 403 `Esta cuenta no tiene acceso a esta instancia` (also 401) | Message shown inline; remains on login; can still retry | E2E | P1 | MK | — | S |
| AUTH-010 | Authentication | Google script cannot load | Config mock enables Google | Abort the GIS script request | Notice `No se pudo cargar el acceso con Google…`; demo button still works | E2E | P1 | MK | ext | S |
| AUTH-011 | Authentication | Independent sessions across contexts | Two browser contexts, both logged in | Log out in A; reload B | B stays authenticated (same user, separate sessions) | E2E | P2 | RB | login | S |
| AUTH-012 | Authentication | Dev login disabled on the server *(optional second server)* | `webServer` #2 with `ALLOW_DEV_LOGIN=false` | Open login; `POST /api/auth/dev` | Demo button absent; endpoint 404 | E2E | P2 | RB | extra webServer | M |

### 5.3 Navigation & initialization (B)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| NAV-001 ✅ | Navigation | **Route sweep smoke**: every top-level route renders | Signed in | Visit `#/`, `#/routines`, `#/routines/new`, `#/workouts`, `#/exercises`, `#/measurements`, `#/profile` (and `#/workout/active` with none) | Each shows its own heading/topbar, no `No se pudo cargar`, **zero page errors / console errors** | E2E | P0 | RB | login, console | S |
| NAV-002 ✅ | Navigation | Bottom nav | Signed in | Click `Inicio`, `Entrenar`, `Perfil` | URL hash and view change each time; correct tab is `.active` and, after AC-8, has `aria-current="page"`; labelled `Navegación principal` | E2E | P0 | RB | login | S |
| NAV-003 | Navigation | Back / forward | Seeded routine | routines → routine detail → browser back → forward | Correct view each step; no duplicate or lost state | E2E | P1 | RB | mine, reset | S |
| NAV-004 ✅ | Navigation | Unknown hash | Signed in | Open `#/does-not-exist` | Redirect to home | E2E | P1 | RB | login | XS |
| NAV-005 | Navigation | Invalid-state screens | Signed in, no active workout | Open `#/workouts/999999`; open `#/workout/active` | `No se pudo cargar el entrenamiento` + `Volver`; `No hay entrenamiento activo` + `Ir a entrenamientos` | E2E | P1 | RB | reset | S |
| NAV-006 | Navigation | Load failure and recovery | Signed in | Mock `GET /api/stats/overview` → 500; open home; unroute; click `Reintentar` | `No se pudo cargar` + `Reintentar`; after unroute the retry renders the home content | E2E | P1 | MK→RB | login | S |
| NAV-007 | Navigation | Loading indicator | Signed in | Delay `/api/stats/overview` ~1 s | `Cargando…` loader visible, then replaced by content | E2E | P2 | MK | login | S |
| NAV-008 | Navigation | Reload on deep routes | Seeded workout & routine | Reload on `#/workouts/:id`, `#/routines/:id`, `#/exercises`, active workout | Same route re-renders with data | E2E | P1 | RB | hist, mine | S |

### 5.4 Workout management (C) and history

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| WRK-001 ✅ | Workouts | Start an empty workout | Signed in, no active workout | `Entrenar` → `Empezar Entrenamiento Vacío` | Active screen: `Sin ejercicios` hint, `Añadir ejercicio`, timer; home now shows the `Entrenamiento en curso` banner instead of `Empezar a entrenar` | E2E | P0 | RB | reset | S |
| WRK-002 | Workouts | **Core loop**: log and finish a workout | Seeded custom exercise (`mine`) | Start empty → `Añadir ejercicio` → tab `Mis ejercicios` → pick → `Agregar Serie` → kg `60`, reps `8` → check → `Terminar` | Toast `¡Entrenamiento guardado!`; detail page shows totals (1 serie, 480 kg); the same workout is first in history and in home `Historial reciente`; nav dot/banner gone | E2E | P0 | RB | reset, mine | L |
| WRK-003 | Workouts | Edits persist (debounce + flush paths) | Active workout with 1 set | Type reps; wait for save indicator to clear; reload. Variant: type then immediately navigate to home and back | Value present after reload in both variants; no save notice appears on a normal edit (`[data-save-state]` stays hidden) | E2E | P0 | RB | reset, mine | M |
| WRK-004 | Workouts | Finish with no completed sets | Active workout, 0 completed | `Terminar` → dialog `Terminar sin series` → `Cancelar`, then again → `Terminar` | Cancel keeps the workout active; confirm finishes and opens detail | E2E | P0 | RB | reset | S |
| WRK-005 | Workouts | Discard | Active workout | `Descartar entrenamiento` → cancel; again → confirm | Cancel keeps it; confirm toasts `Entrenamiento descartado`, goes home, banner gone, `GET /api/workouts/active` returns none | E2E | P0 | RB | reset | S |
| WRK-006 | Workouts | One active workout rule (**message needs app change AC-9**, D-13) | Active workout exists | From training view click `Empezar Entrenamiento Vacío` and, separately, `Empezar Rutina`; open the banner from home | No second workout; user lands on the existing active screen and sees a toast `Ya tienes un entrenamiento en curso`; banner opens the same workout | E2E | P1 | RB | reset | S |
| WRK-007 | Workouts | Remove exercise from active workout | Active workout with 2 exercises | Exercise ⋯ → `Eliminar Ejercicio` | Exercise removed immediately (no confirm on the active screen by decision D-6); the other remains; totals update | E2E | P1 | RB | reset, mine | S |
| WRK-008 | Workouts | Invalid numeric input | Active workout, 1 set | Type `5kg` in weight; type `-3` in reps | Weight field flagged (`input-error`) and **not** saved (reload → empty); negative reps clamp to `0` | E2E | P1 | RB | reset, mine | S |
| WRK-009 | Workouts | Decimal comma and point | Same | Weight `72,5` then `72.5` | Both stored as 72.5; displayed value/volume consistent after reload | E2E | P1 | RB | reset, mine | XS |
| WRK-010 | Workouts | Rest timer | Active workout, 1 set, `clock` | Complete a set; advance 5 s; `+15s`; `Saltar descanso`; toggle `Temporizador de descanso` off, complete another set; reload | `role=status` shows `1:30`→ counts down, `+15s` adds, skip hides; with it off no timer appears; preference persists after reload | E2E | P1 | RB | reset, mine, clock | M |
| WRK-011 | Workouts | Previous-set suggestion & prefill | A finished workout with the same exercise (`hist`) | New workout → add same exercise → click the `Anterior` value | Previous `kg × reps` shown; click fills both inputs and the totals update | E2E | P1 | RB | hist, mine | M |
| WRK-012 | Workouts | Set save fails | Active workout, 1 set | Mock `PATCH /api/workouts/*/sets/*` → 500; edit reps | Error toast; `Guardando…` stays visible (edit not silently dropped); after unroute and another edit it clears | E2E | P1 | RB+MK | reset, mine | S |
| WRK-013 | Workouts | Finish fails | Active workout with a completed set | Mock `POST …/finish` → 500; click finish | Error toast; user stays on active screen; finish button usable again | E2E | P1 | RB+MK | reset, mine | S |
| WRK-014 | Workouts | Workout detail & exercise detail modal | ≥ 2 finished workouts of one exercise (`hist`) | Open history card → detail → tap the exercise name/image | Totals, exercises and sets match the seed; the exercise detail modal opens with the *Resumen* tab showing a `Gráfico de progreso` image and the personal-record grid, and closes | E2E | P1 | RB | hist | M |
| WRK-015 | Workouts | History empty state | No workouts (`reset`) | Open `#/workouts` and home | `Sin entrenamientos` (+ `Empezar`) / `Sin entrenamientos aún` | E2E | P1 | RB | reset | XS |
| WRK-016 | Workouts | Edit numeric values of a finished workout (**needs app change AC-6**, D-8) | Finished workout | ⋯ → `Editar entrenamiento` → weight `72,5` then `72.5`; `5kg`; `-3`; reps `8.4`; `Listo`; reload | Same rules as the active screen: comma and point both give 72.5; `5kg` flagged (`input-error`) and not saved; negative → `0`; reps rounded to an integer; values survive reload and totals in the detail update | E2E | P1 | RB | hist | S |
| WRK-017 | Workouts | Edit finished workout: name / location / notes and exercise removal (**removal confirm needs AC-4**, D-6) | Finished workout with 2 exercises | ⋯ → `Editar entrenamiento`; fill name, `Ubicación`, `Notas`; leave field; trash on one exercise → cancel, then confirm; `Listo` | Detail shows the new name/location/notes; they survive reload; history card shows the new name; exercise removal asks for confirmation (cancel keeps it, confirm removes it and updates totals); deleting a single set stays immediate | E2E | P1 | RB | hist | M |
| WRK-018 | Workouts | History pagination | 25 workouts (`hist`) | Open history; click `Cargar más` | First 20 then all 25, grouped by month headings, button disappears | E2E | P1 | RB | hist | M |
| WRK-019 | Workouts | Delete finished workout | Finished workout | ⋯ → `Eliminar entrenamiento` → cancel; again → confirm | Cancel keeps; confirm toasts `Entrenamiento eliminado`, history no longer lists it, home totals update | E2E | P1 | RB | hist | S |
| WRK-020 | Workouts | Reorder / superset / replace (server-only) | Active workout, 3 exercises | Reorder via sheet and `Guardar orden`; add to superset and remove; replace one | Order persists after reload; `Superset` chip shown/removed; replaced exercise name updates | E2E | P2 | RB | reset, mine | M |
| WRK-021 | Workouts | Exercise detail — Historial and Indicaciones tabs | ≥ 2 finished workouts of a catalog-linked exercise (`hist`, `cat`) | Open a finished workout → tap the exercise name/image → switch to `Historial`, then `Indicaciones` | `Historial` lists each session (name + date) with one line per set (`kg × reps`) newest first; `Indicaciones` shows translated muscles/equipment chips and the numbered steps; a custom (non-catalog) exercise hides the `Indicaciones` tab | E2E | P1 | RB | hist, cat | M |
| WRK-022 | Workouts | Exercise detail opens from the active screen | Active workout with a catalog-linked exercise (`mine`/`cat`) | On the active screen tap the exercise name/image | The same detail modal opens (Resumen/Historial/Indicaciones) without triggering the ⋯ exercise menu; closing it leaves the workout editable | E2E | P2 | RB | reset, cat | S |
| WRK-023 | Workouts | Live record trophy shows only for a set that beats the previous best | A finished workout with the exercise so it has a previous best (`hist`, `mine`) | New workout → add the same exercise → add two sets: one below the previous best and one above it → mark both complete | The trophy badge (`[data-record]`, `Récord personal`) is **visible** on the set that beats the best and **hidden** on the set that does not; unchecking the record set hides its trophy; completing the record set shows the toast `¡Récord batido!` (and not for a non-record set). Guards the CSS regression where `.set-record`'s `display` overrode the `hidden` attribute and the trophy never hid. **On implementing this, delete the stopgap unit test `test/active-e1rm-parity.test.js`** | E2E | P1 | RB | reset, mine, hist | M |
| WRK-024 | Workouts | Completing a set auto-fills empty kg/reps from the previous session | A finished workout with the exercise (`hist`, `mine`) | New workout → add the same exercise → add a set and leave kg/reps empty → check it; repeat typing only the weight, and typing an explicit `0` | The empty fields take the previous session's values (inputs and totals update, persisted after reload); a field the user filled is kept (only the empty one is filled); an explicit `0` is not overwritten; without history nothing is filled and the set still completes | E2E | P1 | RB | reset, mine, hist | M |

### 5.5 Exercise catalog (D)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| CAT-001 ✅ | Catalog | Browse list and category chips | Seeded catalog (`cat`) | Training → `Explorar` | Heading `Ejercicios`; cards and chips (`Todos` + categories with counts) from the seed | E2E | P1 | RB | cat | M |
| CAT-002 ✅ | Catalog | Search and empty result | `cat` | Type a seeded name; then a nonsense term | Matching card(s) only; then `Sin resultados` / `Prueba con otro término o categoría.` | E2E | P1 | RB | cat | S |
| CAT-003 ✅ | Catalog | Category filter | `cat` | Click a category chip; then `Todos` | Only that category's cards; chip `.active`; `Todos` restores | E2E | P1 | RB | cat | S |
| CAT-004 | Catalog | Detail and add to my exercises | `cat` | Open a card → `Añadir a mis ejercicios`; then open any workout picker → tab `Mis ejercicios` | Toast `<name> añadido a tus ejercicios`; modal closes; exercise listed under `Mis ejercicios` | E2E | P1 | RB | cat, reset | M |
| CAT-005 ✅ | Catalog | Infinite scroll | ≥ 41 seeded rows in one category | Scroll sentinel into view | Second page appended without duplicates; sentinel disappears at the end | E2E | P2 | RB | cat | M |
| CAT-006 | Catalog | Picker: tabs, muscle filter, pick | Active workout; `cat` + `mine` | `Añadir ejercicio` → search; `Todos los músculos` → pick a group; switch tabs; pick an item | Results follow filters; muscle button shows the group; pick closes the sheet and the exercise appears in the workout (toast `<name> añadido`) | E2E | P1 | RB | cat, mine, reset | M |
| CAT-007 ✅ | Catalog | API failure states | Signed in | Mock `/api/exercises/search` → 500; mock detail 404 | Inline danger notice in results; detail modal shows an inline notice | E2E | P1 | MK | login | S |

### 5.6 Routines (E)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| RTN-001 | Routines | Create a routine | `mine` | `Nueva Rutina` → name, folder → `Añadir ejercicio` (`Mis ejercicios`) → `Guardar` | Toast `Rutina guardada`; routine detail; listed under its folder in the training view with the exercise count | E2E | P0 | RB | reset, mine | M |
| RTN-002 | Routines | Start a workout from a routine | Routine with 2 exercises | `Empezar Rutina` | Active screen shows both exercises with the routine's target sets; no second start possible | E2E | P0 | RB | reset, mine | M |
| RTN-003 | Routines | Edit a routine | Routine | ⋯ → `Editar rutina`; rename, change targets, move up/down, remove one, `Guardar` | Changes visible in detail and list after reload | E2E | P1 | RB | reset, mine | M |
| RTN-004 | Routines | Duplicate | Routine | ⋯ → `Duplicar` | Toast `Rutina duplicada`; a second card with same exercises | E2E | P1 | RB | reset, mine | S |
| RTN-005 | Routines | Delete with confirmation | Routine | ⋯ → `Eliminar` → cancel; again → confirm | Cancel keeps; confirm toasts `Rutina eliminada`; card gone; past workouts from it still in history | E2E | P1 | RB | reset, mine, hist | S |
| RTN-006 | Routines | Editor validation | Editor open | Save with empty name; with name but no exercises | Toasts `Ponle un nombre a la rutina` / `Añade al menos un ejercicio`; nothing created (list unchanged) | E2E | P1 | RB | reset | S |
| RTN-007 | Routines | Dirty-state guard | Editor with a change | Back arrow → dialog `Descartar cambios`; `Seguir editando`, then `Descartar` | First keeps the editor; second leaves to the list; without changes no dialog | E2E | P1 | RB | reset | S |
| RTN-008 | Routines | Empty states | No routines | Open training view; open a routine with no exercises | `Aún no tienes rutinas` + primary action; `Sin ejercicios todavía` preview | E2E | P1 | RB | reset | XS |
| RTN-009 | Routines | Folder grouping and collapse persistence | Routines in two folders | Collapse a folder; reload | Groups sorted (named folders first, `Mis rutinas` last); collapsed state persists | E2E | P2 | RB | reset, mine | S |

### 5.7 Hevy integration (F)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| HEV-001 | Hevy | Disconnected state and input guard | Status mock `{connected:false}`; import modal | `Conectar con Hevy` with empty key; in import modal `Previsualizar` with no file / empty key | Toast `Introduce tu API key`; `Elige primero el archivo CSV`; no request sent | E2E | P1 | MK | ext | S |
| HEV-002 | Hevy | Connect success | Disconnected mock | Type key, keep auto-sync, `Conectar con Hevy` | Toast `Cuenta de Hevy conectada`; card shows `Conectado a Hevy`, masked key, `Sincronizar ahora` | E2E | P1 | MK | ext | S |
| HEV-003 | Hevy | Connect failure | Disconnected mock | `connect` → 401 (invalid key), then 429 / network | Inline `import-error` with the message; buttons re-enabled; still disconnected | E2E | P1 | MK | ext | S |
| HEV-004 | Hevy | Manual sync with changes | Connected mock | `Sincronizar ahora` (response: imported 2, routines 1) | Busy text `Sincronizando…`; summary rows; toast `Sincronizado: +2 entrenos, 1 rutinas`; view refreshes | E2E | P1 | MK | ext | M |
| HEV-005 | Hevy | Manual sync, nothing new | Connected mock | `Sincronizar ahora` (all zeros) | `Todo al día / Sin cambios`; toast `Ya estabas al día`; no refresh | E2E | P1 | MK | ext | S |
| HEV-006 | Hevy | Sync status lines | Connected mock | Status with `lastStatus:'error'` + message; with `'warning'` | Error line (`import-error`) or warning line shown; clean status shows none; `última sync` text | E2E | P1 | MK | ext | S |
| HEV-007 | Hevy | No duplicate actions while busy | Connected mock, delayed response | Click `Sincronizar ahora`; try clicking it and `Desconectar` again | All card buttons disabled during the request; exactly **one** request issued | E2E | P1 | MK | ext | S |
| HEV-008 | Hevy | Auto-sync / webhook toggles | Connected mock | Toggle auto-sync (success then failure); webhook available / unavailable | Success toasts; failed toggle reverts the checkbox and shows error; unavailable shows the `PUBLIC_URL` hint | E2E | P2 | MK | ext | S |
| HEV-009 | Hevy | Disconnect | Connected mock | `Desconectar` → cancel; again → confirm | Cancel keeps; confirm toasts `Cuenta de Hevy desconectada` and shows the connect form | E2E | P1 | MK | ext | S |
| HEV-010 | Hevy | CSV import: preview then import (**no external calls**) | Small fixture CSV; empty history | Profile → `Importar de Hevy` → choose file → `Previsualizar` → `Importar` | Preview shows `Entrenos a importar` etc. and writes nothing; import shows `Entrenos importados`, toast, modal closes, history lists the workouts | E2E | P1 | RB | reset, hevy-csv | M |
| HEV-011 | Hevy | CSV re-import is idempotent | After HEV-010 | Import the same file again | `Omitidos (duplicados)` > 0; workout count unchanged | E2E | P1 | RB | HEV-010 | S |
| HEV-012 | Hevy | Delete imported data | After HEV-010 | `Eliminar datos importados de Hevy` → cancel; confirm | Cancel keeps; confirm toasts and removes only imported workouts/routines; manual workouts remain | E2E | P1 | RB | HEV-010, hist | S |
| HEV-013 | Hevy | Imported content is read-only in the UI | After HEV-010 (workout + routine with `source='hevy'`) | Open imported workout menu; open imported routine editor by URL | No `Editar entrenamiento` item and `Importado de Hevy · solo lectura`; `Rutina de solo lectura` | E2E | P2 | RB | HEV-010 | S |

### 5.8 Measurements & statistics (G)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| MEA-001 | Measurements | Create a measurement | Empty | Profile → `Medidas` → weight `72,5` → `Guardar medida` | Toast `Medida guardada`; history row `72,5 kg` newest first; form reset | E2E | P1 | RB | reset | S |
| MEA-002 | Measurements | Chart threshold | 0, 1, 2 weights | Add weights one by one | `Registra al menos dos pesos…` until the second; then a `Gráfico de progreso` image | E2E | P1 | RB | reset | S |
| MEA-003 | Measurements | Edit by date | Existing record | Click the row; change weight; `Guardar cambios`; and `Cancelar` path | Title `Editar registro`; same date updated (no duplicate row); cancel resets form | E2E | P1 | RB | reset | S |
| MEA-004 | Measurements | Delete with confirmation | Existing record | Trash → cancel; confirm | Toast `Medida eliminada`; row gone; chart/empty state updates | E2E | P1 | RB | reset | S |
| MEA-005 | Measurements | Invalid values | Form | `abc`, `-5` in weight | Field flagged; toast `Revisa los valores numéricos (usa coma o punto)`; nothing saved | E2E | P1 | RB | reset | XS |
| MEA-006 | Measurements | Comma/point decimals | Form | `72,5`, `72.5`, body fat `18,2` | Stored and shown as numbers (`72,5`, `18,2 % grasa`) | E2E | P1 | RB | reset | XS |
| MEA-007 | Measurements | At-least-one-measure guard | Form with only a note | Save | Toast `Añade al menos una medida`; no request | E2E | P1 | RB | reset | XS |
| MEA-008 | Measurements | Empty state | None | Open measurements | `Sin medidas aún`, `Aún sin registros` | E2E | P1 | RB | reset | XS |
| MEA-009 | Measurements | Default date is local, not UTC | `clock` near local midnight; non-UTC `timezoneId` | Open form | Date input equals the **local** calendar date | E2E | P2 | RB | clock | M |
| STA-001 | Statistics | Home weekly stats, local weeks (**needs app change AC-7**, D-9) | Seeded history at fixed dates (`hist`, `clock`), including one workout at 00:30 Monday Europe/Madrid (= Sunday 23:30 UTC in winter) | Open home; tap a week bar; tap again | Totals match seed; the 00:30-Monday workout counts in the **new** local week; selecting a bar swaps label/stats; second tap restores `Esta semana` | E2E | P1 | RB | hist, clock | M |
| STA-002 | Statistics | Profile metrics & chart | `hist` | Profile → switch `Duración`/`Volumen`/`Repeticiones`; hover/tap a bar | Chart title follows metric; tooltip shows `Entrenos/Tiempo/Volumen/Series` of that week | E2E | P2 | RB | hist, clock | M |

### 5.9 Responsive / mobile (H)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| MOB-001 | Mobile | Core loop at phone viewport | `mobile`, `mine` | WRK-002 flow with touch taps | Completes; no element covered by nav/rest bar; totals correct | E2E | P1 | RB | mobile, reset, mine | M |
| MOB-002 | Mobile | No horizontal overflow | `mobile` (360×740) | Visit each main route | `scrollWidth <= clientWidth` on all | Visual | P1 | RB | mobile, login | S |
| MOB-003 | Mobile | Bottom nav vs rest timer vs sheets | `mobile`, active workout | Complete a set (rest bar shows); open picker sheet; open confirm dialog | `Terminar`, `Agregar Serie`, timer controls and dialog buttons all clickable (Playwright actionability) | E2E | P1 | RB | mobile, reset, mine | S |
| MOB-004 | Mobile | Swipe to delete a set — **Spike** | `mobile` (touch), set row | Drag the row left, tap revealed delete | Set removed, totals update; row springs back if the request fails | E2E | P1 | RB+MK | mobile, reset, mine | L |
| MOB-005 | Mobile | Pull to refresh — **Spike** | `mobile`, at top of home | Touch-drag down | View reloads (extra `GET /api/stats/overview`) | E2E | P2 | RB | mobile | M |
| MOB-006 | Mobile | Dialogs/sheets usable on small screens | `mobile` | Open picker, action sheet, confirm; scroll long lists | Content reachable; close via `Cerrar`/Escape/backdrop | E2E | P1 | RB | mobile, mine | S |

### 5.10 PWA & offline (I)

> All `OFF-*` need the **setOffline/service-worker spike** (§4.I) first. The
> offline workout feature **is implemented**; scenarios below test it.

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| OFF-001 | PWA | SW registers and controls; manifest sane | `sw`, signed in | Load, wait for `serviceWorker.ready`, reload; fetch `/manifest.webmanifest` and icons | Controller present after reload; manifest has name/start_url/icons that resolve (200) | E2E | P1 | SW | sw | S |
| OFF-002 | PWA | **Cold start offline opens the app** (**needs app change AC-3**, D-5) | `sw`, signed in online once (last user remembered), SW controlling, then context offline | `setOffline(true)`; reload / new page | App shell renders and the app opens normally for the remembered user (no login form, no dead `Sin conexión` screen); data sections show their inline `Sin conexión` blocks; an in-progress local workout is reachable. **Before AC-3** run it as a characterization spike: today it shows `Sin conexión` + `Reintentar` | E2E | P0 | SW | sw | M |
| OFF-003 | PWA | Inline offline states | `sw`, signed in, then offline | Open history, exercises, measurements, profile, workout detail | Each keeps its header and shows `Sin conexión` block with `Reintentar`; no crash, no login redirect | E2E | P1 | SW | sw, login | M |
| OFF-004 | PWA | **Build and finish a workout offline** | Caches warmed online (start a workout online once and discard it; training view loaded online); then offline | `Empezar Entrenamiento Vacío` → add exercise from cache → add set, kg/reps, check → `Terminar` | `Sin conexión · se sincronizará` pill while active; on finish toast `Entreno guardado localmente…` and navigate home; nothing in server history yet | E2E | P0 | SW | sw, mine, reset | L |
| OFF-005 | PWA | **Reconnect uploads exactly once** | After OFF-004 | `setOffline(false)` (+ dispatch `online`); then reload and trigger `online` again | Workout appears in history **once** with the right sets; banner/dot cleared; repeated triggers create no duplicate (idempotent sync) | E2E | P0 | SW | OFF-004 | L |
| OFF-006 | PWA | Server-only actions degrade clearly | `sw`, active **local** workout | Reorder / superset / replace; training `Nueva Rutina` | Toast `No disponible sin conexión` / `Necesitas conexión para crear una rutina`; nothing breaks | E2E | P2 | SW | sw | S |
| OFF-007 | PWA | SW update takes over once — **Spike / maybe manual** | Old SW controlling page | Serve a changed `sw.js`/`CACHE_VERSION`; reload | New worker activates; page reloads **once**; old caches removed | E2E | P2 | SW | sw | XL |
| OFF-008 | PWA | Reconnect mid-workout does not finish it | Active local workout, offline then online | Go online while still editing | Workout stays active and local (not uploaded); pill clears only when appropriate; "Anterior" suggestions refill | E2E | P1 | SW | sw, hist | M |
| OFF-009 | PWA | Logout never silently loses a workout, never leaks data (**needs app change AC-5**, D-7) | Local finished-offline workout exists | (a) go online, log out; (b) stay offline, open logout; confirm; log in as the same user afterwards | (a) workout is uploaded first and appears once in history; (b) the confirm dialog warns that the unsent workout will be lost; cancel keeps everything; after confirm there is no stale active workout/banner for the next session (assert via UI, not internals) | E2E | P1 | SW | sw | M |

### 5.11 Accessibility (cross-cutting)

| ID | Category | Scenario | Preconditions | User actions | Expected result | Type | Pri | Approach | Deps | Cx |
|---|---|---|---|---|---|---|---|---|---|---|
| A11Y-001 | Accessibility | Dialog focus & Escape | Any confirm dialog | Open via keyboard; press Escape | Focus moves into the `<dialog>`; Escape closes without confirming; focus returns to the trigger | A11y | P1 | RB | login | S |
| A11Y-002 | Accessibility | Log a set with the keyboard only | Active workout, 1 set | Tab to kg → reps → `Completar serie`; press Enter/Space | Order is logical, controls have names (`Peso en kg`, `Repeticiones`, `Completar serie`); set completes | A11y | P1 | RB | reset, mine | S |
| A11Y-003 | Accessibility | Form labels are programmatically associated (**needs app change AC-8**, D-11) | Measurements, routine editor and finished-workout edit forms | `getByLabel('Peso (kg)')`, `getByLabel('Nombre')`, … | Each field is reachable by its label and clicking the label focuses the input | A11y | P2 | RB | login | S |
| A11Y-004 | Accessibility | Toast is announced (**needs app change AC-8**, D-11) | Any success action | Perform an action; inspect the toast container | The toast text appears inside an element with `role="status"` (`aria-live="polite"`) | A11y | P2 | RB | login | XS |

### 5.12 Catalog totals

| Priority | Count | Notes |
|---|---|---|
| P0 | 17 | AUTH-001–005, NAV-001–002, WRK-001–005, RTN-001–002, OFF-002, OFF-004–005 |
| P1 | 70 | Bulk of the value; implemented milestone by milestone |
| P2 | 16 | Optional; do only if cheap or after a regression |
| **Total** | **103** | Counted from the tables above. Not all are meant to exist at once — see the roadmap (P0 + a curated P1 subset is the realistic target) |

---

## 6. Suite architecture proposal

> Proposal only — none of these files exist. Everything stays plain JavaScript
> ES modules (the repo has no TypeScript/build step), runs on Node ≥ 18, adds
> **no new dependency**, and does not touch `server/` or `public/`.

### 6.1 Directory layout

```
e2e/
  specs/                      # one folder per feature area, *.spec.js
    smoke/                    #   route sweep, auth guards (the @smoke set)
    auth/
    workouts/                 #   active workout, history, detail/edit
    routines/
    catalog/
    measurements/
    hevy/
    mobile/                   #   only run by the mobile project
    pwa/                      #   only run by the pwa project (SW enabled)
    a11y/
  fixtures/
    index.js                  # exports { test, expect }: base.extend({...}) — the only import specs need
    api.js                    # thin helpers over context.request: login, reset, seed*
    data.js                   # tiny factories: workoutPayload(), routinePayload(), uniqueName()
    guards.js                 # auto-fixtures: console/pageerror guard, external-host guard
    google-stub.js            # route helpers + GIS stub script
    hevy-mocks.js             # builders for recorded-shape Hevy JSON responses
  support/
    seed-catalog.js           # pre-boot: seeds a fixed catalog via the production sync code path
    catalog.fixture.json      # ~50 deterministic rows (one category with 45 for infinite scroll)
    hevy-workouts.fixture.csv # small Hevy export for the local CSV import
  e2e.config notes            # (config stays in playwright.config.js at the repo root)
```

Responsibilities, in one line each:

* `fixtures/index.js` — single place that composes fixtures; specs never import
  helpers directly except `data.js` factories.
* `fixtures/api.js` — **all** data setup/cleanup goes through the public HTTP API
  using the page context's cookie jar, never through the DB file (keeps tests
  honest about the contract and safe against schema changes).
* `support/seed-catalog.js` — the only place that touches the DB directly, and
  only to feed the catalog through `syncCatalog({ force: true, dataset })`
  (existing production function) **before the server boots**.

### 6.2 `playwright.config.js` deltas (proposal)

| Setting | Current | Proposed | Why |
|---|---|---|---|
| `workers` / `fullyParallel` | default | `workers: 1`, `fullyParallel: false` | One shared user + DB (F-1); revisit in M10 |
| `webServer.command` | `node server/index.js` | `node e2e/support/seed-catalog.js && node server/index.js` | Deterministic catalog, no external fetch (F-2) |
| `webServer.reuseExistingServer` | `!CI` | `false` | Never attach to a non-test server (F-7) |
| `use.serviceWorkers` | default (allow) | `'block'`; `'allow'` only in the `pwa` project | Reliable `page.route`, no cross-test cache (F-5) |
| `use.locale` / `timezoneId` / `reducedMotion` | unset | `es-ES` / `Europe/Madrid` / `reduce` | Determinism (F-6) |
| `use.screenshot` / `video` | default | `only-on-failure` / `off` | Evidence without heavy artifacts |
| `use.trace` | `on-first-retry` | keep | Already right |
| `timeout` / `expect.timeout` | defaults (30 s / 5 s) | keep defaults; raise only per-test with justification | Avoid masking slowness |
| `projects` | `chromium` | `chromium` (ignores `mobile/`, `pwa/`), `mobile-chromium` (Pixel-class device; `mobile/` + `@mobile`), `pwa` (SW allowed; `pwa/`), `webkit` (**`@smoke` + WRK-002 only**, D-12) | Matches §4.H/§4.I |
| `reporter` | `list` / `list+html` | add `github` on CI | PR annotations |
| `grep` profiles | none | via CLI tags (§6.7) | Execution profiles (§7.1) |

Also correct the comment in `playwright.config.js` that says
`CATALOG_SYNC_DAYS` prevents the external sync (F-2).

### 6.3 Reset and data fixtures

* `resetData` — an **auto fixture** (runs before every test that opts in via
  the default `test` export): using `context.request` after login it
  (1) discards/deletes the active workout, (2) deletes all workouts the user
  has (`GET /api/workouts?limit=…` paging, then `DELETE /api/workouts/:id`),
  (3) deletes routines, (4) deletes measurements, (5) calls the Hevy
  disconnect/flush endpoints if connected. **Spike:** confirm the exact
  endpoints and idempotency, and measure the cost (expected: tens of ms for
  an empty DB).
* Because custom exercises cannot be deleted, `data.js#uniqueName(prefix)`
  appends a run/worker/test-unique suffix; scenarios locate by that name.
* Seeders (all via API): `seedExercise(name)` → `POST /api/exercises/custom`;
  `seedRoutine({name, exercises})` → `POST /api/routines`;
  `seedWorkouts(list)` → `POST /api/workouts/sync` with explicit `startedAt` /
  `finishedAt` / `clientId` (idempotent, deterministic dates);
  `seedMeasurements(list)` → `POST /api/measurements`.
* **Isolation limits to state plainly**: the reset fixture makes tests
  *order-independent and repeatable*, not *parallel-safe*. Parallelism needs a
  server + DB per worker (worker-scoped fixture starting its own
  `node server/index.js` on `basePort + workerIndex`), planned for M10 and not
  needed until the suite is slow enough to justify it.

### 6.4 External-host guard (auto fixture)

* `page.route('**/*', …)` fallback (registered first, so specific routes win)
  that **aborts and records** any request whose host is not the test origin,
  and fails the test at teardown if any were seen. Allowed exceptions are
  declared per test (e.g. the stubbed GIS URL is fulfilled by its own route and
  therefore never reaches the fallback).
* Covers: Google Identity script, fonts/CDNs, accidental image hosts, any
  `api.hevyapp.com` call made by the **browser**. It cannot see
  **server-to-server** calls — hence the separate rule in §4.F that no spec
  submits a Hevy key to the real backend un-mocked, and the seeded catalog
  (F-2) that removes the server's boot-time fetch.
* Catalog images: seed rows without image URLs so no request to
  `/api/exercises/image/…` (which fetches upstream) is ever made.

### 6.5 Authentication helpers

* `login` fixture: `await context.request.post('/api/auth/dev')`; the cookie
  jar is shared with pages created from that context. Default for every spec
  except AUTH-002/006/007/008–010 which exercise the login UI.
* No committed `storageState` file (nothing to leak, nothing to go stale: the DB
  and sessions are recreated each run). If login time ever matters, a
  setup project can write `storageState` to `test-results/`, which is gitignored.
* Google: `google-stub.js` exports `enableGoogleStub(page, {onCredential})`
  implementing §4.A (config mock + GIS script fulfil + `/api/auth/google`
  handler that delegates to the real dev session). No production switch is
  added or weakened.

### 6.6 Page Objects: **not recommended**

The app is vanilla JS with ~12 views, delegated `data-*` hooks and Spanish
accessible names. Locators are one-liners; a class layer would add indirection
without removing duplication. Use instead:

* locators inline in specs, role/label/`data-*` per §3.3;
* a handful of **action helpers** in `fixtures/` only where a flow repeats
  ≥ 3 times (`startEmptyWorkout`, `addExerciseFromPicker`, `completeSet`,
  `confirmDialog(page, 'Eliminar')`);
* revisit Page Objects only if a single view's locators are duplicated across
  > 10 specs.

### 6.7 Tagging

Use Playwright's native `tag` option (searchable with `--grep`):
`@smoke` (≈ 6–8 fastest tests proving boot/auth/core loop), `@critical` (all
P0), `@mobile`, `@pwa`, `@hevy`, `@a11y`, `@slow` (> 20 s). Tag by *purpose*, not
by scenario ID.

### 6.8 Conventions

* Titles are plain English sentences (`"finishing with no completed sets asks for confirmation"`); no scenario IDs, no roadmap references (`AGENTS.md` rule 4).
* `test.describe` per feature file; one behaviour per test; arrange via API,
  act and assert via UI.
* Web-first assertions only. **No `waitForTimeout`**; waiting is on a response
  (`page.waitForResponse`), a locator state, or the clock. A grep for
  `waitForTimeout|setTimeout` in `e2e/` is part of review.
* Assert **outcomes a user sees** (text, counts, URL hash); assert CSS classes
  only when the class *is* the state (`input-error`, `.toast.success`).
* Fixtures clean up before, not after (so a crashed run cannot poison the next).
* Comments in English; UI strings asserted in Spanish exactly as shipped.

---

## 7. Execution strategy & CI

### 7.1 Profiles

| Profile | Selection | Purpose | When |
|---|---|---|---|
| **Smoke** | `--grep @smoke` on `chromium` | "Does the app boot, sign in and log a set?" | Every push to `main` and every PR; locally before committing front-end changes |
| **Critical regression** | `--grep @critical` | All P0 scenarios | Every PR; before deploy-affecting changes |
| **Full desktop** | `--project=chromium` (everything not mobile/pwa) | All scenarios | PR + manual dispatch; nightly/weekly optional |
| **Mobile viewport** | `--project=mobile-chromium` | Touch + small-screen subset | PR touching `public/css` or views; manual |
| **PWA/offline** | `--project=pwa` | SW + offline flows (slowest, most environment-sensitive) | Manual dispatch + weekly; always before a release that edits `public/sw.js` or `public/js/offline/*` |
| **Accessibility / visual** | `--grep @a11y` | Keyboard/focus/ARIA checks; tracked known-failures | Weekly or on UI changes |

Rough sizing is **not** promised here: only two tests have ever been timed
(`5.8 s` total locally, Chromium, Node 18). Re-measure after M1 and set budgets
then.

### 7.2 Mapping to the existing workflows (no changes made by this document)

* `ci.yml` **`test`** job (syntax check + `npm test`, push + PR): unchanged.
* `ci.yml` **`e2e`** job (Docker `e2e` target): today PR + dispatch. Recommended
  evolution, in order of cost/benefit:
  1. fix artifact retention and run-as-runner-user (F-3) — prerequisite;
  2. add `@smoke` on push to `main` so direct pushes are still covered (F-4);
  3. keep the full suite on PR/dispatch; schedule the PWA project weekly.
* `deploy.yml` gate: **keep `npm test` only.** The deploy runs on the
  production host's self-hosted runner, is pull-based with rollback, and must be
  fast and dependency-light; pulling a ~1 GB Playwright image and running
  browsers there adds failure modes unrelated to the code being shipped. Note
  that `ci.yml` and `deploy.yml` are independent triggers on push to `main`, so a
  red E2E **does not stop a deploy** unless the owner later adds a `needs`/
  `workflow_run` relationship. The owner decided to keep E2E advisory for now
  (D-10); the promotion criterion is recorded there.
* The `e2e` Docker build must keep using `--network=host` (documented host
  constraint).

### 7.3 Flaky-test policy

1. Retries: `1` in CI only, `0` locally (flakes must be visible while writing).
2. A test that passes only on retry is reported by Playwright as **flaky**; treat
   it as a defect, not a pass: open a note, fix the root cause (usually a missing
   web-first wait, shared state, or clock) within the next milestone step.
3. Quarantine = `test.fixme()` with a one-line reason and date, never silent
   deletion and never a longer timeout as the "fix". Quarantined tests count
   against the milestone's definition of done.
4. New tests must pass `--repeat-each=10` locally (single worker) before being
   committed. Cheap and catches most timing bugs.
5. No `waitForTimeout`; no assertions on elapsed wall-clock text without `clock`.

### 7.4 Artifacts

* Config: `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`,
  `video: 'off'` (traces include a filmstrip; video costs space and rarely adds
  signal). Enable `video: 'retain-on-failure'` temporarily for a specific
  investigation.
* CI (needed, not yet present): mount a host directory over `/app/test-results`
  and `/app/playwright-report` (or `docker cp` after the run, with
  `docker run` without `--rm` and cleanup in an `always()` step), run the
  container as the runner's UID/GID, then `actions/upload-artifact` with a short
  retention (e.g. 7 days) on `if: always()`. Same ownership reasoning as the
  existing `test` job comments (avoid root-owned files in the runner workspace).
* Locally: `npx playwright show-report` and `npx playwright show-trace`.

### 7.5 Reporting

`list` locally; on CI `list` + `html` + `github` (inline PR annotations). No
JUnit/dashboard: one maintainer, so the Actions run page plus the uploaded HTML
report is enough. Surface a short `GITHUB_STEP_SUMMARY` (passed / failed /
flaky / skipped-fixme counts) once the suite exceeds ~20 tests.

### 7.6 Manual device checklist (cannot be automated reliably)

Run on real devices before a release that changes layout, SW or offline code:

1. iOS Safari: *Add to Home Screen*, launch standalone, sign in, log a workout.
2. Safe areas / notch: bottom nav, rest-timer bar and `Terminar` not clipped
   (`viewport-fit=cover`).
3. Software keyboard: set inputs stay visible; decimal keypad offers the
   comma/point used by the target locale.
4. Airplane-mode workout: start offline, add sets, finish, reconnect, confirm it
   appears **once** in history.
5. PWA update after a deploy: installed app shows the new version after at most
   one automatic reload; no mixed old/new UI.
6. Android Chrome: haptics on set completion, swipe-to-delete, pull-to-refresh.
7. Real Google sign-in (One Tap / popup, third-party-cookie settings) over the
   Cloudflare Tunnel HTTPS origin; `Secure` cookie works.
8. Light/dark theme on device; charts legible.

---

## 8. Prioritized implementation roadmap

Order rationale: build the **foundation first** (isolation, determinism,
artifacts), then the highest-risk user journeys, then breadth, and leave the
environment-sensitive PWA work for after the suite is stable. Each milestone is
independently shippable (suite green, committed by the owner's instruction).

### 8.0 Application changes decided in §9.0 (prerequisites, not E2E work)

Each is a product change, **outside the scope of this document**; none has been
made. They need the owner's go-ahead, normal review, and the `AGENTS.md`
checklist (shell hash recomputed, `CACHE_VERSION` bumped, `npm test` green).

| ID | Decision | Change | Files (as read) | Scenarios that depend on it |
|---|---|---|---|---|
| AC-1 | D-1 | No `devLoginEnabled: true` fallback when `/api/auth/config` fails; explicit error + retry | `public/js/app.js` (`boot`), `public/js/views/login.js` | AUTH-007 |
| AC-2 | D-2 | Toast `Tu sesión ha caducado. Vuelve a entrar.` on the 401 redirect | `public/js/app.js` (`handleUnauthorized`) | AUTH-005 |
| AC-3 | D-5 | Offline cold start for the last known user (`{id,name}` persisted at login, cleared on logout/401) | `public/js/app.js` (`boot`), `public/js/offline/*` | OFF-002, OFF-004 |
| AC-4 | D-6 | Confirm before removing an exercise in finished-workout edit mode | `public/js/views/workout.js` | WRK-017 |
| AC-5 | D-7 | Logout uploads a pending offline workout first; warns if it cannot | `public/js/app.js` (`logout`), `public/js/views/profile.js` | OFF-009 |
| AC-6 | D-8 | Finished-workout edit uses text inputs + `parseDecimalInput` | `public/js/views/workout.js` | WRK-016 |
| AC-7 | D-9 | `tz`-aware weekly buckets | `public/js/api.js`, **`server/routes/stats.js`** (+ a `node --test` case) | STA-001 |
| AC-8 | D-11 | Label association, toast live region, `aria-current="page"` | `public/js/views/measurements.js`, `routine-editor.js`, `workout.js`, `ui.js`, `app.js` | A11Y-003, A11Y-004, NAV-002 |
| AC-9 | D-13 | Toast on the 409 redirect when starting a workout | `public/js/views/training.js` | WRK-006 |

Suggested packaging (one shell bump per batch, fewer service-worker cache
invalidations for installed clients):

* **Batch 1 — AC-1, 2, 4, 5, 6, 7, 8, 9**, done after M0 and before M1/M2/M4/M5
  (the scenarios above are written only once their change exists; until then a
  scenario can assert just the part that does not need it).
* **Batch 2 — AC-3** as its own task before M8: first run the OFF-002
  characterization (what the app does today when launched offline), then
  implement, because it is the largest and riskiest change (identity persisted
  on the device).

---

**Common Definition of Done (applies to every milestone):**
`npm test` still green and `npm audit` at 0; `npm run test:e2e` green locally
(Node 18, Chromium) and the milestone's new tests pass `--repeat-each=10`; the
`e2e` Docker target built and run **by the owner on the host** (cannot be
verified from the sandbox — stated explicitly in the hand-off); no
`waitForTimeout`; no scenario IDs in code/titles/commits; any new dependency
pinned exactly with `engines` checked (none planned); test milestones do not
change `public/` (the §8.0 batches do, and follow the shell hash +
`CACHE_VERSION` rule of `AGENTS.md`); owner reviews before
commit.

### M0 — Foundation hardening — **Completed**
* **Status:** Completed. Config deltas, `e2e/fixtures/` (`index.js`, `api.js`,
  `guards.js`, `data.js`, `workout-actions.js`), catalog seeding
  (`e2e/support/seed-catalog.js` + `catalog.fixture.json`) are in place.
  `npm run test:e2e` passes 17/17 locally (Node 18, Chromium) and is stable
  across two consecutive runs. The auth/import HTTP rate limiters are disabled
  under `NODE_ENV=test` so the shared dev user can sign in many times per run
  without tripping the 40-request window (`server/app.js`). Docker/CI items stay
  deferred per §9.0 D-15.
* **Objective:** make the existing setup deterministic, isolated and diagnosable.
* **Scenarios:** none new (re-home the 2 existing tests as WRK-001 and a
  part of AUTH-002 in M1).
* **Infra/fixtures:** config deltas (§6.2); `fixtures/index.js`, `api.js`
  (`login`, `resetData`), `guards.js` (console + external-host); catalog seeding
  (`support/seed-catalog.js`, F-2); CI artifacts + runner UID (F-3); `.gitignore`
  already covers outputs. Spikes: reset endpoints; `syncCatalog({dataset})`
  shape; Docker image Node version (F-10).
* **Depends on:** nothing. **Complexity:** L.
* **Outcome:** a run starts with a known catalog, no network, one user with no
  data; failures leave a trace artifact.
* **Validation:** run the suite twice in a row (second run must not depend on the
  first); run with the network blocked (e.g. `unshare -n` or by pointing the
  catalog URL at nothing) and see no failures; deliberately failing test uploads
  an artifact (owner-verified on the runner).
* **DoD:** common DoD + zero requests to non-test hosts recorded in a full run.

### M1 — Authentication & smoke — **Completed**
* **Status:** Completed. Delivered: AUTH-001 (`auth/route-guards.spec.js`),
  AUTH-002 (`auth/demo-sign-in.spec.js`), AUTH-003 (`auth/session-reload.spec.js`),
  AUTH-004 (`auth/logout.spec.js`), AUTH-005 redirect
  (`auth/expired-session.spec.js`; the AC-2 toast is still pending), NAV-001
  (`smoke/route-sweep.spec.js`), NAV-002 and NAV-004 (`smoke/navigation.spec.js`),
  WRK-001 (`workouts/start-workout.spec.js`). All tagged `@smoke` where the plan
  asks for it and green locally. AUTH-011 (cross-context sessions) not yet
  written.
* **Objective:** a `@smoke` set that proves boot, auth and guards.
* **Scenarios:** AUTH-001, 002, 003, 004, 005, 011 · NAV-001, 002, 004 · WRK-001.
* **Infra:** `login` fixture; console guard active; tag `@smoke`.
* **Depends on:** M0. **Complexity:** M.
* **Outcome:** < ~1 min smoke; a broken module import or guard regression turns
  CI red.
* **Validation:** temporarily break an import in a scratch branch (not committed)
  and confirm NAV-001 fails with the console error; clear cookies and confirm
  AUTH-005 behaves.
* **DoD:** common DoD; smoke runnable alone via `--grep @smoke`.

### M2 — Core workout loop
* **Objective:** protect the app's main purpose and its data integrity.
* **Scenarios:** WRK-002, 003, 004, 005, 006, 007, 008, 009, 010, 020, 022.
* **Infra:** `seedExercise`, action helpers (`startEmptyWorkout`,
  `addExerciseFromPicker`, `completeSet`), `clock` for the rest timer, and the
  **`webkit` project** (D-12) running only `@smoke` + the core loop (WRK-002),
  added at the end of this milestone once those tests exist.
* **Depends on:** M0, M1. **Complexity:** L.
* **Outcome:** the log→finish journey and the write-scheduling behaviour are
  guarded in a real browser (regression magnet identified in §2.4).
* **Validation:** mutation check — locally break the flush on toggle or the
  `onSettled` hide and see WRK-003/002 fail.
* **DoD:** common DoD; WRK-002 asserts detail, history and home agree.

### M3 — Routines & exercise catalog — **In progress**
* **Status:** In progress. The catalog half is delivered (`catalog/catalog.spec.js`):
  CAT-001 (list + chips with counts), CAT-002 (search + empty state), CAT-003
  (category filter), CAT-005 (infinite scroll to 45 with no duplicates) and
  CAT-007 (search 500 + detail 404 inline notices), all green locally. Still
  pending: CAT-004 and CAT-006 (picker-based), and all of RTN-001–009.
* **Objective:** cover creating and reusing plans and finding exercises.
* **Scenarios:** RTN-001–009 · CAT-001–006.
* **Infra:** `seedRoutine`, seeded catalog (45-row category for CAT-005), picker
  helper.
* **Depends on:** M0, M2 (helpers). **Complexity:** L.
* **Outcome:** routine CRUD/start and catalog browse/search/picker protected.
* **Validation:** CAT-005 passes with exactly two pages; RTN-005 proves past
  workouts survive deletion.
* **DoD:** common DoD.

### M4 — History, workout edit, measurements, statistics
* **Objective:** cover data viewing/editing and the date-sensitive features.
* **Scenarios:** WRK-011, 014, 015, 016, 017, 018, 019, 021, 023, 024 · MEA-001–009 · STA-001, 002.
  (WRK-016 and the confirm part of WRK-017 need AC-6 / AC-4 first.)
* **Infra:** `seedWorkouts`/`seedMeasurements` with fixed dates; `clock`;
  non-UTC `timezoneId` case.
* **Depends on:** M0, M2. **Complexity:** L.
* **Outcome:** history/pagination/detail/edit/delete and measurement CRUD guarded;
  week/date logic pinned.
* **Validation:** run MEA-009 and STA-001 under two time zones; WRK-018 shows 20
  then 25 rows.
* **DoD:** common DoD; AC-6 and AC-7 landed before WRK-016 / STA-001 are written.

### M5 — Failure states & Google stub
* **Objective:** the paths users hit when things go wrong, plus Google UI flows
  without Google.
* **Scenarios:** NAV-003, 005, 006, 007, 008 · AUTH-006, 007, 008, 009, 010 ·
  WRK-012, 013 · CAT-007.
* **Infra:** `google-stub.js`; route-mock helpers (delay, 500, 401).
* **Depends on:** M1–M3. **Complexity:** M.
* **Outcome:** no silent failures: every injected error yields the documented UI
  and recovers.
* **Validation:** AUTH-008 leaves a **real** session (reload stays signed in);
  external-host guard reports zero Google requests.
* **DoD:** common DoD.

### M6 — Hevy integration UI
* **Objective:** the sync/import UI contract and the local CSV path.
* **Scenarios:** HEV-001–013.
* **Infra:** `hevy-mocks.js` (Tier 1), `hevy-workouts.fixture.csv` (Tier 2);
  default-abort route on `**/api/import/hevy/**`.
* **Depends on:** M0, M4 (history assertions). **Complexity:** L.
* **Outcome:** connect/sync/error/duplicate-guard/toggle-rollback/CSV import &
  flush protected without any external call.
* **Validation:** HEV-007 asserts one request; HEV-011 asserts no new rows.
* **DoD:** common DoD; Q-3 answered or explicitly deferred (Tier 2 for the API
  path stays out of scope).

### M7 — Mobile viewport
* **Objective:** the phone experience on emulation.
* **Scenarios:** MOB-001–006 (MOB-004/005 start with a spike).
* **Infra:** `mobile-chromium` project; touch-drag helper.
* **Depends on:** M2. **Complexity:** M (+ spike for gestures).
* **Outcome:** core loop and layout rules hold at 360×740; swipe-delete works by
  touch.
* **Validation:** MOB-002 fails when a view is given a fixed width in a scratch
  change.
* **DoD:** common DoD; §7.6 device checklist handed to the owner.

### M8 — PWA & offline
* **Objective:** guard the offline workout feature and shell behaviour.
* **Scenarios:** OFF-001–009.
* **Infra:** `pwa` project (SW allowed); offline helper; **spike first** for
  `setOffline` + SW interaction and route interception.
* **Depends on:** M2, M4. **Complexity:** XL.
* **Outcome:** offline build→finish→reconnect uploads exactly once; cold offline
  boot shows the documented state.
* **Validation:** repeat OFF-004/005 ×20 (most race-prone pair).
* **DoD:** common DoD; spike result written back into §4.I; OFF-007 may end as a
  manual checklist item.

### M9 — Accessibility
* **Objective:** keyboard/focus/ARIA baseline and tracked findings.
* **Scenarios:** A11Y-001–004.
* **Infra:** none beyond helpers; decision on `@axe-core/playwright` (default:
  not adding).
* **Depends on:** M2, M3. **Complexity:** M.
* **Outcome:** passing keyboard/dialog tests; A11Y-003/004 pass as ordinary
  tests once AC-8 has landed (no `test.fail()` needed).
* **Validation:** a tracked `test.fail()` flips to "unexpectedly passed" when the
  labels are fixed.
* **DoD:** common DoD.

### M10 — Scale-out hardening
* **Objective:** only if the suite grows slow or flaky.
* **Scenarios:** AUTH-012 (optional second server).
* **Infra:** worker-scoped server+DB fixture (`basePort + workerIndex`);
  `fullyParallel`.
* **Depends on:** M1–M9 as needed. **Complexity:** M.
* **Outcome:** parallel, still deterministic.
* **Validation:** full suite passes with `--workers=4` ×5 consecutive runs.
* **DoD:** common DoD.

**Scheduling coverage check:** M1 (10) + M2 (11) + M3 (15) + M4 (21) + M5 (13) +
M6 (13) + M7 (6) + M8 (9) + M9 (4) + M10 (1) = **103**.

---

## 9. Product-owner questions

### 9.0 Decisions log (answered questions)

| ID | Decision (owner) | Consequence |
|---|---|---|
| D-1 (Q-1) | The demo button must **never** appear in production. | **App change AC-1** (outside this plan's scope, needs owner go-ahead): the client must not default `devLoginEnabled` to `true` when `/api/auth/config` fails — `app.js boot()` and `login.js` both have that fallback. A failed config fetch shows an explicit error + retry instead. Touches `public/` ⇒ shell hash + `CACHE_VERSION` bump. AUTH-007 is extended to cover it and is scheduled in M5 **after** AC-1. Server side is already safe (`allowDevLogin` is forced off when `NODE_ENV=production`). |
| D-2 (Q-2) | When a session expires mid-use the user must be told: show a toast `Tu sesión ha caducado. Vuelve a entrar.` on the redirect to login. | **App change AC-2**: `handleUnauthorized()` in `app.js` shows the toast (needs a `toast` import). Same `public/` shell bump as AC-1 — do both in one change. AUTH-005 asserts redirect **and** message once AC-2 exists. Open sub-point to check when implementing: a 401 while set edits are pending must not lose the local snapshot (IndexedDB already mirrors the active workout). |
| D-3 (Q-3) | **No `HEVY_BASE_URL`; the server is not changed for testing.** | Hevy E2E stays as planned: Tier 1 (mocked `/api/import/hevy/**` UI contract) + Tier 2 (real local CSV import). The server-side sync logic stays covered by `test/hevy-*.test.js` (injected `fetchImpl`). The API-key → server → Hevy wiring is not exercised end-to-end; reopen only if a bug appears there. No app/server change, no shell bump. |
| D-4 (Q-4) | **Keep current behaviour**: an abandoned workout stays active indefinitely and its duration is wall-clock from `startedAt`. | No app change. Tests assert only that the workout stays active and resumable (WRK-006, OFF-008) and do not pin duration semantics. Known consequence, accepted: a workout finished days later records an inflated duration. |
| D-5 (Q-5) | **The app must open and work for the last known user when launched with no network** (gym with no signal, or relaunch after the OS evicts the PWA). | **App change AC-3** (separate task, the largest of the app changes): persist the signed-in user's `{id, name}` locally at login; if `/api/auth/me` fails with status 0, boot with that user in offline mode instead of `offlineScreen`; clear it on logout (same place that already wipes offline data) and on any 401. Touches `public/` ⇒ shell bump. Security note: on a shared device the last user stays remembered until logout; offline data is already per-user. **Before implementing**, confirm the current behaviour with the OFF-002 characterization run. OFF-002 is promoted to **P0**; OFF-004 gains a "launched cold while offline" variant. |
| D-6 (Q-6) | **Confirm exercise removal only when editing a finished workout.** The active screen keeps immediate removal (reached through ⋯ → red item); deleting a single set stays immediate everywhere. | **App change AC-4**: `workout.js` edit mode asks `confirmDialog` (danger) before `data-delete-exercise` calls the API. Same `public/` shell bump as AC-1/2/3. WRK-017 covers it; WRK-007 keeps asserting immediate removal on the active screen. |
| D-7 (Q-7) | **Logout tries to upload a pending offline workout first; if it cannot, it warns before discarding.** | **App change AC-5**: `logout()` (and the confirm in `profile.js`, online and offline variants) runs `syncFinishedOffline` best-effort when online before `clearOfflineData()`; if a local workout (finished-offline *or* still in progress) remains un-uploaded, the confirm dialog says it will be lost and the user decides. Same `public/` shell bump as AC-1…4. OFF-009 is extended accordingly. |
| D-8 (Q-8) | **Editing a finished workout uses the same numeric rules as the active screen.** | **App change AC-6**: `workout.js editSetRow` switches weight/reps to text inputs with `inputmode` + `parseDecimalInput` (comma or point, invalid flagged and not saved, negative → 0, reps rounded). Same `public/` shell bump. WRK-016 is no longer blocked; scheduled in M4 after AC-6. |
| D-9 (Q-9) | **Weekly statistics use the user's local weeks.** The client sends its IANA time zone; instants stay in UTC everywhere. | **App change AC-7**: `public/js/api.js` adds `tz` (from `Intl.DateTimeFormat().resolvedOptions().timeZone`) to `stats.overview`; `server/routes/stats.js` derives each workout's local date with `Intl` and buckets by the local Monday (invalid/missing `tz` → UTC). `weekStart` stays a date-only key, so `weekRangeLabel` is unchanged. Needs a server test for `tz`, plus the E2E case in STA-001. Same shell bump as AC-1…6. |
| D-10 (Q-10) | **E2E stays advisory; `deploy.yml` is not changed.** `@smoke` runs on every push to `main`, the full suite on PR and manual dispatch. | CI change (in `ci.yml` only, done by the owner on-device, not validated here): add the `@smoke` run on push to `main`, plus artifact upload (F-3). **Promotion criterion to reconsider gating the deploy with `@smoke`:** 20 consecutive green runs with no flaky report. |
| D-11 (Q-11) | **Fix the three accessibility gaps.** | **App change AC-8**: associate every form `<label>` with its input (`for`/`id`) in measurements, routine editor and finished-workout edit; give the toast container `role="status"` + `aria-live="polite"`; add `aria-current="page"` to the active bottom-nav item. Same `public/` shell bump as the other AC items. A11Y-003/004 become ordinary tests; `getByLabel` becomes usable in those forms. |
| D-12 (Q-12) | **Add a WebKit project for a subset only**: `@smoke` + the core loop (WRK-002). PWA/offline and the full suite stay Chromium-only; real-iPhone checks stay on the manual list (§7.6). | Config: `webkit` project with `grep` on `@smoke`/`@webkit` tag; scheduled in M2. WebKit is not iOS Safari (no iOS keyboard, safe areas, standalone mode, or iOS storage/SW limits). The Playwright image already bundles WebKit, so the `e2e` image does not grow. If WebKit proves flaky it is quarantined per §7.3 rather than widened. |
| D-13 (Q-13) | **Starting a workout while one is active shows a message** before landing on the existing one. | **App change AC-9**: in `training.js`, both the empty-start and routine-start 409 branches show a toast (the server message `Ya tienes un entrenamiento en curso`) and then navigate to the active screen. Same shell bump. (Observation: `home.js` contains an unused `startEmpty` copy of that logic; remove or leave, owner's call — not needed for this plan.) |
| D-14 (Q-14) | **Keep Hevy sync failures visible only in the Profile status line.** | No app change. HEV-006 asserts the error/warning lines in Profile only. |
| D-15 (after Q-10) | **E2E runs locally only; no Docker `e2e` stage and no CI `e2e` job for now.** Reason: the first `docker build` of the Playwright image on the CI/production host failed with `no space left on device`, and that host is the production machine. Supersedes the CI parts of D-10 and the Docker/CI items of the plan (F-3, F-10, §7.2, the artifact and `@smoke`-on-push work in M0). | The pilot's `Dockerfile` stage and `ci.yml` job were removed (the stage had also been placed after `runner`, so a plain `docker build` — deploy, compose — would have built the Playwright image as the app). `AGENTS.md` now says: run `npm run test:e2e` locally. If CI is wanted later, the preferred route is a GitHub-hosted runner with `npx playwright install --with-deps chromium` (no image, no disk on the production host). Everything else in the plan is unchanged. |

### 9.1 Question register (all answered)

Each question names the evidence and the scenarios it affected. All 14 were
answered by the owner; the resulting decisions are in §9.0 and the app changes
they imply in §8.0. I did **not** invent expected behaviour.

| ID | Question | Evidence in the code | Affects | Resolution |
|---|---|---|---|---|
| Q-1 | ~~If `/api/auth/config` cannot be fetched, should the login screen still show the demo button?~~ **ANSWERED → D-1** | `boot()` and `login.js` fall back to `devLoginEnabled: true` on config failure. The server already forces `allowDevLogin` off in production (`server/config.js:26-27`), so the client fallback is the only path that can show the demo button there | AUTH-007 | See D-1 |
| Q-2 | ~~When a session expires mid-use, should the user be told why?~~ **ANSWERED → D-2** | `handleUnauthorized()` just navigates to `#/login`; `errorMessage` has a "Tu sesión ha caducado" string that this path never shows | AUTH-005 | See D-2 |
| Q-3 | ~~May we add an env-gated `HEVY_BASE_URL`…~~ **ANSWERED → D-3** | Base URL not configurable (`hevy-client.js DEFAULT_BASE_URL`; `routes/import.js:138`, `hevy-sync.js:30`) | HEV-002–009 depth | See D-3 |
| Q-4 | ~~What should happen to a workout the user abandons?~~ **ANSWERED → D-4** | One active workout per user; timer is wall-clock from `startedAt`; `finishWorkout` computes `now − started_at` unless the client sends `durationSeconds`; no expiry logic found | WRK-006, OFF-008 | See D-4 |
| Q-5 | ~~Cold start with no network and no successful `/api/auth/me`~~ **ANSWERED → D-5** | `boot()` shows `offlineScreen` when `me` fails with status 0; the local workout snapshot is keyed by the `userId` that only `me` provides; README promises offline use in a gym with no signal | OFF-002, OFF-004 | See D-5 |
| Q-6 | ~~Should `Eliminar Ejercicio` ask for confirmation?~~ **ANSWERED → D-6** | Entity-level deletes confirm; set/exercise deletes do not. In finished-workout edit mode a single tap on the trash icon (`data-delete-exercise`) removes an exercise with its sets | WRK-007, WRK-017 | See D-6 |
| Q-7 | ~~On logout, what about a workout finished offline but not yet uploaded?~~ **ANSWERED → D-7** | `logout()` → `clearAll()` clears the active-workout store including `finishedOffline` items; logout is reachable offline | OFF-009 | See D-7 |
| Q-8 | ~~Editing numbers on a finished workout: which behaviour?~~ **ANSWERED → D-8** | `workout.js editSetRow` uses `type="number"` + `Number(value)` (comma handling is browser-dependent; headless Chromium: `72,5` → `725`); `active.js` uses a text input + `parseDecimalInput` | WRK-016 | See D-8 |
| Q-9 | ~~Should weekly statistics use UTC weeks or local weeks?~~ **ANSWERED → D-9** | `server/routes/stats.js` buckets weeks with `getUTCDay`; `weekRangeLabel` renders in UTC; date inputs are local | STA-001, MEA-009 | See D-9 |
| Q-10 | ~~Should a failing E2E run block deploys?~~ **ANSWERED → D-10** | `deploy.yml` and `ci.yml` are independent triggers on push to `main`; deploy gate runs only `npm test` | CI design (§7.2) | See D-10 |
| Q-11 | ~~Are the accessibility findings to be fixed?~~ **ANSWERED → D-11** | §3.2 | A11Y-003, 004, NAV-002 | See D-11 |
| Q-12 | ~~Chromium only, or also WebKit?~~ **ANSWERED → D-12** | README documents iOS home-screen install | MOB, OFF | See D-12 |
| Q-13 | ~~Should starting a workout while one is active tell the user?~~ **ANSWERED → D-13** | `training.js` `startEmpty`/`startRoutine` navigate to `/workout/active` on 409 with no message (`home.js` has an unused `startEmpty` with the same pattern) | WRK-006 | See D-13 |
| Q-14 | ~~Should failed Hevy background syncs surface outside Profile?~~ **ANSWERED → D-14** | `lastStatus`/`lastError` only rendered in the connected card | HEV-006 | See D-14 |

---

## 10. Assumptions, limitations & open questions

### 10.1 Assumptions

1. The app remains single-user, Node/Express/SQLite/vanilla-JS/PWA, with no build
   step (`AGENTS.md`); all test code is plain JS ESM with no new dependency.
2. `ALLOW_DEV_LOGIN=true` only in the test `webServer` environment; production
   keeps it off. Test-only mechanisms never live in `server/` or `public/`.
3. Sessions created through `POST /api/auth/dev` behave like Google sessions for
   every authenticated screen (same cookie, same middleware).
4. The seeded catalog uses the same table/columns the production sync fills; the
   dataset shape is learnable from `test/catalog.test.js` (Spike).
5. Playwright 1.56 features used (`page.clock`, `tag`, `toMatchAriaSnapshot`,
   `serviceWorkers`, `reducedMotion`) are available at the pinned version.

### 10.2 What was verified in this analysis (by reading code unless stated)

Router/guards, boot sequence, API client contract, shared UI primitives, the
views listed in §2, the SW file, the offline sync and snapshot modules, auth
route and verification function, Hevy client construction sites, catalog status
logic, the `playwright.config.js`, spec, Dockerfile stage and workflows, and
which accessibility attributes exist (by grep). The two existing specs were
executed earlier in the session (2 passed, Node 18, Chromium).

### 10.3 Not verified / not executed (do not treat as facts)

* The `e2e` Docker target build, the bundled Node version of the Playwright
  image, and the CI `e2e` job on the self-hosted runner.
* Interaction of `context.setOffline` with the service worker and with
  `page.route` in the pinned Chromium (**spike, M8**).
* Reset-endpoint completeness and cost; whether `syncCatalog({dataset})` avoids
  every network call; the exact dataset schema.
* Touch gestures (swipe, pull-to-refresh) under Playwright emulation.
* Whether the routines IndexedDB cache is cleared on logout — `clearAll()` was
  read to clear the active-workout and catalog stores only; the routines cache
  module was not read in full (relevant to OFF-009).
* No new tests were run for this document; no application behaviour was changed.

### 10.4 Out of scope

Native iOS/Apple Health (project "won't-do"); real Google/Hevy integration
tests; load/performance testing; visual pixel regression of charts (optional,
P2, environment-sensitive); server business rules already covered by
`node --test`.
