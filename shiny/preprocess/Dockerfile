# Turns a Seurat .rds into the Parquet files the Shiny app reads.
# As a one-off:  docker run --rm -v "$PWD/data:/data" preprocess <input.rds> <output dir>
# As the worker service (docker compose): entrypoint /worker.sh, which runs the jobs the backend drops in the shared folder
# The rocker image tag fixes the R version and also the CRAN snapshot that install2.r reads (p3m.dev, dated at that R release), so the R
# packages below only change when the tag does. Check with: docker run --rm --entrypoint Rscript <image> -e 'getOption("repos")'
FROM rocker/r-ver:4.6.1

RUN apt-get update && apt-get install -y --no-install-recommends \
        libhdf5-dev libglpk-dev libxml2-dev libssl-dev libcurl4-openssl-dev libpng-dev \
    && rm -rf /var/lib/apt/lists/*
RUN install2.r --error --skipinstalled Seurat arrow Matrix && rm -rf /tmp/downloaded_packages

COPY preprocess.R worker.sh /
RUN chmod +x /worker.sh
ENTRYPOINT ["Rscript", "/preprocess.R"]
