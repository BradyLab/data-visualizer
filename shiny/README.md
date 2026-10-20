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
  `statusMessage` (absolute paths are cut down to the file name; the full text is in the backend log). A failed run never deletes Parquet that is already in the dataset's folder
- while the dataset is not `READY` the viewer is closed (`POST /datasets/:id/viewer` answers 409 and open viewers lose access); the dataset
  page shows the state, and editors get a **Try again** button (`POST /datasets/:id/reprocess`)
- unfinished jobs are queued again when the backend restarts; deleting a dataset removes its Parquet folder, and deleting its current `.rds` file removes the Parquet too and puts the dataset back to `PROCESSING` (waiting for a new upload)
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

## Plots

The **Pick your plots** box in the viewer chooses which plots show (applied with **Update plots**). It starts with just the UMAP (or the first plot the dataset offers, if it does not offer that) and only offers what the dataset offers.

| Plot | What it shows |
| --- | --- |
| `UMAP`, `PCA` | cells (PC1 vs PC2 for PCA) colored by the cell labels (or **Group by**), or one expression panel per picked gene; **Split by** draws a panel per value of a column |
| `ViolinPlot` | expression of each picked gene per cluster |
| `DotPlot` | per gene and cluster: dot size = % of cells expressing, color = scaled average expression |
| `Heatmap` | like Seurat's `DoHeatmap`: a column per cell, grouped by cell label under a colored bar, a row per picked gene, drawing the object's `scale.data` (clipped to ±2.5, colored magenta, black, yellow across the drawn range) with a gap between groups, one heatmap per **Group by** column (titled by the column when there are several); genes missing from it are z-scored across the drawn cells; above 20,000 cells a random sample is drawn |

**Cell labels:** cells are labeled by `seurat_annotations` (cell type names) when `cells.parquet` has that column, else by `seurat_clusters`. The cell type picker, the colors and the violin/dot/heat plots all use those labels.

**Group by / Split by** (in the options row above **Update plots**, like Seurat's `group.by` / `split.by`; Group by shows with the UMAP, PCA or heatmap, Split by with the UMAP or PCA) list the text, logical and cluster columns with at most 50 values. Group by takes several columns, each drawn as its own chart (up to 8, titled by the column; default: the cell labels, also used when it is emptied). It does not apply to gene panels, as in `FeaturePlot`. Split by draws one panel per value (without genes, each group in each panel gets its own color and label, e.g. `B_CTRL` and `B_STIM`; colors run through the first panel's groups, then the next panel's), or, with genes picked, genes down and values across.

The dataset page always sends `?treatments=<JSON array>` with every treatment of the dataset. There is no treatment picker: when that list is not empty and the data has a treatment column, every plot keeps only cells whose value in that column is one of those treatments (the names must match exactly). The column is the one named by the `TREATMENT_COLUMN` environment variable, else the first column called `treatment`, `treatments`, `condition` or `orig.ident` (any case), else the first whose name contains "treat" or "condition". If there are treatments but no column is found, the viewer lists the available columns.

**Chart width** (slider in the options row above **Update plots**, 300-1200 px, applies right away) sets the width of every chart; it starts at 600, and picking the violin plot, the dot plot, the heatmap or a **Split by** column sets it to 1200 (move it afterwards if you like). Charts flow left to right and wrap, so when they are narrow enough several sit side by side (the plots you picked, and the group by charts of the UMAP and PCA); a chart is never wider than the page.

**Colors and expression options** (modeled on scCustomize): groups use a colorblind-friendly palette (Okabe-Ito for up to 8 groups, then Polychrome 36), and expression uses a plasma gradient where dark is high. On the UMAP and PCA, the cells of every cell type you did not pick in **Pick your cell types** are drawn light grey underneath (with genes picked they count as not expressing). With genes picked, **Grey out expression at or below** (scCustomize's `na_cutoff`; empty, the default, means no cutoff) also draws cells at or below that value in grey, under the expressing cells. The violin plot can show a boxplot and the median (**Show boxplot**, **Show median**); either replaces the points of the cells.

The violin, dot and heat maps need at least one gene picked. UMAP, PCA and violin draw a panel per gene, so they show only the first 10 picked genes (a note under the plot says so); the dot plot and heatmap show all picked genes. `TissuePlot` is not drawn yet.

## Try it

The Shiny port is not published, so `localhost:3838` does not work with a plain `docker compose up`. Go through the app, as users do:

1. `docker compose up` (needs `SHINY_URL` and `SHINY_SECRET`, which compose sets for the backend and the `shiny` service), log in at http://localhost:3000, open a dataset.
2. Click **Generate Plots**. The frontend asks the backend for a viewer ticket and shows the Shiny app in an iframe.
3. The UMAP, colored by the cell labels, is drawn as soon as the viewer loads. Optionally pick genes in **Pick your genes** (searchable, one UMAP panel per gene, up to 10, needs `genes.parquet` and `expression.parquet`) instead of coloring by the cell labels; **Pick your cell types** keeps only the chosen labels. Clear a picker to undo it.
4. Click **Update plots** inside the iframe to apply the pickers (the pickers, **Group by**, **Split by** and **Label clusters** all wait for the button; only **Chart width** applies right away).

Running the backend outside Docker: add `SHINY_URL=http://localhost:3838` and `SHINY_SECRET=<same as the shiny container>` to `backend-express/.env` and publish the port
(`docker compose run --rm -p 3838:3838 shiny`); without it the viewer answers 503. Shiny alone (dev only, `SHINY_DEV=1` is set in
compose): http://localhost:3838/app/?dataset=<uuid>.

Make Parquet for a dataset by hand (same script the worker runs; the dataset still needs status `READY`, which **Try again** sets):

```sh
docker build -t preprocess shiny/preprocess
docker run --rm -v "$PWD/data:/data" --entrypoint Rscript preprocess /preprocess.R /data/uploads/rds/<uuid>_RDS_v1.rds /data/parquet/<uuid>
```
