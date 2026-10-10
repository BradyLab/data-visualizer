# backend-express

REST API for the data visualizer: users and login, datasets, per-dataset permissions, file uploads, and an
activity log. Also serves live updates over Socket.IO.

Stack: Node (ESM, TypeScript run with `tsx`), Express 5, Sequelize (`sequelize-typescript`) on PostgreSQL,
Socket.IO, [`@tus/server`](https://github.com/tus/tus-node-server) for resumable uploads, JWT auth,
`express-rate-limit` backed by Postgres.

## Running locally

Requires Node 22.18+ (or 24.12+) and a running PostgreSQL.

```sh
cp .env.example .env      # then edit
npm install
npm run db:migrate
npm run db:seed
npm run dev               # tsx watch, http://localhost:3001
```

`npm run build` compiles to `dist/` and `npm start` runs it. Or run everything with Docker from the repo root
(`docker compose up`, see the root README).

## Environment (`.env`)

| Variable | Meaning |
| --- | --- |
| `API_PORT` | Port to listen on (default 3001) |
| `BACKEND_URL` / `FRONTEND_URL` | Public URLs. `FRONTEND_URL` is the only CORS origin allowed; the server refuses to start without it |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | PostgreSQL connection |
| `DEFAULT_PASSWORD` | Password given to invited and seeded users until they change it |
| `JWT_SECRET` | Signing secret for login tokens; the server refuses to start without it |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `UPLOAD_DIR` | Where uploads are stored (default `/data/uploads`); `rds/`, `cover/` and `tmp/` are created inside |
| `UPLOAD_MAX_BYTES` | Largest accepted upload (default 30 GiB) |

`.env.example` has working defaults for local development; change `JWT_SECRET` and `DEFAULT_PASSWORD` anywhere else.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Run with file watching |
| `build` / `start` | Compile with `tsc` / run `dist/index.js` |
| `db:migrate`, `db:migrate:undo` | Apply / revert the latest migration (Sequelize CLI) |
| `db:seed` | Seed development users (`seeders/`) |
| `db:seed:e2e`, `e2e:start` | Seed and start for the Playwright tests (`seeders-e2e/`); used by the frontend e2e setup |
| `format`, `format:check` | Prettier |

There are no backend unit tests yet; the API is covered by the e2e suite in `../frontend/e2e/`.

## Source layout (`src/`)

Imports use the `@src/` and `@commons/` aliases (`@commons` is `../commons`).

| Folder | Role |
| --- | --- |
| `index.ts` | App setup, CORS, error handler, router mounting, server start |
| `routers/` | Route tables with the auth/role middleware for each endpoint |
| `controllers/` | Request handling and validation |
| `services/` | Business logic: `access` (dataset access rules), `auth`, `dataset`, `file`, `permission`, `user`, `activity`, `storage` (files on disk), `tus` (uploads), `socket` (Socket.IO) |
| `models/` | Sequelize models: `Users`, `Datasets`, `Permissions`, `Files`, `Activities` |
| `middleware/` | `auth` (`requireAuth`, `optionalAuth`, `requireRole`, `requireSelfOrAdmin`) and login/password rate limiters |
| `utils/` | Password hashing and small helpers |

Also at the project root: `migrations/` (schema; the app never calls `sequelize.sync()`) and `seeders/`.

## API

All routes are under `/api/<resource>`; resource names come from `commons/general.ts`. Plus `GET /health`.

| Resource | Notable endpoints |
| --- | --- |
| `auth` | `POST /login`, `GET /me`, `POST /logout`, `POST /change-password` |
| `users` | CRUD (admin only), `GET /names` (admins and lab members), users can read and rename themselves |
| `datasets` | `GET /` and `GET /:id` and `GET /byURL/:url` (guests see public ones), create (admin/lab member), update (EDIT), delete (OWNER) |
| `permissions` | Grant/change/revoke a user's access to a dataset (OWNER), `byUser`, `byDataset` |
| `files` | List/get/update/delete, `GET /current/:datasetId/:type/content` to download, `POST .../download-token` for browser downloads |
| `files/upload` | tus endpoint for resumable uploads (metadata: `dataset_id`, `type`, `filename`, optional `version`, `updates`) |
| `activities` | Read-only activity log (admin, or a user's own) |

Authentication is a `Bearer` JWT from `/auth/login`. Users in the `INVITED` state get a `403` with code
`PASSWORD_CHANGE_REQUIRED` everywhere except `/auth/me`, `/auth/logout` and `/auth/change-password` until they change the default password.

## Things worth knowing

- **Access control** is centralized in `services/access.ts`. A dataset a caller cannot see returns `404`, not `403`, so private datasets are not revealed.
- **File storage:** files live on disk as `<UPLOAD_DIR>/{rds,cover}/<dataset_id>_<TYPE>_v<version>.<ext>`; the `Files` row is the source of truth. Only the current version is kept on disk. RDS files must be `.rds`; covers are images up to 20 MB.
- **Uploads** go to `<UPLOAD_DIR>/tmp` first and are moved into place once complete. Unfinished uploads expire after 48 hours and are swept hourly. Node's request/socket timeouts are disabled so multi-GB uploads are not cut off.
- **Rate limiting:** 10 failed logins per 15 min per IP, 5 per account, and 5 failed password changes per user. Counters are stored in Postgres, so they survive restarts. Behind a reverse proxy, set `trust proxy` in `index.ts` or all clients share one IP.
- **Websockets:** the server decides each socket's rooms from its token; clients only listen. Event names and payloads are in `commons/socket.ts`.
- **Known issue:** `start()` runs on import of `index.ts`, so importing `get()` in a test also connects to the DB and listens.
- **Schema changes:** add a new numbered file in `migrations/` rather than editing an applied one.
