#!/bin/bash
# Starts the large-memory worker (cluster-worker.sh) as a Slurm job. Submit it from the folder that holds cluster-worker.sh:
#   cd <folder with these scripts> && sbatch cluster-worker.sbatch
# Before the first run, set --account below to the lab's account and put the settings in ~/.dv-worker.env (or point DV_WORKER_ENV at the file):
#   export APP_URL=https://data.example.org
#   export WORKER_TOKEN_FILE=<lab folder>/dv-worker-token        # chmod 600; holds REMOTE_WORKER_TOKEN of the web app
#   export PREPROCESS_IMAGE=<lab folder>/preprocess.sif          # kept up to date by refresh-image.sh at the start of every job (first run: it pulls it)
#   export WORK_DIR=<lab folder>/dv-worker-scratch               # room for the largest .rds plus its Parquet output
#   export APPTAINER_CACHEDIR=<lab folder>/apptainer-cache       # keep Apptainer's cache out of the small home folder
# Needs refresh-image.sh in the same folder as cluster-worker.sh; REFRESH_IMAGE=0 in the settings file turns the refresh off, PREPROCESS_TAG holds it back.
# Memory: the largest dataset's peak (measure it with sacct's MaxRSS, see discussions/vmPreprocessTests.txt) plus some room. The job stops by itself
# after IDLE_EXIT_SECONDS (default 1 hour) without work; a job that ends at the time limit leaves the dataset waiting for the next run.
#SBATCH --job-name=dv-worker
#SBATCH --account=CHANGE-ME
#SBATCH --partition=high
#SBATCH --cpus-per-task=8
#SBATCH --mem=160G
#SBATCH --time=2-00:00:00
#SBATCH --output=%x-%j.out

set -eu
# shellcheck source=/dev/null
. "${DV_WORKER_ENV:-$HOME/.dv-worker.env}"
# Bring the image up to date first (a failed refresh only warns and keeps the current file; it stops the job only if there is no image at all)
"${SLURM_SUBMIT_DIR}/refresh-image.sh"
exec "${SLURM_SUBMIT_DIR}/cluster-worker.sh"
