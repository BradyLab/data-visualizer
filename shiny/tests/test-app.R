# Tests for the helper functions at the top of the Shiny app (app/app.R): the signed viewer context, the dataset folder lookup, the
# tissue map reader and its hit testing, the palette and the level ordering. app.R is sourced, which defines them and builds the app
# without running it.
#   docker run --rm -v "$PWD/shiny:/work:ro" --entrypoint Rscript data-visualizer-shiny /work/tests/test-app.R
args <- commandArgs(trailingOnly = FALSE)
here <- dirname(normalizePath(sub("^--file=", "", args[grep("^--file=", args)])))
source(file.path(here, "harness.R"))

work <- tempfile("shiny-test-")
dir.create(file.path(work, "tissue"), recursive = TRUE)
Sys.setenv(SHINY_SECRET = "test-secret", SHINY_DEV = "", PARQUET_DIR = file.path(work, "parquet"), TISSUE_DIR = file.path(work, "tissue"))
app <- new.env()
suppressPackageStartupMessages(sys.source(file.path(here, "..", "app", "app.R"), envir = app))

ID <- "3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b"

# ---- the signed context -----------------------------------------------------------------------------------------------------------------

# A context made by the backend (services/viewer.ts signShinyContext) with the secret "test-secret" and an expiry in 2100, so a change
# to either side's format shows up here
BACKEND_CTX <- "eyJkYXRhc2V0X2lkIjoiM2YyYjhjMWUtNWE0ZC00ZTZmLTliN2EtMWMyZDNlNGY1YTZiIiwicGxvdHMiOlsiVU1BUCIsIlRpc3N1ZVBsb3QiXSwiY2FuX2Rvd25sb2FkIjp0cnVlLCJleHAiOjQxMDI0NDQ4MDB9.96c3b916f5852bdd13c653727b7300312e9d38c01ebdcb8d66a163c568ddfb96"

# Signs a payload the way the backend does, with the secret the app was started with
sign <- function(payload, secret = "test-secret") {
  body <- gsub("=+$", "", chartr("+/", "-_", openssl::base64_encode(charToRaw(jsonlite::toJSON(payload, auto_unbox = TRUE)))))
  paste0(body, ".", unclass(as.character(openssl::sha256(charToRaw(body), key = charToRaw(secret)))))
}
future <- as.numeric(Sys.time()) + 3600

# Runs the code with a variable of the app temporarily set to another value (on.exit does not work inside a test block)
with_app <- function(name, value, code) {
  old <- get(name, envir = app)
  assign(name, value, envir = app)
  tryCatch(code, finally = assign(name, old, envir = app))
}

test("a context signed by the backend is accepted", {
  payload <- app$verify_context(BACKEND_CTX)
  expect(!is.null(payload), "the backend's context was refused")
  expect_equal(payload$dataset_id, ID)
  expect_equal(as.character(unlist(payload$plots)), c("UMAP", "TissuePlot"))
})

test("a context made here in the same format is accepted too", {
  expect_equal(app$verify_context(sign(list(dataset_id = ID, plots = list("UMAP"), exp = future)))$dataset_id, ID)
})

test("a context signed with another secret, edited or cut short is refused", {
  expect(is.null(app$verify_context(sign(list(dataset_id = ID, plots = list(), exp = future), secret = "other"))))
  parts <- strsplit(BACKEND_CTX, ".", fixed = TRUE)[[1]]
  forged <- paste0(chartr("A", "B", parts[[1]]), ".", parts[[2]])
  expect(is.null(app$verify_context(forged)), "an edited payload was accepted")
  expect(is.null(app$verify_context(paste0(parts[[1]], ".", substr(parts[[2]], 1, 10)))), "a short signature was accepted")
  expect(is.null(app$verify_context(parts[[1]])), "an unsigned payload was accepted")
  expect(is.null(app$verify_context(paste0(BACKEND_CTX, ".extra"))), "extra parts were accepted")
})

test("an expired context, a missing one and junk are refused", {
  expect(is.null(app$verify_context(sign(list(dataset_id = ID, plots = list(), exp = as.numeric(Sys.time()) - 10)))))
  expect(is.null(app$verify_context(sign(list(dataset_id = ID, plots = list())))), "a context without an expiry was accepted")
  expect(is.null(app$verify_context(NULL)))
  expect(is.null(app$verify_context(c(BACKEND_CTX, BACKEND_CTX))))
  expect(is.null(app$verify_context("not a context")))
  expect(is.null(app$verify_context("")))
})

test("without SHINY_SECRET nothing verifies", {
  with_app("SECRET", "", expect(is.null(app$verify_context(BACKEND_CTX))))
})

test("same_string compares whole strings", {
  expect(app$same_string("abc", "abc"))
  expect(!app$same_string("abc", "abd"))
  expect(!app$same_string("abc", "abcd"))
  expect(!app$same_string("", "a"))
})

test("viewer_context gives the dataset and offered plots, and accepts a bare ?dataset= only in dev mode", {
  context <- app$viewer_context(list(ctx = BACKEND_CTX))
  expect_equal(context$dataset_id, ID)
  expect_equal(context$plots, c("UMAP", "TissuePlot"))
  expect(!context$can_download, "a context without can_download allowed downloads")
  expect(context$can_download, "the backend's can_download was not read")
  # a context without can_download (or with it false) never allows downloads
  expect(!app$viewer_context(list(ctx = sign(list(dataset_id = ID, plots = list(), exp = future))))$can_download)
  expect(!app$viewer_context(list(ctx = sign(list(dataset_id = ID, plots = list(), can_download = FALSE, exp = future))))$can_download)
  expect(is.null(app$viewer_context(list(dataset = ID))), "a bare dataset id was accepted outside dev mode")
  expect(is.null(app$viewer_context(list())))
  with_app("DEV", TRUE, {
    expect_equal(app$viewer_context(list(dataset = ID))$plots, character())
    # a valid context still wins over the bare id
    expect_equal(app$viewer_context(list(ctx = BACKEND_CTX, dataset = "other"))$dataset_id, ID)
  })
})

# ---- paths built from ids ---------------------------------------------------------------------------------------------------------------

test("dataset_dir only builds a path from a UUID, lowercased", {
  expect_equal(app$dataset_dir(ID), file.path(app$PARQUET_DIR, ID))
  expect_equal(app$dataset_dir(toupper(ID)), file.path(app$PARQUET_DIR, ID))
  for (bad in list(NULL, "", "../etc/passwd", paste0(ID, "/.."), "3f2b8c1e", c(ID, ID), NA_character_, paste0(ID, "\n"))) {
    expect(is.null(app$dataset_dir(bad)), paste("accepted", paste(deparse(bad), collapse = "")))
  }
})

test("TISSUE_PLOT_file finds the newest version of the dataset's map, and nothing else", {
  expect(is.null(app$TISSUE_PLOT_file(ID)), "found a map where there is none")
  for (name in c("_TISSUE_PLOT_v1.csv", "_TISSUE_PLOT_v2.csv", "_TISSUE_PLOT_v10.csv")) {
    file.create(file.path(work, "tissue", paste0(ID, name)))
  }
  file.create(file.path(work, "tissue", "11111111-5a4d-4e6f-9b7a-1c2d3e4f5a6b_TISSUE_PLOT_v99.csv"))
  file.create(file.path(work, "tissue", paste0(ID, "_TISSUE_PLOT_v3.csv.bak")))
  expect_equal(basename(app$TISSUE_PLOT_file(ID)), paste0(ID, "_TISSUE_PLOT_v10.csv"), "10 must beat 2")
  expect(is.null(app$TISSUE_PLOT_file("../x")))
  expect(is.null(app$TISSUE_PLOT_file(NULL)))
})

# ---- the tissue map ---------------------------------------------------------------------------------------------------------------------

write_map <- function(lines) {
  path <- tempfile(fileext = ".csv", tmpdir = work)
  writeLines(lines, path)
  path
}

test("read_TISSUE_PLOT reads a ggPlantmap table and orders each outline by point", {
  map <- app$read_TISSUE_PLOT(write_map(c(
    '"ROI.name","ROI.id","point","x","y"',
    '"B",2,1,5,5',
    '"A",1,2,1,0',
    '"A",1,1,0,0',
    '"A",1,3,1,1',
    '"B",2,2,6,5'
  )))
  expect(!is.null(map))
  expect_equal(names(map)[1:5], c("ROI.name", "ROI.id", "x", "y", "point"))
  expect_equal(map$ROI.id, c(1, 1, 1, 2, 2))
  expect_equal(map$point[map$ROI.id == 1], c(1, 2, 3))
  expect_equal(map$x[map$ROI.id == 1], c(0, 1, 1))
})

test("read_TISSUE_PLOT takes the rows as drawing order without a point column, and ignores the Level columns", {
  map <- app$read_TISSUE_PLOT(write_map(c("ROI.name,ROI.id,x,y,Level1", "A,1,0,0,x", "A,1,1,0,x", "B,2,5,5,y")))
  expect_equal(map$point, c(1, 2, 1))
})

test("read_TISSUE_PLOT refuses a file it cannot draw", {
  expect(is.null(app$read_TISSUE_PLOT(write_map(c("name,x,y", "A,1,2")))), "no ROI columns")
  expect(is.null(app$read_TISSUE_PLOT(write_map(c("ROI.name,ROI.id,x,y", "A,1,left,right")))), "text coordinates")
  expect(is.null(app$read_TISSUE_PLOT(write_map("ROI.name,ROI.id,x,y"))), "no rows")
  expect(is.null(suppressWarnings(app$read_TISSUE_PLOT(file.path(work, "missing.csv")))), "missing file")
  expect(is.null(app$read_TISSUE_PLOT(write_map(""))), "empty file")
})

test("read_TISSUE_PLOT drops rows with missing values", {
  map <- app$read_TISSUE_PLOT(write_map(c("ROI.name,ROI.id,x,y", "A,1,0,0", "A,1,,1", "A,1,2,2")))
  expect_equal(nrow(map), 2L)
})

square <- function(x0, y0, size) list(x = c(x0, x0 + size, x0 + size, x0), y = c(y0, y0, y0 + size, y0 + size))

test("point_in_polygon tells inside from outside, including a concave shape", {
  sq <- square(0, 0, 10)
  expect(app$point_in_polygon(5, 5, sq$x, sq$y))
  expect(!app$point_in_polygon(15, 5, sq$x, sq$y))
  expect(!app$point_in_polygon(5, -1, sq$x, sq$y))
  # an L shape: the notch at the top right is outside
  lx <- c(0, 10, 10, 5, 5, 0)
  ly <- c(0, 0, 5, 5, 10, 10)
  expect(app$point_in_polygon(2, 8, lx, ly))
  expect(app$point_in_polygon(8, 2, lx, ly))
  expect(!app$point_in_polygon(8, 8, lx, ly))
})

test("outline_at finds the outline under a point, the topmost where they overlap, and NULL on the background", {
  a <- square(0, 0, 10)
  b <- square(5, 5, 10)
  map <- data.frame(ROI.name = rep(c("A", "B"), each = 4), ROI.id = rep(c(1, 2), each = 4), x = c(a$x, b$x), y = c(a$y, b$y))
  expect_equal(app$outline_at(map, 2, 2)$ROI.name, "A")
  expect_equal(app$outline_at(map, 12, 12)$ROI.name, "B")
  expect_equal(app$outline_at(map, 7, 7)$ROI.name, "B", "the later outline is on top")
  expect(is.null(app$outline_at(map, 50, 50)))
  expect(is.null(app$outline_at(map, 2, 12)))
})

# ---- colors and ordering ----------------------------------------------------------------------------------------------------------------

test("colorblind_palette gives n distinct colors, from Okabe-Ito up to 8 and Polychrome after", {
  for (n in c(1, 5, 8, 9, 36, 60)) {
    colors <- app$colorblind_palette(n)
    expect_equal(length(colors), n, paste("length for", n))
    expect(!anyNA(colors), paste("NA colors for", n))
  }
  expect_equal(length(unique(app$colorblind_palette(8))), 8L)
  expect_equal(length(unique(app$colorblind_palette(36))), 36L)
  expect(!"#000000" %in% app$colorblind_palette(8), "black is kept for labels")
  expect_equal(app$colorblind_palette(3), app$colorblind_palette(8)[1:3], "the first colors do not change with n")
})

test("sort_clusters sorts numbers as numbers and anything else as text, once each", {
  expect_equal(app$sort_clusters(c("10", "2", "1", "2")), c("1", "2", "10"))
  expect_equal(app$sort_clusters(c("b", "a", "10")), c("10", "a", "b"))
  expect_equal(app$sort_clusters(c(3, 1, 2)), c("1", "2", "3"))
})

test("ordered_levels follows the object's factor levels, then sorts the rest", {
  levels <- data.frame(column = c("type", "type", "type", "other"), level_idx = c(2, 0, 1, 0), level = c("C", "A", "B", "Z"))
  expect_equal(app$ordered_levels(levels, "type", c("C", "A", "B")), c("A", "B", "C"))
  # values the table does not list come last, sorted; levels with no cells are dropped
  expect_equal(app$ordered_levels(levels, "type", c("B", "X", "D")), c("B", "D", "X"))
  # a column that was not a factor, or a dataset with no table, is sorted
  expect_equal(app$ordered_levels(levels, "unlisted", c("10", "2")), c("2", "10"))
  expect_equal(app$ordered_levels(NULL, "type", c("b", "a")), c("a", "b"))
})

unlink(work, recursive = TRUE)
finish()
