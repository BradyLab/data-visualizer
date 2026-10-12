#!/bin/sh
# Preprocessing worker: waits for jobs from the backend and runs preprocess.R for each, one at a time.
# The backend and this worker share a folder (SPOOL_DIR, data/jobs) and talk through files:
#
#   pending/<id>.job   written by the backend: line 1 = input .rds, line 2 = output folder
#   running/<id>.job   the job while it is being worked on (moved here from pending/ in one atomic step)
#   cancel/<id>        written by the backend to stop a running job
#   done/<id>.log      written here: the end of the job's output
#   done/<id>.status   written here, last: "ok" or "fail"
#
# Paths are checked before use: input must be an .rds under UPLOAD_DIR/rds, output a folder directly under PARQUET_DIR.
SPOOL="${SPOOL_DIR:-/data/jobs}"
SCRIPT="${PREPROCESS_SCRIPT:-/preprocess.R}"
RSCRIPT="${RSCRIPT:-Rscript}" # (overridden in tests)
UPLOADS="${UPLOAD_DIR:-/data/uploads}"
PARQUET="${PARQUET_DIR:-/data/parquet}"

mkdir -p "$SPOOL/pending" "$SPOOL/running" "$SPOOL/cancel" "$SPOOL/done"

# A job the previous worker was running when it stopped starts over
for f in "$SPOOL"/running/*.job; do
    [ -e "$f" ] && mv "$f" "$SPOOL/pending/"
done
rm -f "$SPOOL"/running/*.log

# finish <id> <ok|fail>: publishes the verdict (status last, so the backend never reads a log that is still being written)
finish() {
    tail -c 4000 "$SPOOL/running/$1.log" > "$SPOOL/done/$1.log.tmp" 2> /dev/null || : > "$SPOOL/done/$1.log.tmp"
    mv "$SPOOL/done/$1.log.tmp" "$SPOOL/done/$1.log"
    echo "$2" > "$SPOOL/done/$1.status.tmp"
    mv "$SPOOL/done/$1.status.tmp" "$SPOOL/done/$1.status"
    rm -f "$SPOOL/running/$1.job" "$SPOOL/running/$1.log" "$SPOOL/cancel/$1"
}

fail() { # fail <id> <message>
    echo "$2" > "$SPOOL/running/$1.log"
    finish "$1" fail
}

echo "[worker] waiting for jobs in $SPOOL"
while true; do
    job=$(ls -1tr "$SPOOL/pending" 2> /dev/null | grep '\.job$' | head -n 1)
    if [ -z "$job" ]; then
        sleep 1
        continue
    fi
    id="${job%.job}"
    mv "$SPOOL/pending/$job" "$SPOOL/running/$job" 2> /dev/null || continue
    input=$(sed -n 1p "$SPOOL/running/$job")
    output=$(sed -n 2p "$SPOOL/running/$job")
    echo "[worker] $id: $input -> $output"

    case "$input" in *..*) fail "$id" "Rejected input path"; continue ;; esac
    case "$output" in *..*) fail "$id" "Rejected output path"; continue ;; esac
    case "$input" in "$UPLOADS"/rds/*.rds) ;; *) fail "$id" "Rejected input path"; continue ;; esac
    case "$output" in "$PARQUET"/*) ;; *) fail "$id" "Rejected output path"; continue ;; esac
    case "${output#"$PARQUET"/}" in */*) fail "$id" "Rejected output path"; continue ;; esac
    if [ -e "$SPOOL/cancel/$id" ]; then
        fail "$id" "Processing was stopped"
        continue
    fi

    "$RSCRIPT" "$SCRIPT" "$input" "$output" > "$SPOOL/running/$id.log" 2>&1 &
    pid=$!
    while kill -0 "$pid" 2> /dev/null; do
        if [ -e "$SPOOL/cancel/$id" ]; then
            kill "$pid" 2> /dev/null
            break
        fi
        sleep 1
    done
    wait "$pid"
    code=$?
    if [ -e "$SPOOL/cancel/$id" ]; then
        echo "Processing was stopped" >> "$SPOOL/running/$id.log"
        finish "$id" fail
    elif [ "$code" -eq 0 ]; then
        finish "$id" ok
    else
        finish "$id" fail
    fi
    echo "[worker] $id finished (exit code $code)"
done
