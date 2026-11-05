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
| `ALLOW_DEV_LOGIN` | `true` enables the test login without Google. |
| `COOKIE_SECURE` | `true` when serving over HTTPS. |
| `SESSION_DAYS` | Session duration in days. |
| `SESSION_SECRET` | Internal session secret. |
| `CATALOG_SYNC_DAYS` | Days before the catalog is re-synced in the background (default `14`). |

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

- **Persistence**: the SQLite database lives in the `fitness-data` volume
  (mounted at `/app/data`), so it survives `down`/`up`. To start fresh:
  `docker compose down -v`.
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

## Google login (optional)

1. In [Google Cloud Console](https://console.cloud.google.com/) create a
   project and configure the **OAuth consent screen** (External type). Add
   your account as a *test user* while it is in Testing mode.
2. Create credentials **OAuth client ID → Web application** and add your
   origin (e.g. `http://localhost:3000`) to **Authorized JavaScript origins**.
3. Paste the Client ID into `GOOGLE_CLIENT_ID` in `.env` and restart the
   server.

The flow uses Google Identity Services (Client ID only, **no client secret**):
the browser obtains an ID token and the server verifies it with the official
library. Without `GOOGLE_CLIENT_ID`, development falls back to the "demo mode"
button.

## Production

- `NODE_ENV=production`, `COOKIE_SECURE=true` (with HTTPS) and
  `ALLOW_DEV_LOGIN=false`.
- Set your own strong `SESSION_SECRET`.
- Add your real domain to the authorized origins in Google Cloud.
