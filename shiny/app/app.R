# Interactive plots for one dataset, read from the Parquet files in <PARQUET_DIR>/<dataset id>/ (see ../README.md).
#
# Who may see what is decided by Express, which proxies requests here only for permitted users. Shiny Server does not pass request
# headers to the app, so Express puts a signed context in the iframe URL (?ctx=<base64url JSON>.<hex HMAC-SHA256>, made with the
# SHINY_SECRET shared with Express): the dataset id and the plots the dataset offers. The signature means
# the browser can read it but not change it, so a viewer cannot switch to another dataset by editing the URL.
# For local development without the proxy, set SHINY_DEV=1 to also accept ?dataset=<uuid> in the URL.
library(shiny)
library(DBI)
library(duckdb)
library(jsonlite)
library(openssl)
library(ggplot2)
library(scattermore)
library(ggPlantmap)

PARQUET_DIR <- Sys.getenv("PARQUET_DIR", "/data/parquet")
# Tissue maps the editors upload (backend/src/services/storage.ts names them <dataset id>_TISSUE_PLOT_v<version>.csv)
TISSUE_DIR <- Sys.getenv("TISSUE_DIR", "/data/tissue")
SECRET <- Sys.getenv("SHINY_SECRET")
DEV <- identical(Sys.getenv("SHINY_DEV"), "1")
UUID_RE <- "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

# Dataset folder for an id, or NULL unless the id is a UUID (it becomes part of a path, so nothing else may through)
dataset_dir <- function(dataset_id) {
  if (is.null(dataset_id) || length(dataset_id) != 1 || !grepl(UUID_RE, dataset_id)) {
    return(NULL)
  }
  file.path(PARQUET_DIR, tolower(dataset_id))
}

# Whether two strings are equal, looking at every byte so the time taken does not reveal how much of a signature was right
same_string <- function(a, b) {
  a <- as.integer(charToRaw(a))
  b <- as.integer(charToRaw(b))
  length(a) == length(b) && sum(a != b) == 0
}

# The payload (a list) of a context made by Express, or NULL if it is missing, forged, malformed or expired
verify_context <- function(token) {
  if (is.null(token) || length(token) != 1 || !nzchar(SECRET)) {
    return(NULL)
  }
  parts <- strsplit(token, ".", fixed = TRUE)[[1]]
  if (length(parts) != 2) {
    return(NULL)
  }
  # as.character keeps the "hash" class, which would make an equality test fail even for equal text, so drop it
  expected <- unclass(as.character(sha256(charToRaw(parts[[1]]), key = charToRaw(SECRET))))
  if (!same_string(expected, parts[[2]])) {
    return(NULL)
  }
  b64 <- chartr("-_", "+/", parts[[1]])
  b64 <- paste0(b64, strrep("=", (4 - nchar(b64) %% 4) %% 4))
  payload <- tryCatch(fromJSON(rawToChar(base64_decode(b64)), simplifyVector = FALSE), error = function(e) NULL)
  if (is.null(payload) || !is.numeric(payload$exp) || payload$exp < as.numeric(Sys.time())) {
    return(NULL)
  }
  payload
}

# Who is looking at what: list(dataset_id, plots) from the signed ctx in the URL, or NULL if there is none that is valid.
# With SHINY_DEV=1 a bare ?dataset=<uuid> is accepted too (every plot)
viewer_context <- function(query) {
  payload <- verify_context(query$ctx)
  if (!is.null(payload)) {
    return(list(dataset_id = payload$dataset_id, plots = as.character(unlist(payload$plots))))
  }
  if (DEV && !is.null(query$dataset)) {
    return(list(dataset_id = query$dataset, plots = character()))
  }
  NULL
}

`%||%` <- function(a, b) if (is.null(a)) b else a

# The dataset's current tissue map file (a CSV of a ggPlantmap table), or NULL when none was uploaded or the id is not a UUID
TISSUE_PLOT_file <- function(dataset_id) {
  if (is.null(dataset_id) || length(dataset_id) != 1 || !grepl(UUID_RE, dataset_id)) {
    return(NULL)
  }
  files <- list.files(TISSUE_DIR, pattern = sprintf("^%s_TISSUE_PLOT_v[0-9]+\\.csv$", tolower(dataset_id)), full.names = TRUE)
  if (length(files) == 0) {
    return(NULL)
  }
  files[which.max(as.integer(sub(".*_v([0-9]+)\\.csv$", "\\1", files)))]
}

# A tissue map as a ggPlantmap table (a tibble with one row per outline vertex: ROI.name, ROI.id, point, x, y), or NULL if the file
# cannot be read. ROI.name names the cell type an outline stands for, which has to match the cell labels of the dataset to get a color.
# Without `point` the rows are taken to be in drawing order; without ROI.name the outlines cannot be matched, so the file is refused.
read_TISSUE_PLOT <- function(path) {
  raw <- tryCatch(read.csv(path, check.names = FALSE, stringsAsFactors = FALSE), error = function(e) NULL)
  if (is.null(raw) || !all(c("ROI.name", "ROI.id", "x", "y") %in% names(raw))) {
    return(NULL)
  }
  map <- data.frame(
    ROI.name = as.character(raw$ROI.name),
    ROI.id = raw$ROI.id,
    x = suppressWarnings(as.numeric(raw$x)),
    y = suppressWarnings(as.numeric(raw$y)),
    stringsAsFactors = FALSE
  )
  map$point <- if ("point" %in% names(raw)) raw$point else ave(seq_len(nrow(map)), map$ROI.id, FUN = seq_along)
  map <- map[stats::complete.cases(map), , drop = FALSE]
  if (nrow(map) == 0) {
    return(NULL)
  }
  dplyr::as_tibble(map[order(map$ROI.id, map$point), ])
}

# Whether the point (px, py) is inside the polygon with these corners (ray casting: count the edges a ray to the right crosses)
point_in_polygon <- function(px, py, x, y) {
  j <- c(length(x), seq_len(length(x) - 1))
  sum(((y > py) != (y[j] > py)) & (px < (x[j] - x) * (py - y) / (y[j] - y) + x)) %% 2 == 1
}

# The outline of a tissue map table under the point (px, py), as the first row of its vertices, or NULL; where outlines overlap, the one
# drawn last (the one on top) wins
outline_at <- function(map, px, py) {
  hit <- NULL
  for (part in split(map, map$ROI.id)) {
    if (px >= min(part$x) && px <= max(part$x) && py >= min(part$y) && py <= max(part$y) && point_in_polygon(px, py, part$x, part$y)) {
      hit <- part[1, , drop = FALSE]
    }
  }
  hit
}

# The columns that label the cells: the annotations (cell type names) when the data has them, else the cluster numbers. They are what
# the cell type picker filters on and what the plots color, group and label by.
ANNOTATION_COL <- "seurat_annotations"
CLUSTER_COL <- "seurat_clusters"
# The column the tissue plot averages by: its values are matched to the ROI.name of the tissue map. Without it the cell labels are used.
TISSUE_COL <- "tissue_type"
# Most charts one UMAP or PCA plot can fan out into, one per picked group by column
MAX_GROUP_PLOTS <- 8
# Columns with more distinct values than this are not offered to group or split the UMAP and PCA by
MAX_GROUPS <- 50

# The heatmap has a column per cell; above this many cells it draws a random sample
MAX_HEATMAP_CELLS <- 20000

# Colorblind-friendly colors for n groups, like scCustomize's discrete palettes: Okabe-Ito (without its black, which the labels and
# points use) for up to 8, then Polychrome 36, then Polychrome 36 stretched for more
colorblind_palette <- function(n) {
  if (n <= 8) {
    return(unname(palette.colors(9, "Okabe-Ito")[-1][seq_len(n)]))
  }
  polychrome <- unname(palette.colors(36, "Polychrome 36"))
  if (n <= 36) polychrome[seq_len(n)] else colorRampPalette(polychrome)(n)
}

# Columns of cells.parquet that are not metadata to color by
COORD_RE <- "^(umap|pca)_[0-9]+$"

# Tells the page that embeds us how tall our content is, so its iframe can grow to fit it (the parent checks the message came from this
# frame). It must wait for the document: this script sits in <head>, where document.body does not exist yet.
REPORT_HEIGHT_JS <- "
document.addEventListener('DOMContentLoaded', function () {
  var last = 0;
  function report() {
    var h = Math.ceil(document.body.getBoundingClientRect().height) + 24;
    if (h !== last && window.parent !== window) { last = h; window.parent.postMessage({ type: 'viewer-height', height: h }, '*'); }
  }
  new ResizeObserver(report).observe(document.body);
  report();
});
"

# Plots this viewer can draw, by the names the dataset page uses (commons/dataset.ts); UMAP is what shows unless the page asks for more
SUPPORTED_PLOTS <- c("UMAP", "PCA", "ViolinPlot", "DotPlot", "Heatmap", "TissuePlot")

# Cluster ids are usually numbers stored as text: order them 2 before 10
sort_clusters <- function(x) {
  x <- unique(as.character(x))
  if (!anyNA(suppressWarnings(as.numeric(x)))) x[order(as.numeric(x))] else sort(x)
}

# Values in the order of their column's factor levels in the Seurat object (column_levels.parquet, read into `table`); values it does not
# list, or all of them for a column that was not a factor or a dataset without the file, are sorted by sort_clusters
ordered_levels <- function(table, column, values) {
  values <- unique(as.character(values))
  known <- if (is.null(table)) character() else table$level[table$column == column][order(table$level_idx[table$column == column])]
  c(intersect(known, values), sort_clusters(setdiff(values, known)))
}

# html/body: the parent sizes the iframe to the content, so the page itself never scrolls. .options-row lays out the option controls; the
# rest paints the Update plots button, the chart width slider and the label checkbox in the accent color.
ACCENT <- "#103819"
STYLE <- paste0(
  "
html, body { overflow-y: hidden; }
#generate { background-color: ",
  ACCENT,
  "; border-color: ",
  ACCENT,
  "; color: #fff; }
#generate:hover, #generate:focus, #generate:active { background-color: ",
  ACCENT,
  "; border-color: ",
  ACCENT,
  "; filter: brightness(1.25); }
.options-row { display: flex; flex-wrap: wrap; gap: 0 30px; }
.options-row > .shiny-html-output { display: contents; }
.options-row > .accent, .options-row .shiny-panel-conditional { width: calc((100% - 90px) / 4); } /* the width of a column in the row above */
.accent .irs--shiny .irs-bar, .accent .irs--shiny .irs-handle { background: ",
  ACCENT,
  "; border-color: ",
  ACCENT,
  "; }
.accent .irs--shiny .irs-single, .accent .irs--shiny .irs-from, .accent .irs--shiny .irs-to { background-color: ",
  ACCENT,
  "; }
.accent input[type=checkbox] { accent-color: ",
  ACCENT,
  "; }
"
)

ui <- fluidPage(
  tags$head(
    tags$style(HTML(STYLE)),
    # the parent sizes the iframe to the content, so the page itself never scrolls
    tags$script(HTML(REPORT_HEIGHT_JS))
  ),
  fluidRow(
    column(3, uiOutput("plot_picker")),
    column(3, uiOutput("gene_picker")),
    column(3, uiOutput("cell_type_picker"))
  ),
  # Chart options, in the same four columns as the pickers above; the button applies everything
  # A flex row rather than grid columns, so the controls that are hidden (group by and split by without a UMAP or PCA) free their space
  div(
    class = "options-row",
    uiOutput("group_picker"),
    uiOutput("split_picker"),
    div(
      class = "accent",
      sliderInput("chart_size", "Chart width (px)", min = 300, max = 1200, value = 600, step = 50, ticks = FALSE, width = "100%")
    ),
    div(class = "accent", style = "margin-top: 25px", checkboxInput("label", "Label clusters", value = TRUE)),
    uiOutput("na_cutoff_picker"),
    uiOutput("violin_options")
  ),
  fluidRow(
    column(12, actionButton("generate", "Update plots", class = "btn-primary"))
  ),
  fluidRow(
    column(12, uiOutput("status"), uiOutput("plots_ui"))
  )
)

server <- function(input, output, session) {
  # The URL query string is a reactive value; it is read once, when the session starts, so isolate() makes that legal here
  query <- isolate(parseQueryString(session$clientData$url_search))
  context <- viewer_context(query)
  dataset_id <- context$dataset_id
  dir <- dataset_dir(dataset_id)
  cells_file <- if (is.null(dir)) NULL else file.path(dir, "cells.parquet")
  ready <- !is.null(cells_file) && file.exists(cells_file)

  # Plots the dataset offers (signed)
  offered <- context$plots

  # One in-memory DuckDB per session (cheap), closed with it; the Parquet files are only read
  con <- dbConnect(duckdb())
  session$onSessionEnded(function() dbDisconnect(con, shutdown = TRUE))
  cells_sql <- function(select = "*") {
    sprintf("SELECT %s FROM read_parquet(%s)", select, dbQuoteString(con, cells_file))
  }
  genes_file <- if (is.null(dir)) NULL else file.path(dir, "genes.parquet")
  expression_file <- if (is.null(dir)) NULL else file.path(dir, "expression.parquet")
  has_genes <- ready && file.exists(genes_file) && file.exists(expression_file)
  # The level order of the object's factor columns; datasets processed before it was written lack the file
  levels_file <- if (is.null(dir)) NULL else file.path(dir, "column_levels.parquet")
  levels_table <- if (ready && file.exists(levels_file)) {
    dbGetQuery(con, sprintf("SELECT * FROM read_parquet(%s)", dbQuoteString(con, levels_file)))
  } else {
    NULL
  }
  level_order <- function(column, values) ordered_levels(levels_table, column, values)

  # The object's scale.data (what DoHeatmap draws), for the genes it has; datasets processed before it was written lack the file
  scale_file <- if (is.null(dir)) NULL else file.path(dir, "scale_data.parquet")
  has_scaled <- has_genes && file.exists(scale_file)

  # Gene names for the picker, variable features first so they are the first suggestions
  gene_names <- reactive({
    req(has_genes)
    dbGetQuery(con, sprintf("SELECT gene FROM read_parquet(%s) ORDER BY is_variable DESC, gene_idx", dbQuoteString(con, genes_file)))$gene
  })

  # Expression of the genes for every cell as a cells x genes matrix (0 where the sparse file has no entry), in cells.parquet row order
  expression_matrix <- function(genes, n_cells) {
    found <- dbGetQuery(
      con,
      sprintf(
        "SELECT gene_idx, gene FROM read_parquet(%s) WHERE gene IN (%s)",
        dbQuoteString(con, genes_file),
        paste(dbQuoteString(con, genes), collapse = ", ")
      )
    )
    m <- matrix(0, nrow = n_cells, ncol = length(genes), dimnames = list(NULL, genes))
    if (nrow(found) > 0) {
      nz <- dbGetQuery(
        con,
        sprintf(
          "SELECT gene_idx, cell_idx, value FROM read_parquet(%s) WHERE gene_idx IN (%s)",
          dbQuoteString(con, expression_file),
          paste(found$gene_idx, collapse = ", ")
        )
      )
      m[cbind(nz$cell_idx + 1, match(found$gene, genes)[match(nz$gene_idx, found$gene_idx)])] <- nz$value
    }
    m
  }

  column_info <- reactive({
    req(ready)
    dbGetQuery(con, paste("DESCRIBE", cells_sql()))
  })
  # Scaled values of the genes for every cell as a cells x genes matrix, in cells.parquet row order; NA where the object has none (a gene
  # that is not in scale.data, or a cell it was not computed for)
  scaled_matrix <- function(genes, n_cells) {
    m <- matrix(NA_real_, nrow = n_cells, ncol = length(genes), dimnames = list(NULL, genes))
    found <- dbGetQuery(
      con,
      sprintf(
        "SELECT gene_idx, gene FROM read_parquet(%s) WHERE gene IN (%s)",
        dbQuoteString(con, genes_file),
        paste(dbQuoteString(con, genes), collapse = ", ")
      )
    )
    if (nrow(found) > 0) {
      sc <- dbGetQuery(
        con,
        sprintf(
          "SELECT gene_idx, cell_idx, value FROM read_parquet(%s) WHERE gene_idx IN (%s)",
          dbQuoteString(con, scale_file),
          paste(found$gene_idx, collapse = ", ")
        )
      )
      m[cbind(sc$cell_idx + 1, match(found$gene, genes)[match(sc$gene_idx, found$gene_idx)])] <- sc$value
    }
    m
  }

  columns <- reactive(column_info()$column_name)

  # The column that labels the cells (see ANNOTATION_COL); NA when the data has neither column, then nothing can be drawn
  label_col <- reactive(c(intersect(c(ANNOTATION_COL, CLUSTER_COL), columns()), NA_character_)[[1]])
  has_clusters <- reactive(ready && !is.na(label_col()))

  # Metadata columns the UMAP and PCA can be grouped or split by: text, logical and cluster columns with at most MAX_GROUPS values,
  # and how many values each has
  group_counts <- reactive({
    info <- column_info()
    cols <- setdiff(info$column_name, c("barcode", grep(COORD_RE, info$column_name, value = TRUE)))
    cols <- cols[info$column_type[match(cols, info$column_name)] %in% c("VARCHAR", "BOOLEAN") | cols %in% c(CLUSTER_COL, label_col())]
    if (length(cols) == 0) {
      return(integer())
    }
    q <- dbQuoteIdentifier(con, cols)
    counts <- unlist(dbGetQuery(con, cells_sql(paste0("COUNT(DISTINCT ", q, ") AS c", seq_along(cols), collapse = ", "))))
    names(counts) <- cols
    counts[counts <= MAX_GROUPS | names(counts) %in% label_col()]
  })

  # The tissue map of the dataset (read once per session); the tissue plot needs it, so it is not offered without one
  tissue_path <- TISSUE_PLOT_file(dataset_id)
  TISSUE_PLOT <- if (is.null(tissue_path)) NULL else read_TISSUE_PLOT(tissue_path)

  # Plots to choose from: what the dataset offers (all of them when there is no offered list, which only happens with SHINY_DEV)
  available_plots <- if (length(offered) > 0) SUPPORTED_PLOTS[SUPPORTED_PLOTS %in% offered] else SUPPORTED_PLOTS
  if (is.null(TISSUE_PLOT)) {
    available_plots <- setdiff(available_plots, "TissuePlot")
  }

  output$plot_picker <- renderUI({
    if (!ready) {
      return(NULL)
    }
    selectizeInput(
      "plots",
      "Pick your plots",
      choices = available_plots,
      selected = default_plots,
      multiple = TRUE,
      options = list(placeholder = "UMAP", plugins = list("remove_button", "clear_button"))
    )
  })

  # Like Seurat's group.by / split.by for DimPlot: group colors the cells by a column, split draws one panel per value of a column
  # Group by matters for the UMAP, PCA and heatmap, split by only for the UMAP, PCA and violin plot, so each shows while one of its plots is in the plot
  # picker (an empty picker means the default plots). The panel is only hidden, not removed, so a choice made earlier is still there when
  # it comes back.
  plot_condition <- function(plots) {
    default_shown <- tolower(any(plots %in% default_plots))
    has <- paste(sprintf("input.plots.indexOf('%s') >= 0", plots), collapse = " || ")
    sprintf("(!input.plots || input.plots.length == 0) ? %s : (%s)", default_shown, has)
  }

  group_choices <- reactive(if (has_clusters()) names(group_counts()) else character())
  output$group_picker <- renderUI({
    if (length(group_choices()) == 0) {
      return(NULL)
    }
    conditionalPanel(
      plot_condition(c("UMAP", "PCA", "Heatmap")),
      selectizeInput(
        "group_by",
        "Group by (UMAP, PCA, Heatmap)",
        choices = group_choices(),
        selected = label_col(),
        multiple = TRUE,
        width = "100%",
        options = list(plugins = list("remove_button", "clear_button"))
      )
    )
  })
  output$split_picker <- renderUI({
    if (length(group_choices()) == 0) {
      return(NULL)
    }
    # One column at a time (picking another swaps it); the x that shows on hover, or "None", goes back to no split
    conditionalPanel(
      plot_condition(c("UMAP", "PCA", "ViolinPlot")),
      selectizeInput(
        "split_by",
        "Split by (UMAP, PCA, Violin)",
        choices = c("None" = "", group_choices()),
        selected = "",
        width = "100%",
        options = list(plugins = list("clear_button"))
      )
    )
  })

  # scCustomize's na_cutoff: cells expressing a picked gene at or below it are drawn grey under the others (UMAP and PCA only); empty (NA) is no cutoff
  output$na_cutoff_picker <- renderUI({
    if (!has_genes) {
      return(NULL)
    }
    conditionalPanel(
      plot_condition(c("UMAP", "PCA")),
      div(
        class = "accent",
        numericInput(
          "na_cutoff",
          "Grey out expression at or below (UMAP, PCA)",
          value = NA,
          min = 0,
          step = 0.1,
          width = "100%"
        )
      )
    )
  })
  output$violin_options <- renderUI({
    if (!has_genes) {
      return(NULL)
    }
    conditionalPanel(
      plot_condition("ViolinPlot"),
      div(
        class = "accent",
        style = "margin-top: 25px",
        checkboxInput("violin_median", "Show median (Violin)", value = FALSE),
        checkboxInput("violin_box", "Show boxplot (Violin)", value = FALSE)
      )
    )
  })

  # Server-side selectize: the browser only receives the matches for what is typed, which matters with tens of thousands of genes
  output$gene_picker <- renderUI({
    if (!has_genes) {
      return(NULL)
    }
    selectizeInput(
      "gene",
      "Pick your genes",
      choices = NULL,
      multiple = TRUE,
      options = list(placeholder = "Search genes", maxOptions = 50, plugins = list("remove_button", "clear_button"))
    )
  })
  observe({
    req(has_genes)
    updateSelectizeInput(session, "gene", choices = gene_names(), server = TRUE)
  })

  # Cell types are the clusters; nothing selected means all cells
  output$cell_type_picker <- renderUI({
    if (!ready) {
      return(NULL)
    }
    selectizeInput(
      "cell_types",
      "Pick your cell types",
      choices = NULL,
      multiple = TRUE,
      options = list(placeholder = "All clusters", plugins = list("remove_button", "clear_button"))
    )
  })
  all_clusters <- reactive({
    req(has_clusters())
    level_order(label_col(), dbGetQuery(con, cells_sql(paste("DISTINCT", dbQuoteIdentifier(con, label_col()), "AS v")))$v)
  })
  observe(updateSelectizeInput(session, "cell_types", choices = all_clusters()))

  # What the plots show. Read on startup (the button starts at 0, which ignoreNULL = FALSE lets through) and on every press of the
  # button, so picking genes or cell types changes nothing until then
  selection <- eventReactive(
    input$generate,
    {
      list(
        plots = input$plots,
        genes = if (has_genes) input$gene else character(),
        cell_types = input$cell_types,
        label = isTRUE(input$label),
        group_by = input$group_by,
        split_by = input$split_by %||% "",
        na_cutoff = input$na_cutoff %||% NA_real_,
        violin_median = isTRUE(input$violin_median),
        violin_box = isTRUE(input$violin_box)
      )
    },
    ignoreNULL = FALSE
  )

  # The plot shown first: the UMAP, or the first plot the dataset offers when it does not offer that
  default_plots <- if ("UMAP" %in% available_plots) "UMAP" else head(available_plots, 1)

  # The plots on screen follow the picker as of the last press of the button; picking none falls back to the defaults
  shown <- reactive({
    chosen <- selection()$plots
    if (length(chosen) == 0) default_plots else SUPPORTED_PLOTS[SUPPORTED_PLOTS %in% chosen]
  })

  # A split by column or the violin, dot or heat plot makes the charts wide, so picking one sets the width slider to its maximum, and
  # going back to none sets the default; the slider can still be moved afterwards. An empty plot picker means the defaults.
  observe({
    plots <- if (length(input$plots)) input$plots else default_plots
    wide <- nzchar(input$split_by %||% "") || any(c("ViolinPlot", "DotPlot", "Heatmap") %in% plots)
    updateSliderInput(session, "chart_size", value = if (wide) 1200 else 600)
  })

  chart_size <- debounce(reactive(as.integer(input$chart_size %||% 600)), 300)

  output$plots_ui <- renderUI({
    # Every chart is a box of the slider's width (never wider than the page), flowing left to right and wrapping, so small charts sit
    # side by side. The slider is not held back by Update plots; it is debounced so dragging it does not redraw on every step.
    size <- chart_size()
    ids <- unlist(lapply(shown(), function(p) {
      if (p %in% c("UMAP", "PCA")) {
        paste0("plot_", p, "_", seq_len(n_group_plots()))
      } else if (p == "Heatmap") {
        paste0("plot_Heatmap_", seq_len(n_heatmaps()))
      } else if (p == "TissuePlot" && length(selection()$genes) > 0) {
        c("plot_TissueCells", "plot_TissuePlot")
      } else {
        paste0("plot_", p)
      }
    }))
    div(
      style = "display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start;",
      lapply(ids, function(id) {
        if (id %in% c("plot_TissuePlot", "plot_TissueCells")) {
          # Hovering an outline shows its numbers (tissue_tip / tissue_cells_tip), placed relative to the chart
          hover_id <- if (id == "plot_TissuePlot") "tissue_hover" else "tissue_cells_hover"
          div(
            style = sprintf("width: %dpx; max-width: 100%%; position: relative;", size),
            plotOutput(id, width = "100%", height = "auto", hover = hoverOpts(hover_id, delay = 80, delayType = "debounce")),
            uiOutput(if (id == "plot_TissuePlot") "tissue_tip" else "tissue_cells_tip")
          )
        } else {
          div(style = sprintf("width: %dpx; max-width: 100%%;", size), plotOutput(id, width = "100%", height = "auto"))
        }
      })
    )
  })

  output$status <- renderUI({
    if (is.null(context)) {
      tags$div(class = "alert alert-danger", "This viewer link is missing, invalid or has expired. Reload the dataset page.")
    } else if (!ready) {
      tags$div(class = "alert alert-warning", "Parquet data not found (dataset not processed yet).")
    } else if (!has_clusters()) {
      tags$div(class = "alert alert-warning", paste("This dataset has no", ANNOTATION_COL, "or", CLUSTER_COL, "column to color the plot by."))
    } else if ("TissuePlot" %in% offered && is.null(TISSUE_PLOT)) {
      tags$div(
        class = "alert alert-info",
        "The tissue plot is not available: this dataset has no readable tissue map (a CSV of a ggPlantmap table, with the columns ROI.name, ROI.id, x and y)."
      )
    }
  })

  # Columns the UMAP and PCA are colored by, one chart each (Seurat's group.by with several columns); none picked means the cell labels
  group_cols <- reactive({
    req(has_clusters())
    group <- intersect(selection()$group_by, names(group_counts()))
    if (length(group) == 0) label_col() else head(group, MAX_GROUP_PLOTS)
  })
  # The heatmap needs genes, so unlike the UMAP and PCA it is drawn once per group by column even when genes are picked
  n_heatmaps <- reactive(if (!has_clusters()) 1 else length(group_cols()))
  # Genes color the cells by expression, so group by does not apply and one chart is enough
  n_group_plots <- reactive(if (!has_clusters() || length(selection()$genes) > 0) 1 else length(group_cols()))

  # ---- data shared by the plots (computed once per press of the button) ------------------------------------------------------------
  # Coordinates and cluster of the cells that pass the cell type filter, plus their expression of the picked genes (cells x genes)
  plot_data <- reactive({
    req(has_clusters())
    sel <- selection()
    pcs <- intersect(c("pca_1", "pca_2"), columns())
    # Group and split only count when they name a column we offered (the picker can be stale after a reload)
    group <- group_cols()
    split <- if (isTRUE(sel$split_by %in% names(group_counts()))) sel$split_by else NULL
    q <- function(col, as) paste(dbQuoteIdentifier(con, col), "AS", as)
    cells <- dbGetQuery(
      con,
      cells_sql(paste(
        c(
          "umap_1",
          "umap_2",
          pcs,
          q(label_col(), "cluster"),
          q(group, paste0("grp", seq_along(group))),
          if (!is.null(split)) q(split, "spl")
        ),
        collapse = ", "
      ))
    )
    cells$cluster <- as.character(cells$cluster)
    for (k in paste0("grp", seq_along(group))) {
      cells[[k]] <- as.character(cells[[k]])
    }
    if (!is.null(split)) {
      cells$spl <- as.character(cells$spl)
    }
    selected <- if (length(sel$cell_types)) cells$cluster %in% sel$cell_types else rep(TRUE, nrow(cells))
    keep <- selected
    shiny::validate(shiny::need(any(keep), "No cells match the selection")) # jsonlite also exports validate()
    expr <- if (length(sel$genes) > 0) expression_matrix(sel$genes, nrow(cells))[keep, , drop = FALSE] else NULL
    n_total <- nrow(cells)
    # The UMAP and PCA also draw the cells of the other cell types, in grey (as cells that do not express the gene, when genes are picked)
    background <- cells[!selected, , drop = FALSE]
    cells <- cells[keep, , drop = FALSE]
    list(
      n_total = n_total,
      keep_idx = which(keep),
      background = background,
      na_cutoff = sel$na_cutoff,
      cells = cells,
      expr = expr,
      genes = sel$genes,
      clusters = level_order(label_col(), cells$cluster),
      label = sel$label,
      group_cols = group,
      splits = if (!is.null(split)) level_order(split, cells$spl),
      scatter_splits = if (!is.null(split)) level_order(split, c(cells$spl, background$spl))
    )
  })

  # One row per cell and gene, for the plots that need expression; asks for genes when none were picked
  long_expression <- function(d) {
    shiny::validate(shiny::need(length(d$genes) > 0, "Pick at least one gene, then press Update plots."))
    df <- data.frame(
      cluster = factor(rep(d$cells$cluster, times = length(d$genes)), levels = d$clusters),
      gene = factor(rep(d$genes, each = nrow(d$cells)), levels = d$genes),
      value = as.vector(d$expr)
    )
    if (!is.null(d$splits)) {
      df$spl <- factor(rep(d$cells$spl, times = length(d$genes)), levels = d$splits)
    }
    df
  }

  # Width of a plot's box as the browser laid it out, for heights that follow it
  plot_width <- function(id) session$clientData[[paste0("output_", id, "_width")]] %||% 800

  # Panels of about 4:3 cells, 350-700 px tall each
  grid_height <- function(id, rows, cols) {
    as.integer(rows * max(350, min(700, plot_width(id) / cols * 0.75)))
  }

  # Styled like Seurat's DimPlot / FeaturePlot: no grid, axis lines only, discrete groups in a colorblind-friendly palette, numeric values
  # on a plasma gradient (dark = high) with the highest values drawn last and cells that do not express the gene grey underneath. Above 100k cells Seurat rasterizes the points; so do we.
  # With genes there is a panel per gene (and per split value, genes down and splits across, like FeaturePlot's split.by) and group.by
  # does not apply, as in FeaturePlot; without genes the cells are colored by the group and split.by makes a panel per value.
  scatter_plot <- function(x, y, i = 1) {
    d <- plot_data()
    shiny::validate(shiny::need(all(c(x, y) %in% names(d$cells)), paste("This dataset has no", x, "/", y, "coordinates.")))
    split <- !is.null(d$splits)
    if (length(d$genes) > 0) {
      n <- length(d$genes)
      # The cells of the cell types that were not picked count as not expressing; they and the cells at or below na_cutoff (when set) are
      # NA (drawn grey) and sorted first, so the expressing cells are drawn on top of them
      shown_cells <- rbind(d$cells[c(x, y, if (split) "spl")], d$background[c(x, y, if (split) "spl")])
      expr <- rbind(d$expr, matrix(NA_real_, nrow(d$background), n))
      if (!is.na(d$na_cutoff)) {
        expr[!is.na(expr) & expr <= d$na_cutoff] <- NA
      }
      df <- data.frame(
        x = rep(shown_cells[[x]], times = n),
        y = rep(shown_cells[[y]], times = n),
        color = as.vector(expr),
        gene = factor(rep(d$genes, each = nrow(shown_cells)), levels = d$genes)
      )
      if (split) {
        df$spl <- factor(rep(shown_cells$spl, times = n), levels = d$scatter_splits)
      }
      df <- df[order(!is.na(df$color), df$color), ]
    } else {
      grp <- d$cells[[paste0("grp", i)]]
      lv <- level_order(d$group_cols[[i]], grp)
      if (split) {
        # Each group in each panel is its own color and label (B_CTRL, B_STIM). Ordered by panel first, then group, so all of one panel's
        # groups take the first stretch of the palette and the next panel's the following one
        lv <- as.vector(outer(lv, d$splits, paste, sep = "_"))
        grp <- paste(grp, d$cells$spl, sep = "_")
        lv <- lv[lv %in% grp]
      }
      df <- data.frame(x = d$cells[[x]], y = d$cells[[y]], color = factor(grp, levels = lv))
      if (split) df$spl <- factor(d$cells$spl, levels = d$scatter_splits)
    }
    p <- ggplot(df, aes(x, y, color = color))
    scatter_layer <- function(...) if (nrow(df) > 1e5) geom_scattermore(pointsize = 2, ...) else geom_point(size = 1, ...)
    # Without genes the cells of the cell types that were not picked are a grey layer under the colored cells
    if (length(d$genes) == 0 && nrow(d$background) > 0) {
      bg <- data.frame(x = d$background[[x]], y = d$background[[y]])
      if (split) {
        bg$spl <- factor(d$background$spl, levels = d$scatter_splits)
      }
      p <- p + scatter_layer(data = bg, mapping = aes(x, y), color = "lightgrey", inherit.aes = FALSE)
    }
    p <- p + scatter_layer()
    p <- p + labs(x = x, y = y, color = NULL) + theme_classic(base_size = 14)
    if (length(d$genes) > 0) {
      p <- p +
        scale_color_viridis_c(option = "plasma", direction = -1, begin = 0.1, end = 0.9, na.value = "lightgrey") +
        labs(color = "Expression")
      if (split) p + facet_grid(gene ~ spl) else p + facet_wrap(~gene, ncol = ceiling(sqrt(length(d$genes))))
    } else {
      # Seurat's LabelClusters: the label sits at the median of each group's coordinates (in each panel when split)
      if (d$label) {
        centers <- aggregate(df[c("x", "y")], df[c("color", if (split) "spl")], median)
        p <- p + geom_text(data = centers, aes(label = color), color = "black", size = 5, show.legend = FALSE)
      }
      if (length(d$group_cols) > 1) {
        p <- p + ggtitle(d$group_cols[[i]])
      }
      p <- p +
        scale_color_manual(values = colorblind_palette(nlevels(df$color)), drop = FALSE) +
        guides(color = guide_legend(override.aes = list(size = 3)))
      if (split) p + facet_wrap(~spl, ncol = min(nlevels(df$spl), 4)) else p
    }
  }

  n_genes <- function() max(1, length(selection()$genes))
  n_clusters <- function() if (length(selection()$cell_types)) length(selection()$cell_types) else length(all_clusters())

  # Rows and columns of panels in the UMAP / PCA plot, mirroring the facets in scatter_plot (an upper bound when cells are filtered out)
  scatter_height <- function(id) {
    sel <- selection()
    splits <- if (isTRUE(sel$split_by %in% names(group_counts()))) group_counts()[[sel$split_by]] else 0
    genes <- length(sel$genes) > 0
    if (splits > 0 && genes) {
      grid_height(id, n_genes(), splits)
    } else if (splits > 0) {
      cols <- min(splits, 4)
      grid_height(id, ceiling(splits / cols), cols)
    } else {
      cols <- ceiling(sqrt(n_genes()))
      grid_height(id, ceiling(n_genes() / cols), cols)
    }
  }

  # One output per group by chart, plot_UMAP_1 ... plot_UMAP_<MAX_GROUP_PLOTS>; the page only holds as many as are picked
  for (i in seq_len(MAX_GROUP_PLOTS)) {
    local({
      i <- i
      for (spec in list(c("UMAP", "umap_1", "umap_2"), c("PCA", "pca_1", "pca_2"))) {
        local({
          spec <- spec
          id <- paste0("plot_", spec[[1]], "_", i)
          output[[id]] <- renderPlot(height = function() scatter_height(id), {
            req(i <= n_group_plots())
            scatter_plot(spec[[2]], spec[[3]], i)
          })
        })
      }
    })
  }

  # Like Seurat's VlnPlot: one violin per cluster, a panel per gene
  output$plot_ViolinPlot <- renderPlot(height = function() as.integer(max(350, 230 * n_genes() + 30)), {
    d <- plot_data()
    df <- long_expression(d)
    # Every cell is drawn as a jittered point over its violin, unless the boxplot or the median is picked, which replace the points.
    # Split by: within each cluster one violin per split value, side by side and colored by the value (clusters are colored otherwise)
    split <- !is.null(d$splits)
    sel <- selection()
    dodge <- position_dodge(width = 0.9)
    p <- if (split) {
      ggplot(df, aes(cluster, value, fill = spl)) +
        geom_violin(scale = "width", adjust = 1, trim = TRUE, linewidth = 0.3, position = dodge) +
        scale_fill_manual(values = colorblind_palette(nlevels(df$spl)), drop = FALSE, name = NULL)
    } else {
      ggplot(df, aes(cluster, value, fill = cluster)) +
        geom_violin(scale = "width", adjust = 1, trim = TRUE, linewidth = 0.3) +
        scale_fill_manual(values = colorblind_palette(nlevels(df$cluster)), drop = FALSE)
    }
    if (sel$violin_box) {
      p <- p + geom_boxplot(width = 0.1, fill = "white", linewidth = 0.3, outlier.shape = NA, position = dodge, show.legend = FALSE)
    }
    if (!sel$violin_box && !sel$violin_median) {
      p <- p +
        if (split) {
          geom_point(
            position = position_jitterdodge(jitter.width = 0.4, dodge.width = 0.9, seed = 1),
            size = 0.3,
            alpha = 0.4,
            color = "black",
            show.legend = FALSE
          )
        } else {
          geom_jitter(width = 0.2, height = 0, size = 0.3, alpha = 0.4, color = "black", show.legend = FALSE)
        }
    }
    if (sel$violin_median) {
      p <- p +
        stat_summary(
          fun = median,
          geom = "point",
          shape = 23,
          size = 2.5,
          fill = "white",
          color = "black",
          position = dodge,
          show.legend = FALSE
        )
    }
    p +
      facet_wrap(~gene, ncol = 1, scales = "free_y", strip.position = "left") +
      labs(x = NULL, y = "Expression") +
      theme_classic(base_size = 14) +
      theme(
        legend.position = if (split) "right" else "none",
        strip.background = element_blank(),
        strip.placement = "outside",
        strip.text.y.left = element_text(angle = 0)
      )
  })

  # Mean expression and share of cells expressing, per cluster and gene (the numbers behind the dot plot and the heatmap)
  cluster_summary <- function(df) {
    stats <- aggregate(value ~ cluster + gene, df, function(v) c(avg = mean(expm1(v)), pct = 100 * mean(v > 0)))
    out <- data.frame(cluster = stats$cluster, gene = stats$gene, avg = stats$value[, "avg"], pct = stats$value[, "pct"])
    # Scaled per gene across clusters, clipped like Seurat (-2.5 .. 2.5); a flat gene has no spread to scale
    out$scaled <- ave(log1p(out$avg), out$gene, FUN = function(v) if (length(v) < 2 || sd(v) == 0) 0 else as.vector(scale(v)))
    out$scaled <- pmax(pmin(out$scaled, 2.5), -2.5)
    out
  }

  # Like Seurat's DotPlot: dot size is the percent of cells expressing, color the scaled average expression
  output$plot_DotPlot <- renderPlot(height = function() as.integer(max(350, 120 + 28 * n_clusters())), {
    sm <- cluster_summary(long_expression(plot_data()))
    ggplot(sm, aes(gene, cluster, size = pct, color = scaled)) +
      geom_point() +
      scale_size(range = c(0, 8), limits = c(0, 100)) +
      scale_color_viridis_c(option = "plasma", direction = -1, begin = 0.1, end = 0.9) +
      labs(x = NULL, y = NULL, size = "% expressed", color = "Avg. expression\n(scaled)") +
      theme_classic(base_size = 14) +
      theme(axis.text.x = element_text(angle = 45, hjust = 1), panel.grid.major = element_line(color = "grey92"))
  })

  # The column whose values name the outlines of the tissue map: tissue_type, else the cell labels (with a note under the plot)
  tissue_col <- reactive(if (TISSUE_COL %in% columns()) TISSUE_COL else label_col())
  tissue_note <- reactive(
    if (TISSUE_COL %in% columns()) NULL else sprintf("No %s column in this dataset; outlines are matched to %s.", TISSUE_COL, label_col())
  )

  # What the tissue plot draws, as a ggPlantmap table: with genes picked, one copy of the map per gene with the average expression of each
  # outline's cell type (ggPlantmap.merge adds the values; avg_expression is log1p of the dot plot's average, pct_expressed its % of
  # cells expressing; NA for outlines whose ROI.name matches no drawn cell type); without, the map with its cell type. Also what the hover reads.
  tissue_data <- reactive({
    shiny::validate(shiny::need(!is.null(TISSUE_PLOT), "This dataset has no tissue map."))
    d <- plot_data()
    # The cells that pass the filters, by their tissue instead of their cell label (the rest of the plot data is shared with the other plots)
    tissue <- as.character(dbGetQuery(con, cells_sql(dbQuoteIdentifier(con, tissue_col())))[[1]])[d$keep_idx]
    d$cells$cluster <- tissue
    d$clusters <- level_order(tissue_col(), tissue)
    map <- TISSUE_PLOT
    cells <- map
    cells$cell_type <- factor(ifelse(map$ROI.name %in% d$clusters, map$ROI.name, NA), levels = d$clusters)
    if (length(d$genes) > 0) {
      sm <- cluster_summary(long_expression(d))
      quant <- do.call(
        rbind,
        lapply(d$genes, function(g) {
          s <- sm[sm$gene == g, ]
          values <- data.frame(ROI.name = as.character(s$cluster), avg_expression = log1p(s$avg), pct_expressed = s$pct)
          cbind(ggPlantmap.merge(map, values, id.x = "ROI.name"), gene = g)
        })
      )
      quant$gene <- factor(quant$gene, levels = d$genes)
      list(table = quant, genes = TRUE, d = d, cells = cells)
    } else {
      list(table = cells, genes = FALSE, d = d, cells = cells)
    }
  })

  # Drawn with ggPlantmap: ggPlantmap.heatmap fills each outline with its average expression, a panel per gene; without genes
  # ggPlantmap.plot fills it with the cell type's color. Outlines that match no drawn cell type stay grey.
  # The map keeps its proportions and sits in the middle of the chart, so any height beyond the panels' shows as white space above and
  # below: the height is that of the panels (the chart width less the legend, shared by the columns, times the map's height/width),
  # their titles and the caption, estimated a little short, which only narrows the panels
  output$plot_TissuePlot <- renderPlot(
    height = function() {
      panels <- max(1, length(selection()$genes))
      cols <- ceiling(sqrt(panels))
      strip <- if (length(selection()$genes) > 0) 25 else 0
      as.integer(max(150, ceiling(panels / cols) * (tissue_panel_width("plot_TissuePlot") * tissue_aspect() + strip) + 20))
    },
    {
      td <- tissue_data()
      d <- td$d
      if (td$genes) {
        ggPlantmap.heatmap(td$table, value.quant = avg_expression) +
          scale_fill_viridis_c(option = "plasma", direction = -1, begin = 0.1, end = 0.9, na.value = "grey85") +
          labs(fill = "Avg. expression", caption = tissue_note()) +
          facet_wrap(~gene, ncol = ceiling(sqrt(length(d$genes)))) +
          theme(text = element_text(size = 14))
      } else {
        tissue_cell_type_plot(td)
      }
    }
  )

  # The map's height / width, and the width of one map panel in a tissue chart (the chart width less the legend, shared by the gene panels'
  # columns). The cell type chart uses the panel width of the gene chart, so its map is the same size as a gene panel's.
  tissue_aspect <- function() {
    if (is.null(TISSUE_PLOT)) 1 else diff(range(TISSUE_PLOT$y)) / max(diff(range(TISSUE_PLOT$x)), 1e-9)
  }
  tissue_panel_width <- function(id) {
    genes <- length(selection()$genes)
    legend <- if (genes > 0) 110 else 170
    max(100, (plot_width(id) - legend) / ceiling(sqrt(max(1, genes))))
  }

  # The tissue map filled with each outline's cell type (outlines that match no drawn cell type stay grey), labeled when Label clusters is on;
  # drawn alone without genes and, with genes, as its own chart above the expression panels
  tissue_cell_type_plot <- function(td) {
    d <- td$d
    p <- ggPlantmap.plot(td$cells, layer = cell_type) +
      scale_fill_manual(
        values = setNames(colorblind_palette(length(d$clusters)), d$clusters),
        na.value = "grey85",
        drop = TRUE,
        name = NULL
      ) +
      labs(caption = tissue_note()) +
      theme(text = element_text(size = 14))
    if (isTRUE(d$label)) {
      # A label at the middle of the corners of each outline that has a cell type
      centers <- aggregate(cbind(x, y) ~ ROI.id + ROI.name, td$cells[td$cells$ROI.name %in% d$clusters, ], function(v) mean(range(v)))
      p <- p + geom_text(aes(x, y, label = ROI.name), centers, inherit.aes = FALSE, size = 4, check_overlap = TRUE)
    }
    p
  }

  # The cell type map shown with the gene panels, so the outlines can be read against their cell types
  output$plot_TissueCells <- renderPlot(
    height = function() {
      as.integer(max(150, tissue_panel_width("plot_TissueCells") * tissue_aspect() + 20))
    },
    tissue_cell_type_plot(tissue_data())
  )

  # The box that follows the mouse over the tissue plot: the outline's name and, with genes, the gene (the panel hovered) with its average
  # expression and % of cells expressing. It sits left of the pointer in the right part of the chart, so it stays inside it.
  tissue_tip_ui <- function(h, tbl, genes, id) {
    if (is.null(h)) {
      return(NULL)
    }
    if (genes) {
      if (is.null(h$panelvar1)) {
        return(NULL)
      }
      tbl <- tbl[as.character(tbl$gene) == as.character(h$panelvar1), , drop = FALSE]
    }
    hit <- outline_at(tbl, h$x, h$y)
    if (is.null(hit)) {
      return(NULL)
    }
    body <- if (genes) {
      if (is.na(hit$avg_expression)) {
        list(tags$b(hit$ROI.name), tags$br(), "no matching cell type")
      } else {
        list(
          tags$b(hit$ROI.name),
          tags$br(),
          paste0(hit$gene, ": ", signif(hit$avg_expression, 3), " avg. expression"),
          tags$br(),
          paste0(round(hit$pct_expressed, 1), "% of cells expressing")
        )
      }
    } else {
      list(tags$b(hit$ROI.name), if (is.na(hit$cell_type)) list(tags$br(), "no matching cell type"))
    }
    x <- h$coords_css$x
    side <- if (x > plot_width(id) * 0.6) {
      sprintf("right: %dpx;", as.integer(plot_width(id) - x + 12))
    } else {
      sprintf("left: %dpx;", as.integer(x + 12))
    }
    tags$div(
      style = paste0(
        "position: absolute; z-index: 100; pointer-events: none; padding: 4px 8px; font-size: 12px; background: rgba(255, 255, 255, 0.95); ",
        "border: 1px solid #ccc; border-radius: 4px; ",
        side,
        sprintf(" top: %dpx;", as.integer(h$coords_css$y + 12))
      ),
      body
    )
  }

  output$tissue_tip <- renderUI({
    h <- input$tissue_hover
    if (is.null(h)) {
      return(NULL)
    }
    td <- tissue_data()
    tissue_tip_ui(h, td$table, td$genes, "plot_TissuePlot")
  })

  # The same box over the cell type chart shown with the gene panels: the outline's name (and that it matches no cell type)
  output$tissue_cells_tip <- renderUI({
    h <- input$tissue_cells_hover
    if (is.null(h)) {
      return(NULL)
    }
    tissue_tip_ui(h, tissue_data()$cells, FALSE, "plot_TissueCells")
  })

  # Like Seurat's DoHeatmap, one heatmap per Group by column (i-th of them): a column per cell, grouped by cell label under a colored identity bar with the group names above it, a row
  # per picked gene, on magenta -> black -> yellow over the drawn range after clipping to -2.5 .. 2.5. The values are the object's scale.data (written by the
  # preprocess), left as they are when cells are filtered out; a gene that is not in scale.data (it usually holds only the variable
  # features), or all genes in a dataset processed before scale.data was written, are z-scored across the drawn cells instead.
  heatmap_plot <- function(i) {
    d <- plot_data()
    shiny::validate(shiny::need(length(d$genes) > 0, "Pick at least one gene, then press Update plots."))
    expr <- d$expr
    cells <- d$cells
    idx <- d$keep_idx
    caption <- NULL
    if (nrow(expr) > MAX_HEATMAP_CELLS) {
      # one pixel per cell is the most the plot can show; keep a fixed random sample
      set.seed(1)
      keep <- sort(sample(nrow(expr), MAX_HEATMAP_CELLS))
      caption <- sprintf("Showing a random %s of %s cells", format(MAX_HEATMAP_CELLS, big.mark = ","), format(nrow(expr), big.mark = ","))
      expr <- expr[keep, , drop = FALSE]
      cells <- cells[keep, , drop = FALSE]
      idx <- idx[keep]
    }
    z <- if (has_scaled) scaled_matrix(d$genes, d$n_total)[idx, , drop = FALSE] else matrix(NA_real_, nrow(expr), ncol(expr))
    missing <- which(colSums(!is.na(z)) == 0)
    for (j in missing) {
      z[, j] <- as.vector(scale(expr[, j]))
    }
    z[is.nan(z)] <- 0 # a gene that does not vary has nothing to scale
    if (length(missing) > 0 && has_scaled) {
      caption <- paste(
        c(caption, paste("Not in scale.data, so scaled across the drawn cells:", paste(d$genes[missing], collapse = ", "))),
        collapse = "\n"
      )
    }
    # Cells are grouped by this heatmap's Group by column (the cell labels unless changed), in the object's level order
    grp <- cells[[paste0("grp", i)]]
    group <- factor(grp, levels = level_order(d$group_cols[[i]], grp))
    ord <- order(group)
    group <- group[ord]
    z <- pmax(pmin(z[ord, , drop = FALSE], 2.5), -2.5)
    n <- nrow(z)
    g <- ncol(z)
    # Like DoHeatmap's draw.lines: a blank stretch (0.25% of the cells) between groups, which also separates the bar blocks
    runs <- rle(as.integer(group))
    gap <- ceiling(0.0025 * n)
    ends <- cumsum(runs$lengths)
    starts <- ends - runs$lengths + 1
    shift <- gap * (seq_along(runs$lengths) - 1)
    x <- seq_len(n) + rep(shift, times = runs$lengths)
    total <- n + gap * (length(runs$lengths) - 1)
    full <- matrix(NA_real_, nrow = total, ncol = g) # the gaps stay NA, drawn in the background color
    full[x, ] <- z
    df <- data.frame(x = rep(seq_len(total), times = g), y = rep(rev(seq_len(g)), each = total), value = as.vector(full))
    # The identity bar: a thin block per group, set apart from the heat (sizes are fractions of the heat's height)
    bar_bottom <- g + 0.5 + 0.06 * g
    bar_top <- bar_bottom + 0.03 * g
    bar_start <- starts + shift - 0.5
    bar_end <- ends + shift + 0.5
    # The labels are angled 45 degrees, so they rise (and the last one runs to the right) by about 0.7 of their width, about 7 px a character
    # at this size (a plot pixel is a point here). Room is made for the longest label above the bar and for the last one at the right.
    labels <- levels(group)[runs$values]
    top_margin <- ceiling(0.71 * 7.2 * max(nchar(labels)) + 30)
    right_margin <- max(40, ceiling(0.71 * 7.2 * nchar(labels[[length(labels)]]) + 10))
    ggplot(df, aes(x, y, fill = value)) +
      geom_raster() +
      annotate(
        "rect",
        xmin = bar_start,
        xmax = bar_end,
        ymin = bar_bottom,
        ymax = bar_top,
        fill = colorblind_palette(nlevels(group))[runs$values]
      ) +
      annotate("text", x = (bar_start + bar_end) / 2, y = bar_top + 0.02 * g, label = labels, angle = 45, hjust = 0, vjust = 0, size = 5) +
      # DoHeatmap spreads its three colors over the range of the values drawn, so the lowest value is always magenta and the highest yellow
      scale_fill_gradientn(colors = c("#FF00FF", "#000000", "#FFFF00"), na.value = "white", name = "Expression") +
      scale_x_continuous(expand = c(0, 0)) +
      scale_y_continuous(breaks = rev(seq_len(g)), labels = d$genes, expand = c(0, 0)) +
      coord_cartesian(clip = "off") +
      labs(x = NULL, y = NULL, caption = caption, title = if (length(d$group_cols) > 1) d$group_cols[[i]]) +
      theme_minimal(base_size = 14) +
      theme(
        panel.grid = element_blank(),
        axis.text.x = element_blank(),
        axis.ticks = element_blank(),
        # With a title, it sits above the room kept for the labels; without one that room is the top margin
        plot.margin = margin(t = if (length(d$group_cols) > 1) 5 else top_margin, r = right_margin, b = 5, l = 5),
        plot.title = element_text(margin = margin(b = top_margin))
      )
  }

  # One output per group by column, plot_Heatmap_1 ... plot_Heatmap_<MAX_GROUP_PLOTS>; the page only holds as many as are picked
  for (i in seq_len(MAX_GROUP_PLOTS)) {
    local({
      i <- i
      output[[paste0("plot_Heatmap_", i)]] <- renderPlot(height = function() as.integer(max(350, 150 + 30 * n_genes())), {
        req(i <= n_heatmaps())
        heatmap_plot(i)
      })
    })
  }
}

shinyApp(ui, server)
