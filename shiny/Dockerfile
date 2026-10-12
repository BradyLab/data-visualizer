# Shiny Server running the plot app; only reachable through the Express proxy (no published port).
# The image has no Seurat: plots read the per-dataset Parquet files made by preprocess/ with DuckDB
FROM rocker/shiny:4.4.2

RUN install2.r --error --skipinstalled DBI duckdb jsonlite openssl ggplot2 scales scattermore && rm -rf /tmp/downloaded_packages

COPY app/ /srv/shiny-server/app/
EXPOSE 3838
