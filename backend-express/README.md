# backend-express

REST API for the data visualizer: users and login, datasets, per-dataset permissions, file uploads, and an
activity log. Also serves live updates over Socket.IO, turns uploaded `.rds` files into plot data, and proxies the Shiny plot viewer.

Stack: Node (ESM, TypeScript run with `tsx`), Express 5, Sequelize (`sequelize-typescript`) on PostgreSQL,
Socket.IO, [`@tus/server`](https://github.com/tus/tus-node-server) for resumable uploads, JWT auth,
`express-rate-limit` backed by Postgres, `http-proxy-middleware` (Shiny proxy), EmailJS (invite emails).

## Running locally

Requires Node 26 (26.0+; the version in `.nvmrc`) and a running PostgreSQL.

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
| `TRUST_PROXY` | Optional. Number of reverse proxies in front of the server (`1` behind Caddy in `docker-compose.prod.yml`). Needed in production so the login and websocket rate limits see each client's own address; leave unset when there is no proxy. Only a count is accepted, and the proxy must overwrite any `X-Forwarded-For` a client sends |
| `JWT_SECRET` | Signing secret for login tokens; the server refuses to start without it |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `8h` |
| `UPLOAD_DIR` | Where uploads are stored (default `/data/uploads`); `rds/`, `cover/`, `tissue/` and `tmp/` are created inside |
| `UPLOAD_MAX_BYTES` | Largest accepted upload (default 30 GiB) |
| `SHINY_URL`, `SHINY_SECRET` | Internal URL of the Shiny server and the secret shared with it. Without both, the viewer is disabled (`POST /datasets/:id/viewer` answers 503). Use the same `SHINY_SECRET` for Shiny; see [`../shiny/README.md`](../shiny/README.md) |
| `VIEWER_TICKET_EXPIRES_IN`, `VIEWER_SESSION_EXPIRES_IN` | Lifetime of the one-time viewer ticket (default `60s`) and of the viewer cookie session (default `1h`) |
| `PARQUET_DIR` | Where plot data is kept, one folder per dataset (default: a `parquet` folder next to `UPLOAD_DIR`, i.e. `/data/parquet`) |
| `PREPROCESS_COMMAND`, `PREPROCESS_SCRIPT`, `PREPROCESS_TIMEOUT_MS` | Run the R job on this machine: program (default `Rscript`), script (default `shiny/preprocess/preprocess.R`) and time limit (default 6 h) |
| `PREPROCESS_MODE` | Optional. Where preprocessing jobs run: `local` (default: on this server), `auto` (jobs too big for this server's memory, and jobs that run out of memory here, go to the large-memory worker) or `remote` (all of them do). Anything but `local` needs `REMOTE_WORKER_TOKEN`. See [Large-memory worker](#large-memory-worker) |
| `PREPROCESS_LOCAL_MEMORY`, `PREPROCESS_MEMORY_RESERVE`, `PREPROCESS_MEMORY_RATIO` | `auto` mode's size check: a job goes to the worker when its file size times the ratio (default 5, the top of the documented 2-5x) is more than the memory a job may use here. That is `PREPROCESS_LOCAL_MEMORY` (a size such as `24g`; `docker-compose.prod.yml` passes the preprocess container's memory limit), else the machine's RAM minus `PREPROCESS_MEMORY_RESERVE` (default `8g`) |
| `REMOTE_WORKER_TOKEN` | Optional secret of the large-memory worker; setting it turns on the `/api/worker` routes. At least 32 characters, not a placeholder and different from `JWT_SECRET` and `SHINY_SECRET` (checked at startup like them). `REMOTE_LEASE_MS` (default 15 minutes without a heartbeat before a claimed job is given to another worker) and `REMOTE_UPLOAD_MAX_BYTES` (largest Parquet file accepted, default 64 GiB) tune it |
| `NOTIFY_EMAIL_TO`, `EMAILJS_NOTIFY_TEMPLATE_ID` | Optional. Who is emailed (comma separated; use a shared lab mailbox) when a dataset starts waiting for the worker, and the EmailJS template for it (variables `to_email`, `subject`, `message`); the other EmailJS settings above are used as well |
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

## Password reset

`POST /auth/forgot-password` with `{ email }` is public. It always answers 202 with the same message (so it does not reveal which emails have accounts) and, for an
active account, emails a new random password to that account's own address and sets its status to `invited`, so the user must change it at their next login
(older tokens and open sessions stop working). The password is changed only after EmailJS accepted the email, so a failed send never locks anyone out.
Requests are limited to 3 per account and 10 per IP per 15 minutes. Inactive accounts are not reset.

Setup in EmailJS: create a second template with the variables `user_name`, `user_email`, `new_password` (set its *To* field to `{{user_email}}`) and put its
ID in `EMAILJS_RESET_TEMPLATE_ID`. Without it, reset requests change nothing.

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
| `worker` | The large-memory worker's routes, not for browsers: `GET /waiting` (how many jobs could be claimed, changes nothing), `POST /claim`, `GET /jobs/:id/rds`, `POST /jobs/:id/heartbeat`, `PUT /jobs/:id/files/:name`, `POST /jobs/:id/complete`, `POST /jobs/:id/fail`. They need `Authorization: Bearer <REMOTE_WORKER_TOKEN>` (503 while it is unset, 401 if wrong, failed attempts rate limited) and answer 410 when a job is no longer active. See [Large-memory worker](#large-memory-worker). Needs migration 08 |
| `pages` | `GET /:slug` (anyone) returns an editable page's Markdown (currently `about`; empty until saved), `PUT /:slug` (admin only) replaces it. Needs migration 07 (`npm run db:migrate`) |

Authentication is a `Bearer` JWT from `/auth/login`. Users in the `INVITED` state get a `403` with code
`PASSWORD_CHANGE_REQUIRED` everywhere except `/auth/me`, `/auth/logout` and `/auth/change-password` until they change the default password (on routes open to guests they are treated as guests).

## Things worth knowing

- **Access control** is centralized in `services/access.ts`. A dataset a caller cannot see returns `404`, not `403`, so private datasets are not revealed.
- **File storage:** files live on disk as `<UPLOAD_DIR>/{rds,cover,tissue}/<dataset_id>_<TYPE>_v<version>.<ext>`; the `Files` row is the source of truth. Only the current version is kept on disk. RDS files must be `.rds`; covers are images up to 20 MB; tissue maps (`TISSUE_PLOT`) are `.csv` files up to 50 MB.
- **Uploads** go to `<UPLOAD_DIR>/tmp` first and are moved into place once complete. Unfinished uploads expire after 48 hours and are swept hourly. Node's request/socket timeouts are disabled so multi-GB uploads are not cut off.
- **Processing:** a finished `.rds` upload sets the dataset's `status` to `PROCESSING` and queues one R job at a time (in-process `Rscript`, or the worker container when `PREPROCESS_SPOOL_DIR` is set). It ends `READY` or `FAILED` (with `statusMessage`), or waits as `WAITING_FOR_LARGE_MEMORY` (below); unfinished jobs are re-queued on restart. Details in [`../shiny/README.md`](../shiny/README.md).
- **Shiny viewer:** the frontend gets a short-lived ticket, opens `/shiny/<url>?viewer_ticket=...` in an iframe, and the proxy swaps it for a cookie session, re-checking dataset access. WebSocket upgrades are authorized in `index.ts`. Shiny only trusts a `?ctx=` value signed with `SHINY_SECRET`.
- **Rate limiting:** 10 failed logins per 15 min per IP, 5 per account, and 5 failed password changes per user. Counters are stored in Postgres, so they survive restarts. Websocket connections with a bad token are limited the same way (20 failures per 15 min per IP). Behind a reverse proxy, set `TRUST_PROXY` (see the table above) or all clients share one IP.
- **Websockets:** the server decides each socket's rooms from its token; clients only listen. Event names and payloads are in `commons/socket.ts`.
- **Importing `index.ts`:** `start()` only runs when `index.ts` is the entry point, so a test can import `get()` without connecting to the DB or listening.
- **Schema changes:** add a new numbered file in `migrations/` rather than editing an applied one.

## Large-memory worker

Datasets whose Seurat object does not fit this server's memory are processed by a worker on a bigger machine (the school's cluster, started with `shiny/preprocess/cluster/cluster-worker.sh`; see [`../shiny/README.md`](../shiny/README.md)). The worker calls this server over HTTPS; nothing connects to it, and it never touches the database or the disk of this server.

- **Routing** (`services/routing.ts`, applied in `services/processing.ts`): `PREPROCESS_MODE=auto` sends a job to the worker when file size times `PREPROCESS_MEMORY_RATIO` exceeds the memory a job may use here, and also when a job running here is killed for lack of memory (SIGKILL / exit code 137, R's "cannot allocate" error, or the spool worker's `oom` status). `remote` sends all of them; `local` none. Without `REMOTE_WORKER_TOKEN` everything stays local, and the server refuses to start in production with a mode that needs the token.
- **Queue:** the dataset's `status` becomes `WAITING_FOR_LARGE_MEMORY` and a row in `RemoteJobs` (migration 08) holds the job. The lab is emailed if `NOTIFY_EMAIL_TO` is set. A re-upload, a retry (`/reprocess`), a deleted RDS file or a deleted dataset drops the job.
- **Claims** (`services/remoteProcessing.ts`): `GET /api/worker/waiting` counts the claimable jobs (`waiting=<n>`) without claiming any, for the scheduled check on the cluster (`shiny/preprocess/cluster/cluster-check.sh`). `POST /api/worker/claim` hands the oldest waiting job to one worker (`FOR UPDATE SKIP LOCKED`) under a fresh id. The worker's heartbeats keep the claim; after `REMOTE_LEASE_MS` without one the job goes to the next worker, and the first one is told (410) to stop. A job whose dataset changed meanwhile is dropped the same way.
- **Result:** the worker uploads each Parquet file (only the names in `services/storage.ts` `PARQUET_FILES`, with an exact `Content-Length`, into `<PARQUET_DIR>/<dataset id>.tmp`), then `POST .../complete` publishes the folder as `preprocess.R` does (the old folder is moved aside, then removed) and sets `READY`; `POST .../fail` records the message with paths cut down.
- **Not covered yet:** what happens to downloads of the `.rds` for these datasets (it stays on this server's disk), and a way to see waiting jobs other than the dataset page.
