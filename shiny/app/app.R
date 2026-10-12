# Interactive plots for one dataset, read from the Parquet files in <PARQUET_DIR>/<dataset id>/ (see ../README.md).
#
# Who may see what is decided by Express, which proxies requests here only for permitted users. Shiny Server does not pass request
# headers to the app, so Express puts a signed context in the iframe URL (?ctx=<base64url JSON>.<hex HMAC-SHA256>, made with the
# SHINY_SECRET shared with Express): the dataset id, the viewer's access level and the plots the dataset offers. The signature means
# the browser can read it but not change it, so a viewer cannot switch to another dataset by editing the URL.
# For local development without the proxy, set SHINY_DEV=1 to also accept ?dataset=<uuid> in the URL.
library(shiny)
library(DBI)
library(duckdb)
library(jsonlite)
library(openssl)
library(ggplot2)
library(scales)
library(scattermore)

PARQUET_DIR <- Sys.getenv("PARQUET_DIR", "/data/parquet")
SECRET <- Sys.getenv("SHINY_SECRET")
DEV <- identical(Sys.getenv("SHINY_DEV"), "1")
UUID_RE <- "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

# Dataset folder for an id, or NULL unless the id is a UUID (it becomes part of a path, so nothing else may through)
dataset_dir <- function(dataset_id) {
  if (is.null(dataset_id) || length(dataset_id) != 1 || !grepl(UUID_RE, dataset_id)) return(NULL)
  file.path(PARQUET_DIR, tolower(dataset_id))
}

# The payload (a list) of a context made by Express, or NULL if it is missing, forged, malformed or expired
verify_context <- function(token) {
  if (is.null(token) || length(token) != 1 || !nzchar(SECRET)) return(NULL)
  parts <- strsplit(token, ".", fixed = TRUE)[[1]]
  if (length(parts) != 2) return(NULL)
  # as.character keeps the "hash" class, which would make identical() fail even for equal text, so drop it
  expected <- unclass(as.character(sha256(charToRaw(parts[[1]]), key = charToRaw(SECRET))))
  if (!identical(expected, parts[[2]])) return(NULL)
  b64 <- chartr("-_", "+/", parts[[1]])
  b64 <- paste0(b64, strrep("=", (4 - nchar(b64) %% 4) %% 4))
  payload <- tryCatch(fromJSON(rawToChar(base64_decode(b64)), simplifyVector = FALSE), error = function(e) NULL)
  if (is.null(payload) || !is.numeric(payload$exp) || payload$exp < as.numeric(Sys.time())) return(NULL)
  payload
}

# Who is looking at what: list(dataset_id, access, plots) from the signed ctx in the URL, or NULL if there is none that is valid.
# With SHINY_DEV=1 a bare ?dataset=<uuid> is accepted too (no access level, every plot)
viewer_context <- function(query) {
  payload <- verify_context(query$ctx)
  if (!is.null(payload)) {
    return(list(dataset_id = payload$dataset_id, access = payload$access, plots = as.character(unlist(payload$plots))))
  }
  if (DEV && !is.null(query$dataset)) return(list(dataset_id = query$dataset, access = "DEV", plots = character()))
  NULL
}

# Columns of cells.parquet that are not metadata to color by
COORD_RE <- "^(umap|pca)_[0-9]+$"

ui <- fluidPage(
  fluidRow(
    column(4, uiOutput("controls")),
    column(2, style = "margin-top: 25px;", actionButton("generate", "Generate plots", class = "btn-primary"))
  ),
  fluidRow(
    column(12, uiOutput("status"), plotOutput("umap", height = "calc(100vh - 170px)"))
  )
)

server <- function(input, output, session) {
  # The URL query string is a reactive value; it is read once, when the session starts, so isolate() makes that legal here
  query <- isolate(parseQueryString(session$clientData$url_search))
  context <- viewer_context(query)
  dataset_id <- context$dataset_id
  access <- context$access
  dir <- dataset_dir(dataset_id)
  cells_file <- if (is.null(dir)) NULL else file.path(dir, "cells.parquet")
  ready <- !is.null(cells_file) && file.exists(cells_file)

  # Plots the dataset offers (signed); a ?plots= in the iframe URL can only narrow that list
  offered <- context$plots
  plots <- if (is.null(query$plots)) offered else intersect(offered, strsplit(query$plots, ",")[[1]])

  # One in-memory DuckDB per session (cheap), closed with it; the Parquet files are only read
  con <- dbConnect(duckdb())
  session$onSessionEnded(function() dbDisconnect(con, shutdown = TRUE))
  cells_sql <- function(select = "*") {
    sprintf("SELECT %s FROM read_parquet(%s)", select, dbQuoteString(con, cells_file))
  }

  columns <- reactive({
    req(ready)
    dbGetQuery(con, paste("DESCRIBE", cells_sql()))$column_name
  })

  output$controls <- renderUI({
    if (!ready) return(NULL)
    meta <- setdiff(columns(), c("barcode", grep(COORD_RE, columns(), value = TRUE)))
    tagList(
      selectInput("color_by", "Color by", choices = meta),
      checkboxInput("label", "Label clusters", value = TRUE)
    )
  })

  # Everything below waits for the button, so opening the page costs nothing
  generated <- eventReactive(input$generate, TRUE)

  output$status <- renderUI({
    if (is.null(context)) {
      tags$div(class = "alert alert-danger", "This viewer link is missing, invalid or has expired. Reload the dataset page.")
    } else if (!ready) {
      tags$div(class = "alert alert-warning", "Parquet data not found (dataset not processed yet).")
    }
  })

  # Styled like Seurat's DimPlot / FeaturePlot: no grid, axis lines only, discrete groups in ggplot2's hue palette, numeric values
  # on a lightgrey -> blue gradient with the highest values drawn last. Above 100k cells Seurat rasterizes the points; so do we.
  output$umap <- renderPlot({
    generated()
    req(ready, input$color_by, all(c("umap_1", "umap_2") %in% columns()))
    isolate({
      color <- dbQuoteIdentifier(con, input$color_by)
      df <- dbGetQuery(con, cells_sql(paste("umap_1, umap_2,", color, "AS color")))
      numeric <- is.numeric(df$color)
      if (numeric) df <- df[order(df$color, na.last = FALSE), ] else df$color <- as.factor(df$color)
      raster <- nrow(df) > 1e5
      p <- ggplot(df, aes(umap_1, umap_2, color = color))
      p <- if (raster) p + geom_scattermore(pointsize = 2) else p + geom_point(size = 1)
      p <- p + labs(x = "umap_1", y = "umap_2", color = NULL) + theme_classic(base_size = 14)
      if (numeric) {
        p + scale_color_gradient(low = "lightgrey", high = "blue") + labs(color = input$color_by)
      } else {
        # Seurat's LabelClusters: the label sits at the median of each group's coordinates
        if (isTRUE(input$label)) {
          centers <- aggregate(cbind(umap_1, umap_2) ~ color, df, median)
          p <- p + geom_text(data = centers, aes(label = color), color = "black", size = 5, show.legend = FALSE)
        }
        p + scale_color_manual(values = hue_pal()(nlevels(df$color)), drop = FALSE) +
          guides(color = guide_legend(override.aes = list(size = 3)))
      }
    })
  })
}

shinyApp(ui, server)
