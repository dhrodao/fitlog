# Fitlog

Personal app to track workouts, routines, weights and body measurements.
Backend in Node.js + Express with SQLite (`better-sqlite3`) and a lightweight
build-less frontend (native ES modules). Exercise catalog from
[wger.de](https://wger.de) (CC-BY-SA). The user-facing UI is in Spanish.

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
npm run sync:exercises   # sync the wger catalog
npm run seed:demo        # sample data
npm test                 # tests (node --test)
```

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
  (required for `npm ci` and to sync the wger catalog). With host networking
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
