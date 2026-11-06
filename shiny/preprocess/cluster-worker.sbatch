#!/bin/bash
# Starts the large-memory worker (cluster-worker.sh) as a Slurm job. Submit it from the folder that holds cluster-worker.sh:
#   cd <folder with these scripts> && sbatch cluster-worker.sbatch
# Before the first run, set --account below to the lab's account and put the settings in ~/.dv-worker.env (or point DV_WORKER_ENV at the file):
#   export APP_URL=https://data.example.org
#   export WORKER_TOKEN_FILE=<lab folder>/dv-worker-token        # chmod 600; holds REMOTE_WORKER_TOKEN of the web app
#   export PREPROCESS_IMAGE=<lab folder>/preprocess.sif          # apptainer pull <path>.sif docker://ghcr.io/<owner>/data-visualizer-preprocess:latest
#   export WORK_DIR=<lab folder>/dv-worker-scratch               # room for the largest .rds plus its Parquet output
#   export APPTAINER_CACHEDIR=<lab folder>/apptainer-cache       # keep Apptainer's cache out of the small home folder
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
exec "${SLURM_SUBMIT_DIR}/cluster-worker.sh"
