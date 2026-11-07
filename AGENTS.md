# AGENTS.md

Guidance for AI agents (and humans) working in this repository. Read this
before making changes. The `README.md` documents the product and operations;
this file documents **how to work here**.

## What this project is

Fitlog is a **single-user personal** workout tracker. Keep solutions
proportionate to that: prefer the simplest thing that works, and do not
over-engineer (no speculative abstractions, no defensive layers the task does
not need, no scaling machinery for one user).

Stack — do **not** migrate away from any of these:

- **Backend:** Node.js (>= 18, 20 recommended) + Express 4.x.
- **Database:** SQLite via `better-sqlite3` (synchronous API), WAL mode.
- **Frontend:** build-less, native ES modules, vanilla JS. **No bundler, no
  framework, no transpiler.** `public/js/app.js` imports every module
  statically.
- **PWA:** installable, offline shell via `public/sw.js`.

There is no build step. What is in the repo is what runs.

## Golden rules

1. **Proportionate, not over-engineered.** This is one person's app. Match the
   size of the solution to the size of the problem.
2. **No stack/DB/framework migration.** Stay on Node/Express/SQLite/vanilla-JS/PWA.
3. **Language split:**
   - Code comments, test names, commit messages, and this kind of docs → **English**.
   - UI strings shown to the user → **Spanish**. (Catalog exercise names stay in
     English, as the README notes.)
   - Conversational replies to the owner → Spanish.
4. **Do not reference internal planning docs in shipped artifacts.** Never put
   roadmap task IDs (e.g. "P1-09") or internal technical-doc section numbers in
   code, comments, test names, or commit messages. Describe the *what/why*
   directly instead.
5. **Verify before claiming done.** Run the suite; for things that cannot run in
   a dev/sandbox environment (Docker, GitHub Actions, a real browser), say so
   explicitly and state what *was* validated.
6. **Commit only your own verified work; never push.** The owner pushes
   manually. Commit locally once work is verified.
7. **Flag high-risk/irreversible actions** (destructive git, data deletion,
   production/infra changes) and wait for confirmation. Correct the owner when
   something is wrong rather than agreeing.

## Commands

```bash
npm install
npm start                # run (node server/index.js)
npm run dev              # auto-reload (node --watch)
npm test                 # full suite (node --test). MUST stay green.
npm run test:e2e         # browser E2E (Playwright, Chromium). Boots the app
                         #   itself; run locally or via the Dockerfile `e2e`
                         #   target (browsers baked into that image).
npm run sync:exercises   # sync free-exercise-db catalog
npm run seed:demo        # sample data
npm run migrate          # apply schema migrations (also run on boot)
npm run backup:db        # timestamped DB backup + retention
npm run backup:verify    # restore newest backup to temp and integrity-check it
```

Run a single test file: `node --test test/<file>.test.js`.
Syntax-check a file without running: `node --check path/to/file.js`.

The test suite is the deploy gate (runs in CI before anything is rebuilt), so
**a red suite blocks deploys**. Keep it at a full pass.

## Layout

- `server/` — Express app, routes, services, DB access, Hevy import/sync, auth,
  migrations.
  - `server/services/` — business logic (e.g. `workouts.js`).
  - `server/routes/` — HTTP handlers.
- `public/` — the frontend served as-is.
  - `public/js/` — ES modules. `app.js` is the static entry that imports the rest.
  - `public/js/views/` — per-view controllers.
  - `public/js/offline/` — IndexedDB caches for offline use.
  - `public/sw.js` — service worker + the PRECACHE shell list.
  - `public/css/` — stylesheets.
- `test/` — `node --test` files.
- `scripts/` — operational scripts (backup/verify).
- `docs/` — internal planning/technical docs. **Do not cite these in code or
  commits** (see golden rule 4).
- `.github/workflows/deploy.yml` — self-hosted, pull-based deploy.
- `docker-compose.yml` — `app` + optional `cloudflared`.

## The PWA shell cache — ALWAYS honor this

The shell assets are **not** content-hashed. Two constants in `public/sw.js`
keep installed clients from running a stale, half-updated shell:

- `CACHE_VERSION` (e.g. `fitlog-v24`) — bump it to force clients to drop the old
  cache.
- `SHELL_HASH` (e.g. `6621f1667021394a`) — a fingerprint of every precached
  shell file.

**Whenever you add, remove, or edit any file in the shell** (anything under
`public/js`, the CSS, `index.html`, etc.):

1. If you **added** a `public/js` module, add it to the `PRECACHE` array in
   `public/sw.js` (the test enforces that PRECACHE covers every module).
2. **Recompute `SHELL_HASH`** and **bump `CACHE_VERSION`**.

`test/pwa-shell.test.js` guards all of this: it fails if PRECACHE misses a
module, if a precached path is missing on disk, or if `SHELL_HASH` has drifted.
Recompute the hash by running that test and reading the `expected:` value it
reports, then paste it into `sw.js` and bump `CACHE_VERSION`:

```bash
node --test test/pwa-shell.test.js 2>&1 | grep -E "expected:|# (pass|fail)"
```

Compose/workflow files and server code are **not** part of the shell — changing
them does not require a hash/version bump.

## Dependencies & security

- Dependency versions are **pinned exactly** in `package.json` (no `^`/`~`).
  Keep it that way, and commit the updated `package-lock.json`.
- `engines.node` is `>=18`; the Docker image is Node 20. **Do not add a
  dependency (or a dependency version) that requires Node >= 22.** When bumping
  a package to clear an advisory, check its transitive `engines` — pick the
  newest version that still runs on Node 18/20 rather than the absolute latest.
- Keep `npm audit` at **0 vulnerabilities**. Prefer the smallest bump that
  clears the advisory (a same-major patch) over a major jump; only take a major
  bump when necessary and after checking our actual usage still compiles and the
  engines constraint holds.
- Treat anything that touches auth (`server/auth.js`), data handling, or the
  deploy as security-sensitive: state what was verified and what could not be.

## Deploy (context for infra changes)

Deploy is **pull-based** on a **self-hosted GitHub Actions runner** on the prod
host (no inbound ports; the app sits behind a Cloudflare Tunnel). The workflow
builds a per-commit image `fitness-app:<sha>`, health-checks it, and **rolls
back** to the previous image if it is unhealthy. The image tag is parameterised
via the `APP_IMAGE` compose variable (`${APP_IMAGE:-fitness-app:local}` locally).

Invariants to preserve when editing `deploy.yml` / `docker-compose.yml`:

- Never touch the `cloudflared` service or the `./data` bind mount during a
  deploy; the SQLite DB lives in `./data` and must survive.
- The host's Docker **bridge network has no Internet** — builds use
  `--network=host` (and compose `build.network: host`). Keep that.
- `.env` and `./data` are untracked and must stay that way.

These cannot be exercised in a sandbox (no runner/Docker/browser). Validate YAML
and `docker compose config` locally and tell the owner to verify the real deploy
on-device.

## Won't-do

- **Native Apple Health / iOS app integration.** Fitlog stays a PWA; it is not a
  native iOS app, so Apple Health integration is out of scope.

## Before you finish

- [ ] `npm test` is fully green.
- [ ] If any shell file changed: PRECACHE updated, `SHELL_HASH` recomputed,
      `CACHE_VERSION` bumped, and `test/pwa-shell.test.js` passes.
- [ ] `npm audit` reports 0 vulnerabilities (if you touched dependencies).
- [ ] UI strings in Spanish; comments/tests/commit message in English with no
      internal doc/roadmap IDs.
- [ ] Changes committed locally (not pushed), with a clear message.
- [ ] Anything unverifiable here (Docker/CI/browser) is called out to the owner.
