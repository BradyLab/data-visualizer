#!/usr/bin/env bash
# Nightly update of the production stack (run by data-visualizer-update.timer, or by hand: sudo ./deploy/update.sh).
#
# Pulls the images that .github/workflows/images.yml published, restarts the services whose image changed, waits for the site to be healthy,
# and goes back to the previous images when it is not. Then deletes the images nothing uses any more.
#
#   - Needs IMAGE_PREFIX (and optionally IMAGE_TAG) in .env, so the images come from the registry (see .env.prod.example).
#   - Postgres and Caddy are pulled too: a new patch release of their tag is installed the same way. Major versions never arrive this way,
#     because the tags in docker-compose.prod.yml name them (postgres:18-alpine).
#   - The compose file itself is NOT updated here: a change to docker-compose.prod.yml or .env.prod.example (new settings) needs a person to
#     `git pull` and read the diff first.
#   - A rollback restores the old images, not the database: migrations the new backend already ran stay applied.
#   - An update that failed its health check is remembered (.update-state/bad-images), so the same broken release is not tried every night:
#     later runs keep the working images and fail loudly until a newer image is published.
#   - Optional: set UPDATE_PING_URL in .env to a healthchecks.io-style check. It is pinged after every successful run and at <url>/fail after a
#     failed one, and the service emails you when nothing has pinged for a day (the timer or the server stopped).
#
# Exit status: 0 when the stack is up to date and healthy, 1 otherwise (the systemd unit then shows as failed: journalctl -u data-visualizer-update).
# Settings through the environment (defaults in brackets): COMPOSE_FILE [docker-compose.prod.yml], HEALTH_SERVICES [backend web],
# HEALTH_TIMEOUT seconds [300], STATE_DIR [.update-state in the repository folder].
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_SERVICES="${HEALTH_SERVICES:-backend web}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"
STATE_DIR="${STATE_DIR:-$ROOT/.update-state}"
BAD_FILE="$STATE_DIR/bad-images"
mkdir -p "$STATE_DIR"
touch "$BAD_FILE"

log() { echo "[update $(date -u +%FT%TZ)] $*"; }
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

PING_URL="${UPDATE_PING_URL:-$(sed -n 's/^UPDATE_PING_URL=//p' .env 2>/dev/null | tail -n 1 || true)}"
ping_check() { if [ -n "$PING_URL" ]; then curl -fsS -m 10 --retry 3 -o /dev/null "$PING_URL$1" || true; fi; }

# Reports a failure (log, ping, non-zero exit). Also runs for any command that fails unexpectedly, such as a pull while the registry is down
fail() {
    log "FAILED: $*"
    ping_check /fail
    trap - ERR
    exit 1
}
trap 'fail "command failed (line $LINENO): $BASH_COMMAND"' ERR

# One update at a time, whether from the timer or by hand
exec 9>"$STATE_DIR/lock"
flock -n 9 || {
    log "another update is already running"
    exit 0
}

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }
repo_of() { echo "${1%:*}"; }

# "healthy" for a service with a health check, "running" for one without; anything else (starting, unhealthy, restarting, exited, missing) is not ok
service_state() {
    local cid
    cid="$(dc ps -q "$1" | head -n 1)"
    if [ -z "$cid" ]; then
        echo missing
        return
    fi
    docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid"
}

wait_healthy() {
    local deadline=$((SECONDS + HEALTH_TIMEOUT)) service ok
    while :; do
        ok=1
        for service in $HEALTH_SERVICES; do
            case "$(service_state "$service")" in
                healthy | running) ;;
                *) ok=0 ;;
            esac
        done
        if [ "$ok" = 1 ]; then return 0; fi
        if [ "$SECONDS" -ge "$deadline" ]; then return 1; fi
        sleep 5
    done
}

# Points every changed image's tag back at the image it had before the pull
revert() {
    local image
    for image in "${changed[@]}"; do
        if [ -n "${before[$image]}" ]; then docker tag "${before[$image]}" "$image"; fi
    done
}

mapfile -t IMAGES < <(dc config --images | sort -u)

# Remember what runs now. The extra :previous tag keeps the old image from being pruned once a pull moves the real tag to the new one
declare -A before
for image in "${IMAGES[@]}"; do
    before[$image]="$(image_id "$image")"
    if [ -n "${before[$image]}" ]; then docker tag "${before[$image]}" "$(repo_of "$image"):previous"; fi
done

log "pulling images"
dc pull --quiet || fail "could not pull the images (registry or network down, or IMAGE_PREFIX not set in .env?); the running containers were left alone"

changed=()
for image in "${IMAGES[@]}"; do
    if [ "$(image_id "$image")" != "${before[$image]}" ]; then changed+=("$image"); fi
done

if [ "${#changed[@]}" -eq 0 ]; then
    log "images are up to date"
    # Also starts anything that is stopped and applies changes to the compose file or .env; a stack that is not healthy is reported
    dc up -d --no-build --remove-orphans
    wait_healthy || fail "no new images, but the stack is not healthy"
    docker image prune -f > /dev/null
    ping_check ""
    exit 0
fi

for image in "${changed[@]}"; do
    if grep -qxF "$(image_id "$image")" "$BAD_FILE"; then
        revert
        fail "the published image of $image failed its health check on an earlier night; keeping the working one until a newer image is published"
    fi
done

log "updating: ${changed[*]}"
dc up -d --no-build --remove-orphans
if wait_healthy; then
    log "updated and healthy"
    docker image prune -f > /dev/null
    ping_check ""
    exit 0
fi

log "unhealthy after the update; rolling back"
for image in "${changed[@]}"; do image_id "$image" >> "$BAD_FILE"; done
revert
dc up -d --no-build --remove-orphans
if wait_healthy; then
    fail "the new images were not healthy; went back to the previous ones, which are running"
fi
fail "the new images were not healthy, and the previous ones are not healthy either; the site may be down"
