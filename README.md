# data-visualizer

Access & visualize pre-processed and pre-annotated Brady Lab single cell RNA sequencing datasets.

Lab members and admins upload datasets (a Seurat `.rds` file plus a cover image), choose who may see them, and
visitors browse them in the web app. Large `.rds` files (often multi-GB) are uploaded with resumable
[tus](https://tus.io) uploads.

Full documentation: [Google Doc](https://docs.google.com/document/d/1VB1B6OtJmUqrp9LV7py-gPYMQm0WqmPKwHOjb4I01S0/edit?tab=t.0#heading=h.pfplectqnb9t)

## Repository layout

| Path | What it is |
| --- | --- |
| [`frontend/`](frontend/README.md) | Vue 3 + Vuetify single-page app (Vite, Pinia), plus the Playwright e2e tests |
| [`backend-express/`](backend-express/README.md) | Express 5 REST API + Socket.IO + tus uploads on PostgreSQL (Sequelize) |
| `commons/` | TypeScript types, enums and constants shared by both sides (imported as `@commons/...`) |
| `data/` | Local upload storage used by the Docker setup (`data/uploads/{rds,cover,tmp}`) |
| `docker-compose.yml` | Dev stack: Postgres, backend (port 3001), frontend (port 3000) |
| `docker-compose.e2e.yml` | Throwaway Postgres (port 5433) for the e2e tests |

## How it fits together

- **Roles:** `ADMIN`, `LAB_MEMBER`, `EXTERNAL`, and `GUEST` (logged-out visitor, frontend only).
- **Datasets** are `PUBLIC` or `PRIVATE`. Access levels per dataset: `VIEW` < `DOWNLOAD` < `EDIT` < `OWNER`.
  Admins and the dataset's owner are `OWNER`; lab members get at least `DOWNLOAD` on everything; external users
  get what they were granted (capped at `DOWNLOAD`); everyone, guests included, can `VIEW` public datasets.
  The rules live in `backend-express/src/services/access.ts` and `commons/permissions.ts`.
- **Accounts** are invite-only: an admin invites a user, who logs in with a default password and must change it first.
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

The backend needs a `backend-express/.env` (copy `backend-express/.env.example`) and the frontend a `frontend/.env`;
see each project's README. The seeder creates two users (an admin and a lab member) with the `DEFAULT_PASSWORD`
from `.env`; you will be asked to change it on first login.

To run without Docker, see the "Running locally" sections in the two project READMEs (you need Node 22.18+/24.12+ and a Postgres).

## Testing

End-to-end tests live in `frontend/e2e/` and run against a real backend and a throwaway database:

```sh
cd frontend
npm run test:e2e:fast
```

See [`frontend/e2e/README.md`](frontend/e2e/README.md).
