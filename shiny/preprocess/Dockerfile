# Turns a Seurat .rds into the Parquet files the Shiny app reads.
# As a one-off:  docker run --rm -v "$PWD/data:/data" preprocess <input.rds> <output dir>
# As the worker service (docker compose): entrypoint /worker.sh, which runs the jobs the backend drops in the shared folder
FROM rocker/r-ver:4.4.2

RUN apt-get update && apt-get install -y --no-install-recommends \
        libhdf5-dev libglpk-dev libxml2-dev libssl-dev libcurl4-openssl-dev libpng-dev \
    && rm -rf /var/lib/apt/lists/*
RUN install2.r --error --skipinstalled Seurat arrow Matrix && rm -rf /tmp/downloaded_packages

COPY preprocess.R worker.sh /
RUN chmod +x /worker.sh
ENTRYPOINT ["Rscript", "/preprocess.R"]
