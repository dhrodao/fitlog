# Fitlog

Personal app to track workouts, routines, weights and body measurements.
Backend in Node.js + Express with SQLite (`better-sqlite3`) and a lightweight
build-less frontend (native ES modules). Exercise catalog and images from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (Unlicense).
The user-facing UI is in Spanish; catalog exercise names remain in English.

## Requirements

- Node.js >= 18 (20 recommended), **or** Docker + Docker Compose.

## Configuration (`.env`)

Copy the example and adjust the values:

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `PORT` | Server port (default `3000`). |
| `NODE_ENV` | `development` or `production`. |
| `DB_PATH` | SQLite file path (relative to the project root). |
| `GOOGLE_CLIENT_ID` | OAuth Client ID (Web type). Empty = demo login only. |
| `ALLOWED_EMAILS` | Comma-separated list of verified Google emails allowed to sign in. Empty = Google login locked (unless `ALLOW_ANY_GOOGLE_USER`). |
| `ALLOW_ANY_GOOGLE_USER` | `true` accepts any verified Google account (public instance). |
| `ALLOW_DEV_LOGIN` | Exactly `true` enables the test login without Google. Never active in production. |
| `COOKIE_SECURE` | `true` when serving over HTTPS. |
| `SESSION_DAYS` | Session duration in days. |
| `SESSION_SECRET` | Internal session secret. |
| `CATALOG_SYNC_DAYS` | Days before the catalog is re-synced in the background (default `14`). |
| `PUBLIC_URL` | Public HTTPS base URL (no trailing slash). Required for Hevy real-time webhooks. |
| `HEVY_REQUEST_TIMEOUT_MS` | Per-request timeout for Hevy API calls (default `20000`). |
| `HEVY_MAX_RETRIES` | Retries for a retriable Hevy read — 429/5xx/network (default `3`). |
| `HEVY_RETRY_BACKOFF_MS` | Base backoff for the retry schedule, with jitter (default `500`). |

## Run locally (Node)

```bash
npm install
npm run dev     # with auto-reload (node --watch)
# or
npm start
```

The app is served at `http://localhost:3000`.

Useful scripts:

```bash
npm run sync:exercises   # sync the free-exercise-db catalog
npm run seed:demo        # sample data
npm test                 # tests (node --test)
```

### Exercise catalog

`npm run sync:exercises` downloads `dist/exercises.json` from
[`free-exercise-db`](https://github.com/yuhonas/free-exercise-db) and upserts
all 876 exercises. The dataset is pinned to a fixed commit; image files are
fetched from jsDelivr on demand, cached next to the database
(`data/exercise-images`) and served by the app itself through
`/api/exercises/image/...`, so the browser does not need direct access to the
CDN.

Catalog names and instructions are in English. The app derives the Spanish
muscle category (`Pecho`, `Espalda`, `Piernas`…) from the first primary muscle,
and translates muscle and equipment labels in the UI.

The user's own exercises keep their Spanish names. The mapping from those names
to free-exercise-db ids lives in
[`server/user-exercise-aliases.json`](server/user-exercise-aliases.json); it is
applied by normalized name during the sync, so existing exercises are linked to
the catalog and receive an image without creating duplicates.

The sync is idempotent; run it again after changing the pinned commit or the
aliases.

## Run with Docker Compose

```bash
cp .env.example .env     # set your variables
docker compose up -d     # build and start in the background
docker compose logs -f   # follow logs
docker compose down      # stop (data is preserved)
```

Rebuild after code or dependency changes:

```bash
docker compose build --no-cache
docker compose up -d
```

Docker setup details:

- **Persistence**: the SQLite database is stored on the host via a bind mount
  (`./data` on the host → `/app/data` in the container), so `data/fitness.db`
  lives in the project's `data/` directory and survives `down`/`up`. It is
  directly visible and easy to back up from the host (just copy the file, ideally
  with the app stopped or using `sqlite3 ... ".backup"` for WAL consistency).
  The container runs as the non-root `node` user (UID/GID 1000); on single-user
  Linux hosts that matches the host user, so SQLite can write without extra
  tweaks. To start fresh, stop the stack and delete `data/fitness.db`.
- **Host network**: both the build and the runtime use `network_mode: host`
  because this machine's Docker *bridge* network has no Internet access
  (required for `npm ci` and to sync the exercise catalog). With host networking
  the app is reachable directly on the `.env` `PORT` (e.g.
  `http://localhost:3000`) and the `ports` block is unused. If your bridge
  network does have Internet, you can remove `network_mode: host` and
  `build.network: host`, and uncomment the `ports` block in
  `docker-compose.yml`.
- **Health check**: probes `GET /api/health` every 30 s.
- **Image**: `node:20-bookworm-slim`, production dependencies, runs as a
  non-root user.

> Note: with `network_mode: host` the container listens on the same host
> `PORT`. Do not run `npm run dev` and the container on the same port at the
> same time.

## Database backups

The SQLite database runs in **WAL** mode (write-ahead logging): at any moment
the live state is split between `fitness.db` and its `fitness.db-wal` sidecar,
so a plain `cp` of the `.db` file while the app is running can produce an
inconsistent copy. The backup script avoids this by using SQLite's online
backup API, which captures a consistent snapshot — including the WAL — even
while the app is writing.

```bash
npm run backup:db        # create a timestamped backup + apply retention
npm run backup:verify    # restore the newest backup to a temp path and check it
```

- Backups are written to `BACKUP_DIR` (default `backups/`, gitignored because
  they contain personal data). Each file is named `fitness-<UTC-timestamp>.db`.
- Retention keeps `BACKUP_KEEP_DAILY` most recent backups plus one per ISO week
  for `BACKUP_KEEP_WEEKLY` weeks (defaults: 7 daily + 4 weekly).
- `backup:verify` copies a backup to a throwaway path, runs `integrity_check`
  and `foreign_key_check`, and prints row counts for the key tables. A backup
  you have never restored is not a backup — run it periodically.

### Scheduling

Run the backup daily from the host (the host owns the `./data` bind mount). A
systemd timer or cron entry, e.g. a daily cron:

```cron
0 4 * * *  cd /opt/fitlog && /usr/bin/node scripts/backup-db.js >> /var/log/fitlog-backup.log 2>&1
```

> **Off-host copy.** Local backups do not protect against disk loss. Copy at
> least one generation off the machine (e.g. `rsync`/`rclone` to another host
> or an encrypted object-store bucket). Restrict permissions and encrypt
> off-host copies, since they contain personal data.

### Restore

```bash
# Stop the app so nothing writes during the restore.
docker compose stop app
# Replace the live database with a backup (remove stale WAL/SHM siblings).
cp backups/fitness-<timestamp>.db data/fitness.db
rm -f data/fitness.db-wal data/fitness.db-shm
docker compose start app
```

**RPO/RTO:** with a daily backup the recovery point objective is up to 24 h of
data; the recovery time objective is a few minutes (copy one file and restart).
Tighten the RPO by scheduling the backup more frequently.

## Expose it with Cloudflare Tunnel (optional)

The Compose file includes a `cloudflared` service that publishes the app over
HTTPS without opening any inbound ports.

1. In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/)
   go to **Networks → Tunnels → Create a tunnel** (type *Cloudflared*).
2. Name the tunnel and copy its **token**.
3. Under the tunnel's **Public Hostname** tab, add a hostname (e.g.
   `fitlog.yourdomain.com`) pointing to the service `http://localhost:3000`
   (the app runs on the host network).
4. Put the token in `.env`:
   ```
   TUNNEL_TOKEN=eyJ...your-token...
   ```
5. Start everything:
   ```bash
   docker compose up -d
   ```

The `cloudflared` container also uses `network_mode: host` so it can reach both
Cloudflare's edge (outbound) and the app at `http://localhost:3000`.

When serving through the tunnel, set in `.env`:
- `COOKIE_SECURE=true` (traffic is HTTPS end to end at the edge).
- Add your tunnel hostname (e.g. `https://fitlog.yourdomain.com`) to the
  **Authorized JavaScript origins** in Google Cloud so the Google login works.

If you do not use the tunnel, leave `TUNNEL_TOKEN` empty; the `cloudflared`
service will just keep retrying and the app still works locally. To skip it
entirely, start only the app: `docker compose up -d app`.

## Automatic deploy on push (optional)

Production can redeploy itself on every push to `main` using a **self-hosted
GitHub Actions runner** installed on the production machine. Because the app
sits behind the Cloudflare Tunnel with no inbound ports, the deploy is
pull-based: GitHub cannot reach the host, so a runner living on the host picks
up the job and rebuilds the container locally.

The workflow is [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
On push to `main` (or via the **Run workflow** button — `workflow_dispatch`) it:

1. Fast-forwards the production checkout at `PROD_DIR` (`/opt/fitlog`) to
   `origin/main` (`git reset --hard`).
2. Runs the test suite in an ephemeral Node container as a gate; if it fails,
   the deploy stops before anything is rebuilt.
3. Backs up the database and applies any pending schema migrations
   (`npm run backup:db && npm run migrate`) in an ephemeral Node container that
   mounts the real `./data` and `./backups`. Doing this **before** recreating
   the container separates the schema change from serving traffic: a failed
   migration stops the deploy while the old container keeps running. (The app
   also migrates on boot, so this step is a safety net plus a pre-migration
   backup, not the only path.)
4. Builds the `app` image tagged with the commit SHA (`fitness-app:<sha>`),
   recording the image the container is currently running so it can be restored
   if the new one fails. Only the `app` service is recreated; the `cloudflared`
   service and the `./data` bind mount are left untouched.
5. Probes `GET /api/health` on the new image (up to 60 s). If it becomes
   healthy, the deploy succeeds. If it does not, the job dumps the last 60 lines
   of logs and **rolls back** to the previous image (then fails the job so the
   failure is visible). A final step prunes old per-commit image tags, keeping
   the three most recent so a rollback target is always available.

A `concurrency` group prevents two deploys from overlapping.

The `app` image tag is parameterised through the `APP_IMAGE` variable in
`docker-compose.yml` (defaults to `fitness-app:local` for local use); the
workflow sets it to the per-commit tag so build, run and rollback all target an
explicit image rather than overwriting a single floating tag.

### One-time setup on the production host

1. Register a self-hosted runner for the repo
   (**Settings → Actions → Runners → New self-hosted runner**, Linux x64).
   Do **not** run it as `root`; create a dedicated user, e.g.:
   ```bash
   useradd -m -s /bin/bash gh-runner
   usermod -aG docker gh-runner          # docker without sudo
   chown -R gh-runner:gh-runner /opt/actions-runner /opt/fitlog
   su - gh-runner
   cd /opt/actions-runner
   ./config.sh --url https://github.com/<owner>/<repo> --token <TOKEN>
   ```
2. Install it as a service so it survives reboots:
   ```bash
   cd /opt/actions-runner
   sudo ./svc.sh install gh-runner
   sudo ./svc.sh start
   ```
3. Make sure the runner user can fetch the repo at `/opt/fitlog` without
   prompting for credentials (SSH deploy key or an HTTPS credential helper) and
   can run Docker:
   ```bash
   sudo -u gh-runner git -C /opt/fitlog fetch --dry-run origin
   sudo -u gh-runner docker ps
   ```

> The deploy runs `git reset --hard origin/main` inside `/opt/fitlog`, so do
> not keep local edits to tracked files there — they are overwritten on the
> next deploy. The `.env` file and the `./data` directory (the SQLite database)
> are **not** tracked by git, so they are always preserved. Schema migrations
> are idempotent and applied on boot.

## Google login (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/) create a
   project and configure the **OAuth consent screen** (External type). Add
   your account as a *test user* while it is in Testing mode.
2. Create credentials **OAuth client ID → Web application** and add your
   origin (e.g. `http://localhost:3000`) to **Authorized JavaScript origins**.
3. Paste the Client ID into `GOOGLE_CLIENT_ID` in `.env` and restart the
   server.
4. List who may sign in: set `ALLOWED_EMAILS` to your Google address (a
   comma-separated list of verified emails). Only those accounts can create or
   use an account; everyone else is rejected with 403 and no user row is
   created. To open the instance to anyone, set `ALLOW_ANY_GOOGLE_USER=true`
   instead. In production the server refuses to boot if Google is enabled with
   neither an allowlist nor the escape hatch.

The flow uses Google Identity Services (Client ID only, **no client secret**):
the browser obtains an ID token and the server verifies it with the official
library and checks the access policy above. Without `GOOGLE_CLIENT_ID`,
development falls back to the "demo mode" button.

## Import from Hevy

You can bring your [Hevy](https://www.hevy.com/) workout history into Fitlog.

From the **Profile** view:

- **Importar de Hevy**: upload a Hevy CSV export (Hevy → Settings → Export
  Data → `workouts.csv`) or paste an API key for a one-off import. A preview
  (dry-run) shows what would be imported before writing.
- **Sincronización con Hevy**: connect your Hevy account with an API key
  (Hevy Pro → Settings → API). The key is stored encrypted at rest
  (AES-256-GCM derived from `SESSION_SECRET`). You can trigger a manual sync or
  enable automatic background sync (every 6 h). Syncs are incremental via the
  Hevy `/v1/workouts/events` feed and idempotent, so re-running never
  duplicates workouts.
- **Webhook en tiempo real**: when `PUBLIC_URL` is set, you can enable Hevy
  webhooks. Fitlog registers `PUBLIC_URL/api/hevy/webhook` with Hevy and
  stores a per-user token sent back as `Authorization: Bearer <token>`. When
  you save a workout in Hevy, Hevy POSTs `{ "workoutId": "..." }`; Fitlog
  acknowledges immediately (Hevy requires a 200 within 5 s) and runs an
  incremental sync in the background. The app must be reachable over HTTPS
  (e.g. via the Cloudflare Tunnel described above).

Exercise names from Hevy are matched to the free-exercise-db catalog (directly
or after stripping the trailing `(Equipment)` suffix); unmatched names are kept
as custom exercises. Deletions in Hevy are detected but not propagated: already
imported workouts are preserved.

Imported workouts are tagged with their origin, so from the **Profile** view
you can **delete all workouts imported from Hevy** in one click. Exercises in
your personal catalogue are kept; only the imported workouts (and their sets)
are removed. Workouts you created manually are never touched.

CLI equivalents are also available (dry-run by default; pass `--write`):

```bash
node server/import-hevy-csv.js <file.csv> --user <id> [--write]
node server/import-hevy-api.js --user <id> --api-key <KEY> [--write]
```

> Rotating `SESSION_SECRET` invalidates stored Hevy keys; just reconnect.

## Progressive Web App (PWA)

Fitlog is installable and works offline for its shell. On a phone, open the
site over HTTPS and use the browser's **Add to Home Screen**; it then launches
full-screen like a native app. The pieces live in `public/`:

- `manifest.webmanifest` — name, theme/background colours and icons
  (`assets/icon*.svg` / `assets/icon-*.png`).
- `sw.js` — the service worker. It precaches the **complete first-party shell**
  (every CSS and JS module, since `app.js` imports them statically), serves
  navigations network-first (falling back to the cached shell when offline) and
  static assets stale-while-revalidate. **API traffic (`/api/…`) is never
  cached**, so user data is always fresh and never shared between sessions. When
  the server is unreachable at launch, the app shows an explicit *offline* state
  with a retry instead of bouncing to the login screen.

### Recording a workout offline

You can start and record a full workout with no connectivity (e.g. a gym with
no signal) and sync it later:

- **Starting offline.** "Empezar Entrenamiento Vacío" works offline: the workout
  is created locally with a client-generated id. (Starting *from a routine*
  still needs the server, since routines are not cached; use an empty workout
  offline.)
- **Building offline.** The exercise catalog and your own exercises are cached
  in IndexedDB the first time you are online, so you can add exercises, add and
  edit sets, and mark them complete entirely offline. Exercise images are not
  cached, so they show a placeholder until you are back online. The "Anterior"
  (previous set) suggestions are not available offline; they reappear once the
  workout is finished and loaded online.
- **Syncing.** When you press *Terminar*, the whole workout is uploaded in one
  request to `POST /api/workouts/sync`. That endpoint is **idempotent** by a
  per-workout client id (unique per user): a retried upload — an ambiguous
  timeout, a double tap, or an upload driven at the next app launch — never
  creates a duplicate. If you finish offline, the workout is kept locally and
  uploaded automatically the next time the app launches or regains
  connectivity. Reconnecting *mid-workout* does not upload anything: the workout
  stays local and editable until you finish it.
- **Scope and cleanup.** All local data is keyed per user and wiped on logout,
  so nothing leaks between accounts on a shared device.

### Updating the service worker on deploy

The shell assets are not content-hashed, so after a deploy that changes the CSS
or JS of the shell, **bump `CACHE_VERSION` in `public/sw.js`** (e.g.
`fitlog-v1` → `fitlog-v2`) and update `SHELL_HASH` next to it. On the next load
the worker wipes the old cache and re-precaches the shell, guaranteeing
installed clients pick up the new assets instead of a stale cached copy. (The
worker already revalidates over the network, so this is a safety net for fully
offline launches and for forcing an immediate refresh.)

A test computes the shell fingerprint from the files on disk and fails if it
drifts from `SHELL_HASH`; because the test gate runs before every deploy, you
cannot ship a shell change while leaving `CACHE_VERSION` stale. The same test
asserts the precache list still covers every module under `public/js`.

## Production

- `NODE_ENV=production`, `COOKIE_SECURE=true` (with HTTPS) and
  `ALLOW_DEV_LOGIN=false`.
- Set your own strong `SESSION_SECRET`.
- Add your real domain to the authorized origins in Google Cloud.

Built-in hardening (no extra setup):

- **Secure cookies** are forced on in production: even if `COOKIE_SECURE` is
  left `false`, the session cookie is sent `Secure` (it already warns on boot).
- **Rate limiting** (in-memory, per client IP): `/api/auth` allows 40 requests
  per 15 min; `/api/import` (import + Hevy sync) allows 60 per hour. Over the
  limit returns `429` with a `Retry-After` header. Generous enough for a normal
  owner; enough to blunt brute force.
- **Origin check** on state-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`):
  when `PUBLIC_URL` is set, a cross-site request (by `Sec-Fetch-Site` or a
  mismatched `Origin`) is rejected with `403`. The Hevy webhook is exempt (it is
  server-to-server and authenticated by its own per-user token). This is a
  layer on top of the `SameSite=Lax` session cookie.
