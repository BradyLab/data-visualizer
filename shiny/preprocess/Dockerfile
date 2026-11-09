# Turns a Seurat .rds into the Parquet files the Shiny app reads.
# As a one-off:  docker run --rm -v "$PWD/data:/data" preprocess <input.rds> <output dir>
# As the worker service (docker compose): entrypoint /worker.sh, which runs the jobs the backend drops in the shared folder
FROM rocker/r-ver:4.6.2

# The rocker tag fixes the R version but, for R 4.6, not the CRAN snapshot: rocker points at "latest", so every rebuild would take whatever
# packages are newest. This line pins the snapshot (a date on p3m.dev, for this image's Ubuntu release "resolute") so the R packages below
# only change when the date does. To update: pick a newer date, rebuild, and run the tests (shiny/tests). Check the result with:
#   docker run --rm --entrypoint Rscript <image> -e 'getOption("repos")'
ARG CRAN_SNAPSHOT=https://p3m.dev/cran/__linux__/resolute/2026-11-09
ENV CRAN=$CRAN_SNAPSHOT
RUN echo "options(repos = c(CRAN = '$CRAN_SNAPSHOT'))" >> "$(R RHOME)/etc/Rprofile.site"

RUN apt-get update && apt-get install -y --no-install-recommends \
        libhdf5-dev libglpk-dev libxml2-dev libssl-dev libcurl4-openssl-dev libpng-dev \
    && rm -rf /var/lib/apt/lists/*
RUN install2.r --error --skipinstalled Seurat arrow Matrix && rm -rf /tmp/downloaded_packages

COPY preprocess.R worker.sh /
RUN chmod +x /worker.sh
ENTRYPOINT ["Rscript", "/preprocess.R"]
