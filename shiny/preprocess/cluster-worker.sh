#!/usr/bin/env bash
# Large-memory worker: processes the datasets that are too big for the web server, on a machine with enough memory (the school's cluster).
# It asks the web app for work over HTTPS (nothing connects to this machine), downloads the dataset's .rds, runs preprocess.R from the
# preprocess image with Apptainer, uploads the Parquet files back, and repeats until there has been nothing to do for a while.
# Needs: bash, curl, timeout (coreutils) and Apptainer. Run it inside a Slurm job (cluster-worker.sbatch), not on a login node.
#
# Settings (environment variables):
#   APP_URL            address of the web app, e.g. https://data.example.org (required)
#   WORKER_TOKEN       the secret REMOTE_WORKER_TOKEN of the web app, or WORKER_TOKEN_FILE: a file holding it (chmod 600; preferred)
#   PREPROCESS_IMAGE   the preprocess image: a .sif file, or docker://ghcr.io/<owner>/data-visualizer-preprocess:latest (required)
#   WORK_DIR           scratch folder with room for the .rds and the Parquet output (default: $TMPDIR or /tmp, in dv-worker-$USER)
#   IDLE_EXIT_SECONDS  stop after this long without a job (default 3600; 0 = stop at the first empty answer)
#   POLL_SECONDS       how often to ask for work while idle (default 60);  HEARTBEAT_SECONDS: how often to tell the app the job is alive (default 60)
#   APPTAINER          the Apptainer program (default apptainer; Singularity: singularity)
#
# If this script is stopped in the middle of a job (the Slurm time limit, scancel), the job is not reported: the web app gives it to the next
# worker once the heartbeats stop (15 minutes), and the dataset keeps waiting. A job the app has dropped (the dataset was deleted or uploaded
# again) is abandoned as soon as the next heartbeat notices.
set -uo pipefail

APP_URL="${APP_URL:-}"
APP_URL="${APP_URL%/}"
IMAGE="${PREPROCESS_IMAGE:-}"
APPTAINER="${APPTAINER:-apptainer}"
WORK_ROOT="${WORK_DIR:-${TMPDIR:-/tmp}/dv-worker-${USER:-worker}}"
IDLE_EXIT="${IDLE_EXIT_SECONDS:-3600}"
POLL="${POLL_SECONDS:-60}"
HEARTBEAT="${HEARTBEAT_SECONDS:-60}"

log() { echo "[worker $(date -u +%FT%TZ)] $*"; }
die() {
    log "$*"
    exit 2
}

[ -n "$APP_URL" ] || die "APP_URL is not set"
[ -n "$IMAGE" ] || die "PREPROCESS_IMAGE is not set"
if [ -n "${WORKER_TOKEN_FILE:-}" ]; then
    [ -r "$WORKER_TOKEN_FILE" ] || die "Cannot read WORKER_TOKEN_FILE"
    WORKER_TOKEN="$(tr -d '[:space:]' < "$WORKER_TOKEN_FILE")"
fi
[ -n "${WORKER_TOKEN:-}" ] || die "Neither WORKER_TOKEN nor WORKER_TOKEN_FILE is set"
mkdir -p "$WORK_ROOT" || die "Cannot create $WORK_ROOT"

# The token goes to curl through a config file, not the command line, which other users of this machine can read with ps
CURL_CONFIG="$(mktemp "$WORK_ROOT/curl-config.XXXXXX")"
chmod 600 "$CURL_CONFIG"
printf 'header = "Authorization: Bearer %s"\n' "$WORKER_TOKEN" > "$CURL_CONFIG"
unset WORKER_TOKEN

JOB_DIR=""
CHILDREN=()

cleanup() {
    local pid
    for pid in "${CHILDREN[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2> /dev/null; done
    [ -n "$JOB_DIR" ] && rm -rf "$JOB_DIR"
    rm -f "$CURL_CONFIG" "${BODY:-}"
}
trap 'cleanup' EXIT
trap 'log "Stopped"; exit 143' INT TERM

# api <method> <path> [curl options]: prints the HTTP status. The body goes to $BODY. Transient failures are retried by curl
BODY="$WORK_ROOT/body.$$"
api() {
    local method="$1" path="$2"
    shift 2
    curl -sS --config "$CURL_CONFIG" --retry 5 --retry-delay 10 --retry-connrefused -X "$method" -o "$BODY" -w '%{http_code}' \
        "$@" "$APP_URL/api/worker$path" 2> /dev/null || echo 000
}

# JSON-safe text: one line of printable characters, at most 400 long (it is shown on the dataset page, with paths cut down by the app)
json_text() { tr '\n\r\t' '   ' | tr -cd '[:print:]' | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-400; }

report_failure() { # <job id> <message>
    local message
    message="$(printf '%s' "$2" | json_text)"
    api POST "/jobs/$1/fail" -H 'Content-Type: application/json' --data "{\"message\":\"$message\"}" > /dev/null
}

# run_job: handles the job described in $BODY (key=value lines). Returns 0 when the job was dealt with, whatever the outcome
run_job() {
    local id="" dataset="" size="" timeout_s="" key value
    while IFS='=' read -r key value; do
        case "$key" in
            id) id="$value" ;;
            dataset_id) dataset="$value" ;;
            size_bytes) size="$value" ;;
            timeout_seconds) timeout_s="$value" ;;
        esac
    done < "$BODY"
    # These become part of paths and commands, so nothing but what the app sends is accepted
    [[ "$id" =~ ^[0-9a-f-]{36}$ && "$dataset" =~ ^[0-9a-f-]{36}$ && "$size" =~ ^[0-9]+$ && "$timeout_s" =~ ^[0-9]+$ ]] || {
        log "Unexpected answer from the app, skipping"
        return 0
    }
    log "Job $id: dataset $dataset, $((size / 1048576)) MB"
    JOB_DIR="$WORK_ROOT/$id"
    rm -rf "$JOB_DIR"
    mkdir -p "$JOB_DIR/out" || return 0

    local free_kb
    free_kb="$(df -Pk "$JOB_DIR" | awk 'NR==2 {print $4}')"
    if [ "${free_kb:-0}" -lt $((size * 12 / 10 / 1024)) ]; then
        log "Not enough free space in $WORK_ROOT"
        report_failure "$id" "The large-memory worker has too little disk space for this file"
        return 0
    fi

    # Download, resuming after a dropped connection (-C -). 410 means the job is gone
    local status
    status="$(curl -sS --config "$CURL_CONFIG" -L --retry 10 --retry-delay 15 --retry-all-errors -C - -o "$JOB_DIR/input.rds" \
        -w '%{http_code}' "$APP_URL/api/worker/jobs/$id/rds" 2> /dev/null || echo 000)"
    if [ "$status" = 410 ]; then
        log "The job was dropped by the app"
        return 0
    fi
    if [ "$(stat -c %s "$JOB_DIR/input.rds" 2> /dev/null || echo 0)" != "$size" ]; then
        log "The download did not complete (HTTP $status)"
        report_failure "$id" "The large-memory worker could not download the data file"
        return 0
    fi

    # Process in the background so the heartbeat can run alongside, and stop it if the app drops the job
    local gone="$JOB_DIR/gone"
    timeout --signal=TERM --kill-after=30 "$timeout_s" "$APPTAINER" exec --cleanenv --bind "$JOB_DIR:/job" "$IMAGE" \
        Rscript /preprocess.R /job/input.rds /job/out/dataset > "$JOB_DIR/job.log" 2>&1 &
    local worker_pid=$!
    (
        while sleep "$HEARTBEAT"; do
            # Its own answer file, not the one the main loop reads
            code="$(BODY="$JOB_DIR/heartbeat.body" api POST "/jobs/$id/heartbeat")"
            if [ "$code" = 410 ]; then
                touch "$gone"
                kill "$worker_pid" 2> /dev/null
                exit 0
            fi
        done
    ) &
    local beat_pid=$!
    CHILDREN=("$worker_pid" "$beat_pid")
    wait "$worker_pid"
    local code=$?
    kill "$beat_pid" 2> /dev/null
    wait "$beat_pid" 2> /dev/null
    CHILDREN=()
    if [ -e "$gone" ]; then
        log "The job was dropped by the app, discarding the result"
        return 0
    fi

    if [ "$code" -ne 0 ]; then
        log "Processing failed (exit code $code)"
        case "$code" in
            124) report_failure "$id" "Processing took longer than $((timeout_s / 60)) minutes and was stopped" ;;
            137) report_failure "$id" "Processing ran out of memory on the large-memory worker (the process was killed)" ;;
            *) report_failure "$id" "$(tail -n 3 "$JOB_DIR/job.log")" ;;
        esac
        return 0
    fi

    # Upload every file preprocess.R wrote. A file can be sent again safely, so curl simply retries
    local name
    for name in cells genes expression column_levels scale_data; do
        [ -f "$JOB_DIR/out/dataset/$name.parquet" ] || continue
        status="$(curl -sS --config "$CURL_CONFIG" --retry 5 --retry-delay 15 --retry-all-errors -X PUT -H 'Expect:' \
            -H 'Content-Type: application/octet-stream' -T "$JOB_DIR/out/dataset/$name.parquet" -o /dev/null \
            -w '%{http_code}' "$APP_URL/api/worker/jobs/$id/files/$name.parquet" 2> /dev/null || echo 000)"
        if [ "$status" = 410 ]; then
            log "The job was dropped by the app while uploading"
            return 0
        fi
        if [ "$status" != 204 ]; then
            log "Uploading $name.parquet failed (HTTP $status)"
            report_failure "$id" "The large-memory worker could not upload the result ($name.parquet)"
            return 0
        fi
    done
    status="$(api POST "/jobs/$id/complete")"
    case "$status" in
        204) log "Dataset $dataset is ready" ;;
        410) log "The job was dropped by the app" ;;
        *) log "The app did not accept the result (HTTP $status): $(head -c 300 "$BODY")" ;;
    esac
    return 0
}

log "Started, asking $APP_URL for work"
idle_since="$(date +%s)"
while true; do
    status="$(api POST /claim)"
    case "$status" in
        200)
            run_job
            rm -rf "$JOB_DIR"
            JOB_DIR=""
            idle_since="$(date +%s)"
            continue
            ;;
        204) ;;
        401) die "The app refused the worker token (HTTP 401)" ;;
        503) die "The app has no large-memory processing configured (HTTP 503)" ;;
        *) log "Unexpected answer to the request for work (HTTP $status), will try again" ;;
    esac
    if [ $(($(date +%s) - idle_since)) -ge "$IDLE_EXIT" ]; then
        log "Nothing to do for ${IDLE_EXIT}s, stopping"
        exit 0
    fi
    sleep "$POLL"
done
