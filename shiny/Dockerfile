# Shiny Server running the plot app; only reachable through the Express proxy (no published port).
# The image has no Seurat: plots read the per-dataset Parquet files made by preprocess/ with DuckDB
FROM rocker/shiny:4.4.2

# ggPlantmap draws the tissue plot; it is not on CRAN, so it comes from GitHub, pinned to a commit. It needs the XML package, hence libxml2
RUN apt-get update && apt-get install -y --no-install-recommends libxml2-dev && rm -rf /var/lib/apt/lists/*
RUN install2.r --error --skipinstalled DBI duckdb jsonlite openssl ggplot2 scales scattermore dplyr stringr XML remotes && \
    Rscript -e 'remotes::install_github("leonardojo/ggPlantmap@e0508172709dc192dfc3e99da631984dbd9a97d2", upgrade = "never")' && rm -rf /tmp/downloaded_packages

COPY app/ /srv/shiny-server/app/
EXPOSE 3838
