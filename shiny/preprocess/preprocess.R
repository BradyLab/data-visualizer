# Converts a Seurat object into the Parquet files the Shiny app reads.
#
#   Rscript preprocess.R <input.rds> <output dir> [assay]
#
# The output dir is built next to its final place and renamed into it at the end, so the app never sees a half-written dataset.
# Names the output after the dataset: use /data/parquet/<dataset uuid>. Needs RAM for the whole object (often 2-5x the file size),
# so run it on a big machine rather than on the web server. Only reads trusted files: readRDS can run code embedded in an RDS.
#
# Output (see README.md):
#   cells.parquet   barcode, umap_1, umap_2, pca_1..pca_N, then every metadata column
#   genes.parquet   gene_idx (0-based), gene, is_variable
#   expression.parquet  gene_idx, cell_idx (0-based row of cells.parquet), value; non-zero entries only, sorted by gene_idx
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
# Factors become plain strings (Parquet dictionaries are fine, but this keeps DuckDB and R in agreement); levels order is lost
meta[] <- lapply(meta, function(x) if (is.factor(x)) as.character(x) else x)
cells <- cbind(cells, meta)
write_parquet(cells, file.path(tmp_dir, "cells.parquet"), compression = "zstd")

# ---- genes ---------------------------------------------------------------------------------------------------------
genes <- rownames(obj)
variable <- tryCatch(VariableFeatures(obj), error = function(e) character())
write_parquet(
  data.frame(gene_idx = seq_along(genes) - 1L, gene = genes, is_variable = genes %in% variable),
  file.path(tmp_dir, "genes.parquet"),
  compression = "zstd"
)

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
unlink(out_dir, recursive = TRUE)
if (!file.rename(tmp_dir, out_dir)) stop("could not move ", tmp_dir, " to ", out_dir)
message("Done: ", out_dir)
