# Converts a Seurat object into the Parquet files the Shiny app reads.
#
#   Rscript preprocess.R <input.rds> <output dir> [assay]
#
# The output dir is built next to its final place and renamed into it at the end, so the app never sees a half-written dataset (and, when it replaces one, is without it only for an instant).
# Names the output after the dataset: use /data/parquet/<dataset uuid>. Needs RAM for the whole object (often 2-5x the file size),
# so run it on a big machine rather than on the web server. Only reads trusted files: readRDS can run code embedded in an RDS.
#
# Output (see README.md):
#   cells.parquet   barcode, umap_1, umap_2, pca_1..pca_N, then every metadata column
#   column_levels.parquet  column, level_idx (0-based), level: the level order of every factor column of the metadata, and of the column
#                          that is the active identity
#   genes.parquet   gene_idx (0-based), gene, is_variable
#   expression.parquet  gene_idx, cell_idx (0-based row of cells.parquet), value; non-zero entries only, sorted by gene_idx
#   scale_data.parquet  gene_idx, cell_idx, value (float32): the assay's scale.data (what DoHeatmap draws), every cell of every gene it
#                       has (zeros included, it is dense), sorted by gene_idx. Not written when the object has no scale.data
suppressPackageStartupMessages({
  library(Seurat)
  library(Matrix)
  library(arrow)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 2) stop("usage: preprocess.R <input.rds> <output dir> [assay]")
input <- args[[1]]
out_dir <- sub("/+$", "", args[[2]])
tmp_dir <- paste0(out_dir, ".tmp")
unlink(tmp_dir, recursive = TRUE)
dir.create(tmp_dir, recursive = TRUE)

message("Reading ", input)
obj <- readRDS(input)
assay <- if (length(args) >= 3) args[[3]] else DefaultAssay(obj)
DefaultAssay(obj) <- assay
message("Assay: ", assay)

# ---- cells: coordinates + all metadata -----------------------------------------------------------------------------
cells <- data.frame(barcode = colnames(obj), stringsAsFactors = FALSE)
embedding <- function(reduction, prefix, max_dims) {
  if (!reduction %in% Reductions(obj)) return(NULL)
  m <- Embeddings(obj, reduction)
  m <- m[, seq_len(min(ncol(m), max_dims)), drop = FALSE]
  colnames(m) <- paste0(prefix, "_", seq_len(ncol(m)))
  as.data.frame(m)
}
cells <- cbind(cells, embedding("umap", "umap", 2), embedding("pca", "pca", 10))
meta <- obj[[]]
meta <- meta[, setdiff(colnames(meta), colnames(cells)), drop = FALSE] # keep our names if a metadata column clashes
# Factors become plain strings (Parquet dictionaries are fine, but this keeps DuckDB and R in agreement); the level order, which is the
# order the object's plots use, goes to column_levels.parquet below. A column that is the object's active identity (Idents, which
# DoHeatmap groups by) takes the order of the identity's levels, even when it is stored as text.
ident <- Idents(obj)
ident_cols <- colnames(meta)[vapply(meta, function(x) identical(as.character(x), as.character(ident)), logical(1))]
level_cols <- union(colnames(meta)[vapply(meta, is.factor, logical(1))], ident_cols)
column_levels <- do.call(rbind, c(
  list(data.frame(column = character(), level_idx = integer(), level = character())),
  lapply(level_cols, function(col) {
    lv <- if (col %in% ident_cols) levels(ident) else levels(meta[[col]])
    data.frame(column = col, level_idx = seq_along(lv) - 1L, level = lv)
  })
))
meta[] <- lapply(meta, function(x) if (is.factor(x)) as.character(x) else x)
cells <- cbind(cells, meta)
write_parquet(cells, file.path(tmp_dir, "cells.parquet"), compression = "zstd")
write_parquet(column_levels, file.path(tmp_dir, "column_levels.parquet"), compression = "zstd")

# ---- scale.data: dense genes x cells, usually only the variable features ------------------------------------------------
# Seurat v5 calls the matrix a "layer", v4 a "slot"; a missing one is an error or an empty matrix depending on the version
scaled <- tryCatch(GetAssayData(obj, assay = assay, layer = "scale.data"), error = function(e) tryCatch(GetAssayData(obj, assay = assay, slot = "scale.data"), error = function(e2) NULL))
if (!is.null(scaled) && (nrow(scaled) == 0 || ncol(scaled) == 0)) scaled <- NULL
if (!is.null(scaled)) {
  scaled <- as.matrix(scaled)
  gene_pos <- match(rownames(scaled), rownames(obj)) # 1-based, NA for a row that is not a gene of the object (kept out)
  cell_pos <- match(colnames(scaled), colnames(obj))
  ok <- !is.na(gene_pos)
  scaled <- scaled[ok, , drop = FALSE]
  gene_pos <- gene_pos[ok]
  ord <- order(gene_pos)
  scaled <- scaled[ord, , drop = FALSE]
  gene_pos <- gene_pos[ord]
  message("scale.data: ", nrow(scaled), " genes x ", ncol(scaled), " cells")
} else {
  message("The object has no scale.data (run ScaleData); the heatmap will scale the picked genes itself")
}

# Writes the scaled matrix a block of genes at a time, so the long form (a row per gene and cell) never exists in full
write_scale_data <- function(m, gene_pos, cell_pos, path) {
  schema <- arrow::schema(gene_idx = int32(), cell_idx = int32(), value = float32())
  sink <- FileOutputStream$create(path)
  writer <- ParquetFileWriter$create(schema, sink, properties = ParquetWriterProperties$create(names(schema), compression = "zstd"))
  step <- max(1L, floor(5e6 / ncol(m)))
  for (start in seq(1L, nrow(m), by = step)) {
    rows <- start:min(nrow(m), start + step - 1L)
    block <- m[rows, , drop = FALSE]
    writer$WriteTable(
      arrow_table(
        gene_idx = Array$create(rep(gene_pos[rows] - 1L, each = ncol(m)), type = int32()),
        cell_idx = Array$create(rep(cell_pos - 1L, times = length(rows)), type = int32()),
        value = Array$create(as.vector(t(block)), type = float32())
      ),
      chunk_size = 1e6
    )
  }
  writer$Close()
  sink$close()
}

# ---- genes ---------------------------------------------------------------------------------------------------------
genes <- rownames(obj)
variable <- tryCatch(VariableFeatures(obj), error = function(e) character())
write_parquet(
  data.frame(gene_idx = seq_along(genes) - 1L, gene = genes, is_variable = genes %in% variable),
  file.path(tmp_dir, "genes.parquet"),
  compression = "zstd"
)

if (!is.null(scaled)) {
  write_scale_data(scaled, gene_pos, cell_pos, file.path(tmp_dir, "scale_data.parquet"))
  rm(scaled); invisible(gc())
}

# ---- expression: non-zero entries only, sorted by gene so DuckDB can skip row groups when fetching one gene --------------
# Seurat v5 calls the matrix a "layer", v4 a "slot"
mat <- tryCatch(GetAssayData(obj, assay = assay, layer = "data"), error = function(e) GetAssayData(obj, assay = assay, slot = "data"))
rm(obj); invisible(gc())
trip <- summary(as(mat, "CsparseMatrix")) # i = gene row, j = cell column, x = value (1-based)
rm(mat); invisible(gc())
expression <- data.frame(gene_idx = trip$i - 1L, cell_idx = trip$j - 1L, value = trip$x)
rm(trip); invisible(gc())
expression <- expression[order(expression$gene_idx, expression$cell_idx), ]
write_parquet(expression, file.path(tmp_dir, "expression.parquet"), compression = "zstd", chunk_size = 1e6)

# ---- publish -------------------------------------------------------------------------------------------------------
# A re-run replaces an existing dataset: the old dir is renamed aside first (not deleted), so the app is without a dataset for only the
# moment between the two renames, not for as long as deleting takes, and the old one comes back if the second rename fails
old_dir <- paste0(out_dir, ".old")
unlink(old_dir, recursive = TRUE)
had_old <- file.exists(out_dir)
if (had_old && !file.rename(out_dir, old_dir)) stop("could not move ", out_dir, " to ", old_dir)
if (!file.rename(tmp_dir, out_dir)) {
  if (had_old) file.rename(old_dir, out_dir)
  stop("could not move ", tmp_dir, " to ", out_dir)
}
unlink(old_dir, recursive = TRUE)
message("Done: ", out_dir)
