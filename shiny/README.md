# Shiny viewer

Interactive plots for one dataset, shown in an iframe on the dataset page. The Shiny server is private: the Express backend proxies
`/shiny/<dataset slug>/...` to it after checking the viewer ticket/cookie and the dataset permissions
(`backend-express/src/middleware/shinyProxy.ts`), and tells the app who is asking through trusted headers
(dataset id, offered plots). Shiny Server does not hand request headers to the app, so Express signs them into
`?ctx=<payload>.<hmac>` in the iframe URL with `SHINY_SECRET` (set the same value for Express and Shiny); the app verifies it.

- `app/` the Shiny app (served by Shiny Server at `/app/`). No Seurat: it reads Parquet through DuckDB.
- `preprocess/` job that turns a Seurat `.rds` into that Parquet.

## How the Parquet gets made

Uploading an RDS (tus upload finishing in `backend-express/src/services/tus.ts`) calls `processing.start(dataset id)`
(`backend-express/src/services/processing.ts`), which sets the dataset's `status` to `PROCESSING`, queues a job, and has
`preprocess/preprocess.R <rds> <PARQUET_DIR>/<dataset id>` run:

- **In Docker (the dev setup):** by the `preprocess` compose service. The backend drops a job file into `data/jobs/pending/`
  (`PREPROCESS_SPOOL_DIR=/data/jobs`) and the worker (`preprocess/worker.sh`, same image as the preprocess job) picks it up, runs R, and
  reports `ok`/`fail` plus the end of R's output in `data/jobs/done/`. No Docker socket or R is needed in the backend. If no worker takes
  the job within a minute (`PREPROCESS_PICKUP_TIMEOUT_MS`) the dataset is marked `FAILED` with a hint. Check the worker with
  `docker compose logs preprocess`. The worker only accepts an `.rds` under `data/uploads/rds` and an output folder directly under
  `data/parquet`.
- **Without Docker:** leave `PREPROCESS_SPOOL_DIR` unset and the backend runs `Rscript` itself (`PREPROCESS_COMMAND`/`PREPROCESS_SCRIPT`), so
  that machine needs R with Seurat, arrow and Matrix (see `preprocess/Dockerfile` for the system libraries).

Either way:

- one job at a time (a 15-25 GB object needs tens of GB of RAM: give Docker enough memory); a re-upload during a job stops it and processes
  the new file
- success sets `READY`; an error or timeout (`PREPROCESS_TIMEOUT_MS`, default 6 h) sets `FAILED` with the end of R's error output in
  `statusMessage`. A failed run never deletes Parquet that is already in the dataset's folder
- while the dataset is not `READY` the viewer is closed (`POST /datasets/:id/viewer` answers 409 and open viewers lose access); the dataset
  page shows the state, and editors get a **Try again** button (`POST /datasets/:id/reprocess`)
- unfinished jobs are queued again when the backend restarts; deleting a dataset removes its Parquet folder
- `PARQUET_DIR` defaults to `data/parquet` (a sibling of the uploads folder); Shiny reads the same folder

Datasets created before this existed stay `PROCESSING` until someone presses **Try again** (or re-uploads).

## Parquet layout

One folder per dataset, `<PARQUET_DIR>/<dataset uuid>/` (`data/parquet/` in the Docker setup, mounted read-only into Shiny):

| File | Columns |
| --- | --- |
| `cells.parquet` | `barcode`, `umap_1`, `umap_2`, `pca_1`..`pca_10`, then every metadata column of the object |
| `genes.parquet` | `gene_idx` (0-based), `gene`, `is_variable` |
| `expression.parquet` | `gene_idx`, `cell_idx` (0-based row of `cells.parquet`), `value`; non-zero entries only, sorted by `gene_idx` |
| `column_levels.parquet` | `column`, `level_idx` (0-based), `level`: the level order of every factor column of the metadata, which the viewer uses to order cell labels, legends, panels and heatmap groups (other values are sorted; datasets without the file are sorted) |
| `scale_data.parquet` | `gene_idx`, `cell_idx`, `value` (float32): the assay's `scale.data` (usually the variable features only), dense, sorted by `gene_idx`; not written when the object has none |

Planned additions (not produced yet): cluster markers, PCA loadings/variance.
The original `.rds` stays in `data/uploads/rds` for downloads; the Parquet is derived and can be rebuilt.

## Try it

The Shiny port is not published, so `localhost:3838` does not work with a plain `docker compose up`. Go through the app, as users do:

1. `docker compose up` (needs `SHINY_URL` and `SHINY_SECRET`, which compose sets for the backend and the `shiny` service), log in at http://localhost:3000, open a dataset.
2. Click **Generate Plots**. The frontend asks the backend for a viewer ticket and shows the Shiny app in an iframe.
3. Click **Generate plots** inside the iframe: a "Hey, this works!" box shows the dataset id, access level, offered plots and cell
   count, plus a UMAP if `data/parquet/<dataset uuid>/cells.parquet` exists.

Running the backend outside Docker: add `SHINY_URL=http://localhost:3838` and `SHINY_SECRET=<same as the shiny container>` to `backend-express/.env` and publish the port
(`docker compose run --rm -p 3838:3838 shiny`); without it the viewer answers 503. Shiny alone (dev only, `SHINY_DEV=1` is set in
compose): http://localhost:3838/app/?dataset=<uuid>.

Make Parquet for a dataset by hand (same script the worker runs; the dataset still needs status `READY`, which **Try again** sets):

```sh
docker build -t preprocess shiny/preprocess
docker run --rm -v "$PWD/data:/data" --entrypoint Rscript preprocess /preprocess.R /data/uploads/rds/<uuid>_RDS_v1.rds /data/parquet/<uuid>
```
