# data-visualizer

Access & visualize pre-processed and pre-annotated Brady Lab single cell RNA sequencing datasets.

Lab members and admins upload datasets (a Seurat `.rds` file plus a cover image and, optionally, a tissue map CSV for the tissue plot), choose who may see them, and
visitors browse them in the web app and explore interactive plots (UMAP etc.) of each dataset. Large `.rds` files (often multi-GB) are uploaded with resumable
[tus](https://tus.io) uploads.

Full documentation: [Google Doc](https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.0#heading=h.pfplectqnb9t)

## Repository layout

| Path | What it is |
| --- | --- |
| [`frontend/`](frontend/README.md) | Vue 3 + Vuetify single-page app (Vite, Pinia), plus the Playwright e2e tests |
| [`backend-express/`](backend-express/README.md) | Express 5 REST API + Socket.IO + tus uploads on PostgreSQL (Sequelize) |
| [`shiny/`](shiny/README.md) | The R Shiny plot viewer (private, reached only through the backend's proxy) and the R job that turns a `.rds` into Parquet |
| `commons/` | TypeScript types, enums and constants shared by both sides (imported as `@commons/...`) |
| `data/` | Local storage used by the Docker setup: uploads (`data/uploads/{rds,cover,tissue,tmp}`), plot data (`data/parquet/<dataset id>/`) and preprocessing jobs (`data/jobs/`). Git-ignored |
| `docker-compose.yml` | Dev stack: Postgres, backend (port 3001), frontend (port 3000), Shiny (internal only) and the preprocess worker |
| `docker-compose.e2e.yml` | Throwaway Postgres (port 5433) for the e2e tests |

## How it fits together

- **Roles:** `ADMIN`, `LAB_MEMBER`, `EXTERNAL`, and `GUEST` (logged-out visitor, frontend only).
- **Datasets** are `PUBLIC` or `PRIVATE`. Access levels per dataset: `VIEW` < `DOWNLOAD` < `EDIT` < `OWNER`.
  Admins and the dataset's owner are `OWNER`; lab members get at least `DOWNLOAD` on everything; external users
  get what they were granted (capped at `DOWNLOAD`); everyone, guests included, can `VIEW` public datasets.
  The rules live in `backend-express/src/services/access.ts` and `commons/permissions.ts`.
- **Accounts** are invite-only: an admin invites a user, who gets a login link by email and a random temporary password from the admin (shown once, never emailed), and must change it on first login.
- **Plots:** uploading an `.rds` starts a background job (`shiny/preprocess/`) that writes Parquet files, and the dataset's `status` goes `PROCESSING` → `READY` (or `FAILED`; editors can retry). When `READY`, **Generate Plots** on the dataset page opens the Shiny app in an iframe. The backend checks the user's access and proxies `/shiny/...` to Shiny, which is never exposed publicly. See [`shiny/README.md`](shiny/README.md).
- **Live updates:** the backend pushes changes (datasets, permissions, uploads, activity) to browsers over Socket.IO.
- **Shared code:** both projects alias `@commons` to `commons/`, so API paths, enums and payload types are defined once.

## Quick start (Docker)

Requires Docker. From the repo root:

```sh
docker compose up
```

This starts Postgres, installs dependencies, builds, migrates and seeds the database, and runs both dev servers:

- Frontend: http://localhost:3000
- Backend: http://localhost:3001 (health check at `/health`)

Before the first run, create these files (each has a `.env.example`):

- root `.env`: `SHINY_SECRET`, read by compose; compose refuses to start without it
- `backend-express/.env` (compose overrides the database and Shiny settings)
- `frontend/.env`

See each project's README. The seeder creates three users (an admin, a lab member and an external user) with the `DEFAULT_PASSWORD`
from `.env`; you will be asked to change it on first login.

The first `docker compose up` also builds the R images (`shiny` and `preprocess`), which takes a while. Processing a dataset needs RAM
for the whole Seurat object (often 2-5x the file size); give Docker enough memory.

To run without Docker, see the "Running locally" sections in the two project READMEs (you need Node 24 (see `.nvmrc`) and a Postgres).

## Testing

Unit and component tests (Vitest + jsdom) live in `frontend/src/__tests__/`; backend unit tests (Node's built-in test runner) in `backend-express/test/`:

```sh
cd frontend && npm run test:unit
cd backend-express && npm test
```

End-to-end tests live in `frontend/e2e/` and run against a real backend and a throwaway database:

```sh
cd frontend
npm run test:e2e:fast
```

See [`frontend/e2e/README.md`](frontend/e2e/README.md).

CI (`.github/workflows/ci.yml`) runs format, lint, type-check, unit tests and build for both projects, builds the Shiny and preprocess images, and runs the e2e tests.
