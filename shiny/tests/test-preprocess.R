# Tests for preprocess/preprocess.R: builds small Seurat objects, runs the script on them like the worker does, and reads the Parquet back.
#   docker run --rm -v "$PWD/shiny:/work:ro" --entrypoint Rscript preprocess-ci /work/tests/test-preprocess.R
# (the image copies the script to /preprocess.R; pass another path as the first argument to test a different copy)
args <- commandArgs(trailingOnly = FALSE)
here <- dirname(normalizePath(sub("^--file=", "", args[grep("^--file=", args)])))
source(file.path(here, "harness.R"))
script <- commandArgs(trailingOnly = TRUE)[1]
if (is.na(script)) script <- if (file.exists("/preprocess.R")) "/preprocess.R" else file.path(here, "..", "preprocess", "preprocess.R")

suppressPackageStartupMessages({
  library(Seurat)
  library(Matrix)
  library(arrow)
})

work <- tempfile("preprocess-test-")
dir.create(work)

# ---- fixtures --------------------------------------------------------------------------------------------------------------------------

N_CELLS <- 60
N_GENES <- 200

# A small object that has everything the script reads: normalized data, variable features, scale.data, PCA, UMAP and metadata.
# Factor levels are deliberately not in sorted order, and `ident_text` stores the active identity as plain text
make_object <- function(cells = N_CELLS, genes = N_GENES, seed = 1) {
  set.seed(seed)
  counts <- Matrix(matrix(rpois(genes * cells, lambda = 0.7), nrow = genes, dimnames = list(paste0("GENE", seq_len(genes)), paste0("CELL", seq_len(cells)))), sparse = TRUE)
  obj <- suppressWarnings(CreateSeuratObject(counts, min.cells = 0, min.features = 0))
  obj$seurat_clusters <- factor(sample(c("10", "2", "1"), cells, replace = TRUE), levels = c("10", "2", "1"))
  obj$seurat_annotations <- factor(c("B", "T", "NK")[as.integer(obj$seurat_clusters)], levels = c("T", "NK", "B"))
  obj$condition <- sample(c("CTRL", "STIM"), cells, replace = TRUE)
  Idents(obj) <- "seurat_annotations"
  obj$ident_text <- as.character(Idents(obj))
  obj <- NormalizeData(obj, verbose = FALSE)
  obj <- FindVariableFeatures(obj, nfeatures = 40, verbose = FALSE)
  obj <- ScaleData(obj, verbose = FALSE)
  obj <- RunPCA(obj, features = VariableFeatures(obj), npcs = 12, verbose = FALSE)
  obj <- suppressWarnings(RunUMAP(obj, dims = 1:5, n.neighbors = 10, verbose = FALSE))
  obj
}

# Runs the script as the worker does; returns the exit status and what it printed
run_preprocess <- function(input, output, ...) {
  out <- suppressWarnings(system2("Rscript", c(shQuote(script), shQuote(input), shQuote(output), ...), stdout = TRUE, stderr = TRUE))
  list(status = attr(out, "status") %||% 0L, output = paste(out, collapse = "\n"))
}
`%||%` <- function(a, b) if (is.null(a)) b else a

counter <- 0
# A fresh output folder and an .rds of the object; returns both paths
stage <- function(obj) {
  counter <<- counter + 1
  rds <- file.path(work, sprintf("input-%d.rds", counter))
  saveRDS(obj, rds)
  list(rds = rds, out = file.path(work, sprintf("parquet-%d", counter)))
}

read <- function(out, name) as.data.frame(read_parquet(file.path(out, paste0(name, ".parquet"))))

# ---- a complete object -----------------------------------------------------------------------------------------------------------------

obj <- make_object()
job <- stage(obj)
first <- run_preprocess(job$rds, job$out)

test("a complete object is converted without error", {
  expect(first$status == 0, paste("exit status", first$status, first$output))
  expect(grepl("Done:", first$output), "no completion message")
})

test("it publishes the five files and leaves no half-built or replaced folder behind", {
  expect_equal(sort(list.files(job$out)), c("cells.parquet", "column_levels.parquet", "expression.parquet", "genes.parquet", "scale_data.parquet"))
  expect(!file.exists(paste0(job$out, ".tmp")), ".tmp left behind")
  expect(!file.exists(paste0(job$out, ".old")), ".old left behind")
})

test("cells.parquet has a row per cell in the object's order, with coordinates first and then the metadata", {
  cells <- read(job$out, "cells")
  expect_equal(nrow(cells), N_CELLS)
  expect_equal(cells$barcode, colnames(obj))
  expect_equal(names(cells)[1:3], c("barcode", "umap_1", "umap_2"))
  expect(all(paste0("pca_", 1:10) %in% names(cells)), "pca_1..pca_10 missing")
  expect(!"pca_11" %in% names(cells), "more than 10 PCs written")
  expect(all(c("seurat_clusters", "seurat_annotations", "condition", "nCount_RNA", "nFeature_RNA") %in% names(cells)), "metadata columns missing")
})

test("the coordinates are the object's embeddings", {
  cells <- read(job$out, "cells")
  expect_equal(unname(cells$umap_1), unname(Embeddings(obj, "umap")[, 1]))
  expect_equal(unname(cells$pca_3), unname(Embeddings(obj, "pca")[, 3]))
})

test("factors are written as text, and the other metadata keeps its type", {
  cells <- read(job$out, "cells")
  expect_equal(cells$seurat_clusters, as.character(obj$seurat_clusters))
  expect(is.character(cells$seurat_annotations))
  expect(is.numeric(cells$nCount_RNA))
})

test("column_levels.parquet keeps the factor level order, 0-based, including the active identity stored as text", {
  levels <- read(job$out, "column_levels")
  of <- function(column) levels$level[levels$column == column][order(levels$level_idx[levels$column == column])]
  expect_equal(of("seurat_clusters"), c("10", "2", "1"))
  expect_equal(of("seurat_annotations"), c("T", "NK", "B"))
  expect_equal(of("ident_text"), c("T", "NK", "B"), "a text column equal to the identity takes the identity's order")
  expect_equal(min(levels$level_idx), 0L)
  expect(!"condition" %in% levels$column, "a plain text column has no levels")
})

test("genes.parquet lists the genes in the object's order with their 0-based index and variable flag", {
  genes <- read(job$out, "genes")
  expect_equal(genes$gene, rownames(obj))
  expect_equal(genes$gene_idx, seq_len(N_GENES) - 1L)
  expect_equal(genes$gene[genes$is_variable], rownames(obj)[rownames(obj) %in% VariableFeatures(obj)])
  expect_equal(sum(genes$is_variable), 40L)
})

test("expression.parquet holds exactly the non-zero normalized values, sorted by gene and then cell", {
  expression <- read(job$out, "expression")
  data <- GetAssayData(obj, layer = "data")
  expect_equal(nrow(expression), length(data@x), "one row per non-zero entry")
  expect(!any(expression$value == 0), "zeros were written")
  expect(!is.unsorted(expression$gene_idx), "not sorted by gene")
  expect(!is.unsorted(order(expression$gene_idx, expression$cell_idx)), "not sorted by cell within a gene")
  expect(min(expression$cell_idx) >= 0 && max(expression$cell_idx) < N_CELLS && max(expression$gene_idx) < N_GENES, "indexes out of range")
  pick <- sample(nrow(expression), 25)
  expected <- mapply(function(g, c) data[g + 1, c + 1], expression$gene_idx[pick], expression$cell_idx[pick])
  expect_equal(unname(expected), expression$value[pick])
})

test("scale_data.parquet is the dense scale.data of the variable genes, as 32-bit floats, with indexes into genes and cells", {
  scaled <- read(job$out, "scale_data")
  matrix <- as.matrix(GetAssayData(obj, layer = "scale.data"))
  expect_equal(nrow(scaled), nrow(matrix) * ncol(matrix), "dense: a row per gene and cell, zeros included")
  expect(!is.unsorted(scaled$gene_idx), "not sorted by gene")
  expect_equal(sort(unique(scaled$gene_idx)), sort(match(rownames(matrix), rownames(obj)) - 1L))
  pick <- sample(nrow(scaled), 25)
  expected <- mapply(function(g, c) matrix[rownames(obj)[g + 1], colnames(obj)[c + 1]], scaled$gene_idx[pick], scaled$cell_idx[pick])
  expect(isTRUE(all.equal(unname(expected), scaled$value[pick], tolerance = 1e-5)), "values differ from scale.data")
  expect_equal(read_parquet(file.path(job$out, "scale_data.parquet"), as_data_frame = FALSE)$schema$GetFieldByName("value")$type$ToString(), "float")
})

# ---- other shapes of object ------------------------------------------------------------------------------------------------------------

test("an object without scale.data skips scale_data.parquet and still succeeds", {
  # PCA needs scaled data, so the object is made with it and the layer is dropped afterwards
  bare <- make_object()
  LayerData(bare, layer = "scale.data") <- NULL
  expect(!"scale.data" %in% Layers(bare), "the fixture still has scale.data")
  j <- stage(bare)
  result <- run_preprocess(j$rds, j$out)
  expect(result$status == 0, result$output)
  expect(!file.exists(file.path(j$out, "scale_data.parquet")), "scale_data.parquet was written")
  expect(grepl("no scale.data", result$output), "no note about the missing scale.data")
  expect(file.exists(file.path(j$out, "expression.parquet")))
})

test("an object without a UMAP or PCA gets no coordinate columns", {
  plain <- make_object()
  plain[["umap"]] <- NULL
  plain[["pca"]] <- NULL
  j <- stage(plain)
  result <- run_preprocess(j$rds, j$out)
  expect(result$status == 0, result$output)
  cells <- read(j$out, "cells")
  expect(!any(grepl("^(umap|pca)_", names(cells))), "coordinates written for a missing reduction")
  expect_equal(cells$barcode, colnames(plain))
})

test("a metadata column that clashes with a coordinate name does not replace the coordinate", {
  clash <- make_object()
  clash$umap_1 <- "decoy"
  j <- stage(clash)
  expect(run_preprocess(j$rds, j$out)$status == 0)
  cells <- read(j$out, "cells")
  expect(is.numeric(cells$umap_1), "the metadata column won")
  expect_equal(sum(names(cells) == "umap_1"), 1L)
})

test("a Seurat v3 assay (slots, not layers) is converted too", {
  old <- options(Seurat.object.assay.version = "v3")
  on.exit(options(old))
  v3 <- make_object()
  j <- stage(v3)
  result <- run_preprocess(j$rds, j$out)
  expect(result$status == 0, result$output)
  expect_equal(nrow(read(j$out, "expression")), length(GetAssayData(v3, slot = "data")@x))
  expect(file.exists(file.path(j$out, "scale_data.parquet")))
})

test("the optional third argument picks the assay", {
  two <- make_object()
  alt_counts <- GetAssayData(two, layer = "counts")[1:50, ]
  two[["ALT"]] <- CreateAssayObject(counts = alt_counts)
  two <- NormalizeData(two, assay = "ALT", verbose = FALSE)
  j <- stage(two)
  result <- run_preprocess(j$rds, j$out, "ALT")
  expect(result$status == 0, result$output)
  expect_equal(read(j$out, "genes")$gene, rownames(alt_counts))
  expect(grepl("Assay: ALT", result$output))
})

# ---- publishing and failure ------------------------------------------------------------------------------------------------------------

test("a trailing slash on the output folder makes no difference", {
  j <- stage(obj)
  result <- run_preprocess(j$rds, paste0(j$out, "/"))
  expect(result$status == 0, result$output)
  expect(file.exists(file.path(j$out, "cells.parquet")))
  expect(!file.exists(paste0(j$out, "/.tmp")))
})

test("running again replaces the published folder with the new data and removes the old one", {
  j <- stage(obj)
  expect(run_preprocess(j$rds, j$out)$status == 0)
  expect_equal(nrow(read(j$out, "cells")), N_CELLS)
  smaller <- make_object(cells = 40, seed = 2)
  saveRDS(smaller, j$rds)
  result <- run_preprocess(j$rds, j$out)
  expect(result$status == 0, result$output)
  expect_equal(nrow(read(j$out, "cells")), 40L)
  expect_equal(max(read(j$out, "expression")$cell_idx), 39L)
  expect(!file.exists(paste0(j$out, ".old")) && !file.exists(paste0(j$out, ".tmp")), "leftover folders")
})

test("a failed run exits non-zero and never touches the data already published", {
  j <- stage(obj)
  expect(run_preprocess(j$rds, j$out)$status == 0)
  before <- tools::md5sum(list.files(j$out, full.names = TRUE))
  writeLines("this is not an rds file", j$rds)
  result <- run_preprocess(j$rds, j$out)
  expect(result$status != 0, "a corrupt file was accepted")
  expect_equal(unname(tools::md5sum(list.files(j$out, full.names = TRUE))), unname(before))
  missing <- run_preprocess(file.path(work, "no-such-file.rds"), j$out)
  expect(missing$status != 0, "a missing input was accepted")
  expect_equal(unname(tools::md5sum(list.files(j$out, full.names = TRUE))), unname(before))
})

test("an object that is not a Seurat object fails with an error, not a published folder", {
  j <- stage(list(a = 1))
  result <- run_preprocess(j$rds, j$out)
  expect(result$status != 0)
  expect(!file.exists(j$out), "a folder was published")
})

test("a wrong assay name fails", {
  j <- stage(obj)
  result <- run_preprocess(j$rds, j$out, "NOPE")
  expect(result$status != 0)
  expect(!file.exists(j$out), "a folder was published")
})

test("missing arguments print the usage and fail", {
  out <- suppressWarnings(system2("Rscript", shQuote(script), stdout = TRUE, stderr = TRUE))
  expect(!is.null(attr(out, "status")) && attr(out, "status") != 0)
  expect(any(grepl("usage: preprocess.R", out)), "no usage message")
})

unlink(work, recursive = TRUE)
finish()
