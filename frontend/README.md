# frontend

Single-page web app for browsing and managing Brady Lab single cell RNA-seq datasets.

Stack: Vue 3 (`<script setup>`, TypeScript), Vite, Vuetify 4, Pinia, Vue Router, axios, `socket.io-client`,
`tus-js-client` (resumable uploads), Playwright for e2e tests.

## Running locally

Requires Node 22.18+ (or 24.12+) and a running backend (see [`../backend-express`](../backend-express/README.md)).

```sh
cp .env.example .env
npm install
npm run dev            # http://localhost:3000
```

Or use `docker compose up` from the repo root to start everything.


## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload (port 3000) |
| `npm run build` | Type-check (`vue-tsc`) and build for production |
| `npm run preview` | Serve the production build |
| `npm run type-check` | Type-check only |
| `npm run lint` | oxlint and ESLint with auto-fix |
| `npm run format` | Prettier on `src/` and `../commons` |
| `npm run test:e2e` | Playwright tests (starts and wipes a throwaway Postgres) |
| `npm run test:e2e:fast` | Same, but starts the servers itself; see [`e2e/README.md`](e2e/README.md) |

First e2e run: `npx playwright install` to download browsers.

## Source layout (`src/`)

Imports use `@src/` (this `src/`) and `@commons/` (`../commons`, shared with the backend).

| Folder | Role |
| --- | --- |
| `main.ts`, `App.vue` | App bootstrap and root component |
| `router/` | Routes and the navigation guard (login, admin and dataset-creator checks) |
| `views/` | Pages: Home, Dataset, EditDataset (create/edit), Login, Settings, About, and `admin/` (UserManagement, ActivityLogs, PermissionManagement) |
| `layouts/` | Page shell: header, footer, default layout |
| `components/` | Reusable pieces and dialogs (invite/edit user, change password, new permission, dataset cover, ...) |
| `stores/` | Pinia stores (`auth`, `dataset`, `file`, `permission`, `user`, `activity`, `socket`) |
| `api/` | axios wrappers, one file per backend resource |
| `interfaces/` | Frontend-only types |
| `plugins/` | Vuetify setup |

## Pages

| Route | Access |
| --- | --- |
| `/home`, `/about`, `/dataset/:datasetURL`, `/login` | Everyone (guests see only public datasets) |
| `/settings`, `/dataset/:datasetURL/edit`, `/admin/permissions` | Logged in (permissions page: admins see all datasets, others those they own) |
| `/dataset/new` | Admins and lab members |
| `/admin/user-mgmt`, `/admin/activity-logs` | Admins |

The router guard only improves navigation; the backend enforces all access rules.

## Things worth knowing

- **Live updates:** the `socket` store connects to the backend's Socket.IO server after login and updates the other stores when datasets, permissions, files, users or activity change, so no manual refresh is needed. Event types are in `../commons/socket.ts`.
- **Uploads** use tus, so a large `.rds` upload can resume after a dropped connection. File downloads use a short-lived token from the backend so the browser can download directly.
- **Session:** if the saved login can't be verified because the server is down, the app keeps the token and shows a banner offering a reload instead of logging the user out.
- **Vite** polls for file changes (`usePolling`) so hot reload works in Docker/WSL2.

## Recommended setup

[VS Code](https://code.visualstudio.com/) with [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (disable Vetur), and the
[Vue.js devtools](https://devtools.vuejs.org/) browser extension. `.vue` type information comes from `vue-tsc`, not plain `tsc`.
