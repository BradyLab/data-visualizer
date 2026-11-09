#!/usr/bin/env bash
# Keeps the cluster's copy of the preprocess image (a .sif file) in step with the registry, so the large-memory worker runs the same image
# as the web server, which pulls the same tag every night. Called at the start of cluster-worker.sbatch; it can also be run by hand.
# Asks the registry for the digest of the tag (a small curl request) and only pulls when it differs from the one stored next to the .sif:
# apptainer pull rebuilds the whole file each time, which takes minutes and several GB of scratch.
#
# Settings (environment variables):
#   PREPROCESS_IMAGE     the .sif file to keep up to date (required; anything else, e.g. a docker:// address, is used as is and left alone)
#   IMAGE_REPO           registry path (default ghcr.io/bradylab/data-visualizer-preprocess)
#   PREPROCESS_TAG       the tag to follow (default latest; set a version tag to hold the cluster back, e.g. after a bad release)
#   REFRESH_IMAGE        0 = do nothing (keeps the current file)
#   APPTAINER            the Apptainer program (default apptainer);  APPTAINER_CACHEDIR / APPTAINER_TMPDIR: keep them out of a small home folder
#
# A failed refresh (registry down, rate limit, a pull that does not work) is only a warning: the current .sif keeps being used. Exit 1 only
# when there is no usable .sif at all. The previous file is kept as <name>.sif.prev, to go back with: mv x.sif.prev x.sif
# The new file is built under another name and moved into place in one step, so a job that is running keeps the file it opened.
set -uo pipefail

IMAGE="${PREPROCESS_IMAGE:-}"
REPO="${IMAGE_REPO:-ghcr.io/bradylab/data-visualizer-preprocess}"
TAG="${PREPROCESS_TAG:-latest}"
APPTAINER="${APPTAINER:-apptainer}"

log() { echo "[refresh $(date -u +%FT%TZ)] $*"; }

[ -n "$IMAGE" ] || {
    log "PREPROCESS_IMAGE is not set"
    exit 1
}
case "$IMAGE" in
    *.sif) ;;
    *)
        log "PREPROCESS_IMAGE is not a .sif file, nothing to refresh"
        exit 0
        ;;
esac
if [ "${REFRESH_IMAGE:-1}" = 0 ]; then
    log "REFRESH_IMAGE=0, keeping $IMAGE"
    [ -f "$IMAGE" ] && exit 0
    log "$IMAGE does not exist"
    exit 1
fi

# Without a usable current file the only thing to do is fail; with one, every problem below is only a warning
keep_going() { # <message>
    log "$1"
    if [ -f "$IMAGE" ]; then
        log "Keeping the current $IMAGE"
        exit 0
    fi
    log "There is no $IMAGE to fall back on"
    exit 1
}

# One refresh at a time (two jobs starting together): the second waits, then finds the file up to date
if command -v flock > /dev/null 2>&1; then
    exec 9> "$IMAGE.lock" || keep_going "Cannot create $IMAGE.lock"
    flock -w 1800 9 || keep_going "Another refresh did not finish within 30 minutes"
fi

# Anonymous access, which a public package allows: a token, then the digest of the tag from the manifest's headers
registry="${REPO%%/*}"
path="${REPO#*/}"
token="$(curl -fsS --max-time 30 "https://$registry/token?service=$registry&scope=repository:$path:pull" 2> /dev/null |
    sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p')"
[ -n "$token" ] || keep_going "Could not get a registry token for $REPO (is the package public?)"
accept="application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json"
accept="$accept, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
digest="$(curl -fsSI --max-time 30 -H "Authorization: Bearer $token" -H "Accept: $accept" "https://$registry/v2/$path/manifests/$TAG" 2> /dev/null |
    tr -d '\r' | awk 'tolower($1) == "docker-content-digest:" {print $2}')"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || keep_going "Could not read the digest of $REPO:$TAG"

if [ -f "$IMAGE" ] && [ "$(cat "$IMAGE.digest" 2> /dev/null)" = "$digest" ]; then
    log "$IMAGE is up to date ($REPO:$TAG, ${digest:0:19})"
    exit 0
fi

log "Pulling $REPO:$TAG (${digest:0:19}) as the new $IMAGE"
NEW="$IMAGE.new"
rm -f "$NEW"
# By digest, not by tag: what is built is exactly what was checked, even if the tag moves meanwhile
if ! "$APPTAINER" pull --force "$NEW" "docker://$REPO@$digest" > /dev/null 2>&1; then
    rm -f "$NEW"
    keep_going "Pulling the image failed"
fi
# A file that cannot run the preprocess script is not worth switching to
if ! "$APPTAINER" exec --cleanenv "$NEW" test -f /preprocess.R > /dev/null 2>&1; then
    rm -f "$NEW"
    keep_going "The new image does not contain /preprocess.R"
fi
had_old=0
[ -f "$IMAGE" ] && had_old=1 && mv -f "$IMAGE" "$IMAGE.prev"
if ! mv -f "$NEW" "$IMAGE"; then
    [ "$had_old" = 1 ] && mv -f "$IMAGE.prev" "$IMAGE"
    keep_going "Could not move the new image into place"
fi
echo "$digest" > "$IMAGE.digest"
log "Now using $REPO:$TAG (${digest:0:19})$([ "$had_old" = 1 ] && echo "; the old one is $IMAGE.prev")"
exit 0
