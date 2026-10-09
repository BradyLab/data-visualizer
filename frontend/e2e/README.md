# End-to-end tests

Playwright drives the real app against a real backend and a throwaway Postgres. Nothing is mocked.

## Running

| Command | What it does |
| --- | --- |
| `npm run test:e2e:fast` | Starts the database, backend and a production build of the frontend itself, runs the tests, stops everything. Extra arguments go to Playwright (`-- --headed -g "login"`). `E2E_DEV=1` uses the Vite dev server instead. |
| `npm run test:e2e` | Same through Playwright's own `webServer` config (also what CI uses). On some WSL2 setups it waits ~2 minutes per server because connecting to a closed localhost port hangs; use `test:e2e:fast` there. |

Firefox and WebKit run only with `E2E_ALL_BROWSERS=1` (or on CI). Runs are headless; add `--headed` to watch (`npm run test:e2e:fast -- --headed`).

## The stack

Separate ports and database, so it never touches the dev stack (see `stack.ts`): Postgres 5433 (`docker-compose.e2e.yml`, wiped every run), backend 3101, frontend 3100. The backend migrates and seeds `backend-express/seeders-e2e/` on start: an admin, a lab member and an external user, all ACTIVE.

## Writing specs

- `auth.setup.ts` logs in as each seeded user once and saves the session; specs pick one with `test.use({ storageState: authFile('lab') })` (`LOGGED_OUT` for a logged-out visitor).
- Set up state through the API (`api.ts`) and drive the UI only for what the spec is about. Every dataset and user a spec creates has a unique name.
- **Never change the seeded users.** Specs that edit, deactivate or delete users create their own (`activeUser`, `inviteUser`).
- Realtime specs open a second context and use `gotoLive`/`loginLive`, which wait for the websocket, so a push made right after is not missed.
- The backend allows 10 failed logins per 15 minutes from one address. A spec that fails a login on purpose calls `resetRateLimits` afterwards (`db.ts`).
- Lists grow during a run (datasets, users), so specs must not assume their row is on the first page or in view: see `userRow` and `pickOption` in `admin.ts`.
