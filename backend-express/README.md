# backend-express

REST API for the data visualizer: users and login, datasets, per-dataset permissions, file uploads, and an
activity log. Also serves live updates over Socket.IO, turns uploaded `.rds` files into plot data, and proxies the Shiny plot viewer.

Stack: Node (ESM, TypeScript run with `tsx`), Express 5, Sequelize (`sequelize-typescript`) on PostgreSQL,
Socket.IO, [`@tus/server`](https://github.com/tus/tus-node-server) for resumable uploads, JWT auth,
`express-rate-limit` backed by Postgres, `http-proxy-middleware` (Shiny proxy), EmailJS (invite emails).

## Running locally

Requires Node 24 (24.12+; the version in `.nvmrc`) and a running PostgreSQL.

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
| `API_PORT` | Port to listen on (required, no default; `.env.example` uses 3001) |
| `BACKEND_URL` / `FRONTEND_URL` | Public URLs. `FRONTEND_URL` is the only CORS origin allowed; the server refuses to start without it |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | PostgreSQL connection (all required) |
| `DEFAULT_PASSWORD` | Password given to seeded users until they change it (invited users get a random temporary password) |
| `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY` | Optional. [EmailJS](https://www.emailjs.com) settings for the invite email; all four are needed, otherwise no email is sent. See [Invite emails](#invite-emails) |
| `EMAIL_DISABLED` | Optional. `true` sends no email even if EmailJS is configured. It is also off whenever `NODE_ENV=test`; `npm test` and the e2e stack both set this so tests never call the real API |
| `JWT_SECRET` | Signing secret for login tokens; the server refuses to start without it |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `UPLOAD_DIR` | Where uploads are stored (default `/data/uploads`); `rds/`, `cover/`, `tissue/` and `tmp/` are created inside |
| `UPLOAD_MAX_BYTES` | Largest accepted upload (default 30 GiB) |
| `SHINY_URL`, `SHINY_SECRET` | Internal URL of the Shiny server and the secret shared with it. Without both, the viewer is disabled (`POST /datasets/:id/viewer` answers 503). Use the same `SHINY_SECRET` for Shiny; see [`../shiny/README.md`](../shiny/README.md) |
| `VIEWER_TICKET_EXPIRES_IN`, `VIEWER_SESSION_EXPIRES_IN` | Lifetime of the one-time viewer ticket (default `60s`) and of the viewer cookie session (default `1h`) |
| `PARQUET_DIR` | Where plot data is kept, one folder per dataset (default: a `parquet` folder next to `UPLOAD_DIR`, i.e. `/data/parquet`) |
| `PREPROCESS_COMMAND`, `PREPROCESS_SCRIPT`, `PREPROCESS_TIMEOUT_MS` | Run the R job on this machine: program (default `Rscript`), script (default `shiny/preprocess/preprocess.R`) and time limit (default 6 h) |
| `PREPROCESS_SPOOL_DIR` | Instead hand jobs to the `preprocess` worker container through this shared folder (`/data/jobs` in Docker). `PREPROCESS_PICKUP_TIMEOUT_MS` and `PREPROCESS_POLL_MS` tune how long a job may wait and how often it is checked |

The server refuses to start, listing what is missing, if `API_PORT`, any `DB_*` setting or `JWT_SECRET` is unset (or a port is not a number).

`.env.example` has working defaults for local development; change `JWT_SECRET`, `SHINY_SECRET` and `DEFAULT_PASSWORD` anywhere else.

At startup the server also checks the secrets (`services/startupChecks.ts`). `JWT_SECRET` and `SHINY_SECRET` (when set) must not be a placeholder such as `change-me`, must be at least 32 characters (try `openssl rand -hex 32`), and must differ from each other. With `NODE_ENV=production` the server refuses to start otherwise; in any other mode it only warns, so the example values keep working locally. After startup it also warns about a weak `DEFAULT_PASSWORD` and lists accounts that still use it: invited ones (who must change it at their first login) as a warning, and any account that is not waiting to change it as an error.

## Invite emails

When an admin invites a user, the backend creates them with a random temporary password and sends the EmailJS invite template
(which should tell them where to log in). The email never contains the password: it is shown to the inviting admin once, in the invite dialog, to pass on over
another channel (chat, phone, in person). The response of `POST /users` is `{ user, temporaryPassword, emailSent }`; if sending fails or
is not configured the invite still succeeds with `emailSent: false`, and the dialog tells the admin to send the link themselves.

Setup in EmailJS: connect the mailbox to send from (use a lab-owned or shared one, not a personal account), create a template with the
variables `invitee_name`, `invitee_email`, `admin_name`, `admin_email` (the only ones the backend sends; write the login page link into the
template text, and set its *To* field to `{{invitee_email}}`), enable *Allow EmailJS API for non-browser applications* under Security, and put the four IDs/keys in `.env`.
If invites stop arriving, check that the mailbox connection in EmailJS is still authorised (a password or MFA change can revoke it).

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Run with file watching |
| `test` | Run the unit tests |
| `build` / `start` | Compile with `tsc` / run `dist/index.js` |
| `db:migrate`, `db:migrate:undo` | Apply all pending migrations / revert the latest one (Sequelize CLI) |
| `db:seed` | Seed development users (`seeders/`) |
| `db:seed:e2e`, `e2e:start` | Seed and start for the Playwright tests (`seeders-e2e/`); used by the frontend e2e setup |
| `format`, `format:check` | Prettier |

Unit tests: `npm test` (Node's test runner via `tsx`, files in `test/`) covers access rules, passwords, rate-limit storage, email, the viewer tokens and the processing queue. The API itself is covered by the e2e suite in `../frontend/e2e/`.

## Source layout (`src/`)

Imports use the `@src/` and `@commons/` aliases (`@commons` is `../commons`).

| Folder | Role |
| --- | --- |
| `index.ts` | App setup, CORS, error handler, router mounting, server start |
| `routers/` | Route tables with the auth/role middleware for each endpoint |
| `controllers/` | Request handling and validation |
| `services/` | Business logic: `access` (dataset access rules), `auth`, `dataset`, `file`, `permission`, `user`, `activity`, `storage` (files on disk), `tus` (uploads), `socket` (Socket.IO), `email` (invite email), `viewer` (viewer tickets and signed Shiny context), `processing` / `processingSpool` (`.rds` to Parquet jobs) |
| `models/` | Sequelize models: `Users`, `Datasets` (including `status`), `Permissions`, `Files`, `Activities` |
| `middleware/` | `auth` (`requireAuth`, `optionalAuth`, `requireRole`, `requireSelfOrAdmin`), login/password rate limiters (`rateLimit`, with their Postgres counters in `rateLimitStore`), and `shinyProxy` (the `/shiny` proxy) |
| `utils/` | Password hashing and small helpers |

Also in `src/`: `database.ts` (the Sequelize instance), `config.ts` (Sequelize CLI settings for migrations and seeders) and `env.d.ts` (types of the `.env` variables).

Also at the project root: `migrations/` (schema; the app never calls `sequelize.sync()`) and `seeders/`.

## API

All routes are under `/api/<resource>`; resource names come from `commons/general.ts`. Plus `GET /health` and the `/shiny/<dataset url>/...` proxy (not under `/api`).

| Resource | Notable endpoints |
| --- | --- |
| `auth` | `POST /login`, `GET /me`, `POST /logout`, `POST /change-password` |
| `users` | CRUD (admin only), `GET /names` (admins and lab members), users can read and rename themselves |
| `datasets` | `GET /` and `GET /:id` and `GET /byURL/:url` (guests see public ones), create (admin/lab member), update (EDIT), delete (OWNER), `POST /:id/viewer` (viewer ticket, needs VIEW; 409 unless the dataset is `READY`), `POST /:id/reprocess` (rebuild plot data, EDIT) |
| `permissions` | Grant/change/revoke a user's access to a dataset (OWNER), `byUser`, `byDataset` |
| `files` | List/get/update/delete, `GET /current/:datasetId/:type/content` to download, `POST .../download-token` for browser downloads. Covers are visible with VIEW access; the records and bytes of data files (`.rds`, tissue map) need DOWNLOAD, so listing as a VIEW-only user returns just the cover and the live `file:uploaded` / `file:removed` events for data files go only to users who may download |
| `files/upload` | tus endpoint for resumable uploads (metadata: `dataset_id`, `type`, `filename`, optional `version`, `updates`) |
| `activities` | Read-only activity log (admin, or a user's own) |
| `pages` | `GET /:slug` (anyone) returns an editable page's Markdown (currently `about`; empty until saved), `PUT /:slug` (admin only) replaces it. Needs migration 07 (`npm run db:migrate`) |

Authentication is a `Bearer` JWT from `/auth/login`. Users in the `INVITED` state get a `403` with code
`PASSWORD_CHANGE_REQUIRED` everywhere except `/auth/me`, `/auth/logout` and `/auth/change-password` until they change the default password (on routes open to guests they are treated as guests).

## Things worth knowing

- **Access control** is centralized in `services/access.ts`. A dataset a caller cannot see returns `404`, not `403`, so private datasets are not revealed.
- **File storage:** files live on disk as `<UPLOAD_DIR>/{rds,cover,tissue}/<dataset_id>_<TYPE>_v<version>.<ext>`; the `Files` row is the source of truth. Only the current version is kept on disk. RDS files must be `.rds`; covers are images up to 20 MB; tissue maps (`TISSUE_PLOT`) are `.csv` files up to 50 MB.
- **Uploads** go to `<UPLOAD_DIR>/tmp` first and are moved into place once complete. Unfinished uploads expire after 48 hours and are swept hourly. Node's request/socket timeouts are disabled so multi-GB uploads are not cut off.
- **Processing:** a finished `.rds` upload sets the dataset's `status` to `PROCESSING` and queues one R job at a time (in-process `Rscript`, or the worker container when `PREPROCESS_SPOOL_DIR` is set). It ends `READY` or `FAILED` (with `statusMessage`); unfinished jobs are re-queued on restart. Details in [`../shiny/README.md`](../shiny/README.md).
- **Shiny viewer:** the frontend gets a short-lived ticket, opens `/shiny/<url>?viewer_ticket=...` in an iframe, and the proxy swaps it for a cookie session, re-checking dataset access. WebSocket upgrades are authorized in `index.ts`. Shiny only trusts a `?ctx=` value signed with `SHINY_SECRET`.
- **Rate limiting:** 10 failed logins per 15 min per IP, 5 per account, and 5 failed password changes per user. Counters are stored in Postgres, so they survive restarts. Websocket connections with a bad token are limited the same way (20 failures per 15 min per IP). Behind a reverse proxy, set `trust proxy` in `index.ts` or all clients share one IP.
- **Websockets:** the server decides each socket's rooms from its token; clients only listen. Event names and payloads are in `commons/socket.ts`.
- **Importing `index.ts`:** `start()` only runs when `index.ts` is the entry point, so a test can import `get()` without connecting to the DB or listening.
- **Schema changes:** add a new numbered file in `migrations/` rather than editing an applied one.
