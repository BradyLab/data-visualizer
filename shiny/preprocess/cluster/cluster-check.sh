#!/usr/bin/env bash
# Scheduled check (for scrontab, see scrontab.example): asks the web app how many datasets are waiting for the large-memory worker and, only
# if there are some and no worker is already queued or running, submits the real worker (cluster-worker.sbatch) with sbatch. It does no
# processing itself and needs next to nothing: bash, curl and Slurm, so run it as a tiny job (1 CPU, a few hundred MB, a couple of minutes).
# The app's answer to GET /api/worker/waiting is one line, waiting=<n>; nothing is claimed or changed by asking.
#
# Settings: the same ~/.dv-worker.env as cluster-worker.sbatch (or DV_WORKER_ENV): APP_URL and WORKER_TOKEN or WORKER_TOKEN_FILE. Also
#   DV_WORKER_DIR        folder holding cluster-worker.sbatch (default: the folder of this script); the worker is submitted from there
#   MAX_WORKERS          how many worker jobs may be queued or running at once (default 1)
#   WORKER_JOB_NAME      the --job-name of cluster-worker.sbatch, to recognise them (default dv-worker)
#   WORKER_IDLE_SECONDS  how long a worker started here waits for more work before it ends and gives the allocation back (default 300; the
#                        hand-started worker waits an hour)
#   DRY_RUN=1            only say what would be submitted
# Exit codes: 0 fine (also when nothing is waiting), 1 the app answered something unexpected or sbatch failed, 2 settings are missing.
set -uo pipefail

DIR="${DV_WORKER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
NAME="${WORKER_JOB_NAME:-dv-worker}"
MAX_WORKERS="${MAX_WORKERS:-1}"
IDLE="${WORKER_IDLE_SECONDS:-300}"

log() { echo "[check $(date -u +%FT%TZ)] $*"; }
die() {
    log "$*"
    exit 2
}

# shellcheck source=/dev/null
. "${DV_WORKER_ENV:-$HOME/.dv-worker.env}" || die "Cannot read the settings file"
APP_URL="${APP_URL:-}"
APP_URL="${APP_URL%/}"
[ -n "$APP_URL" ] || die "APP_URL is not set"
if [ -n "${WORKER_TOKEN_FILE:-}" ]; then
    [ -r "$WORKER_TOKEN_FILE" ] || die "Cannot read WORKER_TOKEN_FILE"
    WORKER_TOKEN="$(tr -d '[:space:]' < "$WORKER_TOKEN_FILE")"
fi
[ -n "${WORKER_TOKEN:-}" ] || die "Neither WORKER_TOKEN nor WORKER_TOKEN_FILE is set"
[[ "$MAX_WORKERS" =~ ^[0-9]+$ && "$IDLE" =~ ^[0-9]+$ ]] || die "MAX_WORKERS and WORKER_IDLE_SECONDS must be numbers"

# The token goes to curl through a config file on stdin, not the command line, which other users of this machine can read with ps
body="$(printf 'header = "Authorization: Bearer %s"\n' "$WORKER_TOKEN" |
    curl -sS --config - --max-time 30 --retry 3 --retry-delay 5 --retry-connrefused -w '\n%{http_code}' "$APP_URL/api/worker/waiting" 2> /dev/null)"
unset WORKER_TOKEN
status="${body##*$'\n'}"
body="${body%$'\n'*}"
case "$status" in
    200) ;;
    401) log "The app refused the worker token (HTTP 401)"; exit 1 ;;
    503) log "The app has no large-memory processing configured (HTTP 503)"; exit 1 ;;
    *) log "Unexpected answer from the app (HTTP $status), will try again at the next run"; exit 1 ;;
esac
waiting="$(printf '%s' "$body" | sed -n 's/^waiting=\([0-9][0-9]*\)$/\1/p' | head -n 1)"
[ -n "$waiting" ] || {
    log "Unexpected answer from the app: $(printf '%s' "$body" | head -c 100 | tr -cd '[:print:]')"
    exit 1
}

if [ "$waiting" -eq 0 ]; then
    log "Nothing is waiting"
    exit 0
fi

# Queued or running workers (of any start: this script's or a lab member's sbatch) already cover the waiting datasets
active="$(squeue -h -u "$USER" -n "$NAME" -t PENDING,RUNNING -o %i 2> /dev/null | wc -l)"
if [ "$active" -ge "$MAX_WORKERS" ]; then
    log "$waiting waiting, but $active $NAME job(s) already queued or running"
    exit 0
fi

if [ "${DRY_RUN:-0}" = 1 ]; then
    log "$waiting waiting; would submit $DIR/cluster-worker.sbatch (idle exit ${IDLE}s)"
    exit 0
fi
# Submitted from its own folder: cluster-worker.sbatch finds its sister scripts through the folder it was submitted from
if out="$(cd "$DIR" && sbatch --parsable --job-name="$NAME" --export="ALL,IDLE_EXIT_SECONDS=$IDLE" cluster-worker.sbatch 2>&1)"; then
    log "$waiting waiting; submitted worker job $out"
else
    log "sbatch failed: $out"
    exit 1
fi
