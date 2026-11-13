#!/usr/bin/env bash
# Memory and time test: turns an .rds file that is already on the cluster into the Parquet files, with the same image and the same
# preprocess.R the large-memory worker uses, but without the web app: nothing is downloaded or uploaded. Use it to measure the peak memory.
#
#   sbatch --account=<account> --mem=200G --cpus-per-task=8 --time=12:00:00 cluster-test.sh /path/to/data.rds [output folder]
#
# The --mem you request is a ceiling: Slurm kills the job above it, so try a generous value first and read the real peak from the report.
# Settings (environment variables, the same names as cluster-worker.sh):
#   PREPROCESS_IMAGE   the preprocess image: a .sif file, or docker://ghcr.io/<owner>/data-visualizer-preprocess:latest (required)
#   APPTAINER_CACHEDIR keep Apptainer's cache out of a small home folder
#   APPTAINER          the Apptainer program (default apptainer)
# The output folder (default: <data>.parquet-test next to the .rds, or $PWD) gets cells.parquet, genes.parquet, expression.parquet, ... and
# is left in place so that you can look at the sizes; delete it yourself. The .rds is mounted read-only and is never changed.
# Also runs without Slurm (on a compute node, in a shell from srun --pty), where only the peak that this script can measure is reported.
#SBATCH --job-name=dv-test
#SBATCH --account=CHANGE-ME
#SBATCH --partition=high
#SBATCH --cpus-per-task=8
#SBATCH --mem=160G
#SBATCH --time=1-00:00:00
#SBATCH --output=%x-%j.out

set -uo pipefail

APPTAINER="${APPTAINER:-apptainer}"
IMAGE="${PREPROCESS_IMAGE:-}"
RDS="${1:-}"
OUT_PARENT="${2:-}"

log() { echo "[test $(date -u +%FT%TZ)] $*"; }
die() {
    log "$*"
    exit 2
}

[ -n "$IMAGE" ] || die "PREPROCESS_IMAGE is not set"
[ -n "$RDS" ] || die "Usage: cluster-test.sh /path/to/data.rds [output folder]"
[ -r "$RDS" ] || die "Cannot read $RDS"
RDS="$(readlink -f "$RDS")"
RDS_DIR="$(dirname "$RDS")"
RDS_NAME="$(basename "$RDS")"
OUT_PARENT="${OUT_PARENT:-$RDS_DIR/${RDS_NAME%.*}.parquet-test}"
mkdir -p "$OUT_PARENT" || die "Cannot create $OUT_PARENT"
OUT_PARENT="$(readlink -f "$OUT_PARENT")"
rm -rf "$OUT_PARENT/dataset"

size="$(stat -c %s "$RDS")"
log "Input $RDS ($((size / 1048576)) MB), output $OUT_PARENT/dataset"
log "Host $(hostname), $(nproc) CPUs visible, $(free -g | awk '/^Mem:/ {print $2}') GB RAM on the node; Slurm job ${SLURM_JOB_ID:-none}, memory request ${SLURM_MEM_PER_NODE:-${SLURM_MEM_PER_CPU:-unknown}} MB"

# The job's own cgroup remembers its peak memory, which also counts R's children and the file cache; memory.peak exists on cgroup v2 only
cgroup_file() {
    local rel
    rel="$(awk -F: '$1 == "0" {print $3}' /proc/self/cgroup 2> /dev/null)"
    [ -n "$rel" ] && [ -r "/sys/fs/cgroup$rel/$1" ] && echo "/sys/fs/cgroup$rel/$1"
}
PEAK_FILE="$(cgroup_file memory.peak || true)"

# GNU time reports the largest resident set of the process tree it waited for
TIME_BIN=""
[ -x /usr/bin/time ] && TIME_BIN=/usr/bin/time
TIME_LOG="$(mktemp "${TMPDIR:-/tmp}/dv-test-time.XXXXXX")"
trap 'rm -f "$TIME_LOG"' EXIT

start="$(date +%s)"
if [ -n "$TIME_BIN" ]; then
    "$TIME_BIN" -v -o "$TIME_LOG" "$APPTAINER" exec --cleanenv --bind "$RDS_DIR:/input:ro" --bind "$OUT_PARENT:/out" "$IMAGE" \
        Rscript /preprocess.R "/input/$RDS_NAME" /out/dataset
else
    "$APPTAINER" exec --cleanenv --bind "$RDS_DIR:/input:ro" --bind "$OUT_PARENT:/out" "$IMAGE" \
        Rscript /preprocess.R "/input/$RDS_NAME" /out/dataset
fi
code=$?
elapsed=$(($(date +%s) - start))

echo
log "===== Report ====="
case "$code" in
    0) log "Result: finished" ;;
    137) log "Result: killed (exit 137): out of memory, or the Slurm --mem limit. Run again with a larger --mem" ;;
    *) log "Result: failed (exit code $code), see the R output above" ;;
esac
log "Time: $((elapsed / 3600))h $((elapsed % 3600 / 60))m $((elapsed % 60))s"
if [ -n "$TIME_BIN" ] && grep -q "Maximum resident" "$TIME_LOG" 2> /dev/null; then
    kb="$(awk -F': ' '/Maximum resident set size/ {print $2}' "$TIME_LOG")"
    log "Peak memory (largest process): $((kb / 1048576)) GB ($((kb / 1024)) MB), $(awk -v k="$kb" -v s="$size" 'BEGIN {printf "%.1f", k * 1024 / s}')x the .rds size"
fi
if [ -n "$PEAK_FILE" ]; then
    bytes="$(cat "$PEAK_FILE" 2> /dev/null || echo 0)"
    log "Peak memory (whole job, from cgroup): $((bytes / 1073741824)) GB, $(awk -v b="$bytes" -v s="$size" 'BEGIN {printf "%.1f", b / s}')x the .rds size"
fi
if [ "$code" -eq 0 ]; then
    log "Output files:"
    ls -l "$OUT_PARENT/dataset" | sed 's/^/    /'
    log "Total output: $(du -sh "$OUT_PARENT/dataset" | cut -f1)"
fi
if [ -n "${SLURM_JOB_ID:-}" ]; then
    log "Slurm's own numbers, once the job has ended: sacct -j $SLURM_JOB_ID --format=JobID,Elapsed,ReqMem,MaxRSS,State"
    log "(MaxRSS is the figure to divide by the .rds size for the routing ratio)"
fi
exit "$code"
