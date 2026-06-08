#!/usr/bin/env bash
# Deploy benchmark-admin to a host already provisioned by ./scripts/bootstrap-host.sh.
#
# Pipeline:
#   1. Build the api + admin-nginx images locally with `docker compose build`.
#   2. (Optional) Push them to volces CR (cr.volces.com/${CR_NAMESPACE}/...).
#   3. rsync compose files (docker-compose.yml + edge/) to ${APP_DIR} on the host.
#   4. (Optional) rsync ${ENV_FILE} → ${APP_DIR}/.env.production. Permissions chmod 600.
#   5. ssh + `docker compose pull && docker compose up -d --remove-orphans`.
#   6. Wait for the api healthcheck to go green and print the public URL.
#
# Idempotent — safe to re-run. Build/push can be skipped if you already have the
# image in CR (SKIP_BUILD=1 + IMAGE_TAG=...).
#
# Required env or flags:
#   DEPLOY_HOST     ssh target (e.g. root@1.2.3.4 or a ~/.ssh/config alias)
#   CR_NAMESPACE    volces CR namespace, used by docker-compose.yml at image:
#
# Optional:
#   IMAGE_TAG       defaults to the current git short SHA (or "latest" outside a git tree)
#   APP_DIR         host path; defaults to /opt/benchmark-admin
#   SSH_KEY         passed to ssh -i; defaults to ssh-agent / ~/.ssh/config
#   ENV_FILE        local path; rsync'd to ${APP_DIR}/.env.production (mode 600)
#   SKIP_BUILD=1    skip the docker compose build step (assume IMAGE_TAG already in CR)
#   SKIP_PUSH=1     build locally but don't push (useful for dry-runs)
#   DOMAIN          public hostname for the post-deploy curl probe; default
#                   benchmark-admin.jy-video.cn
#
# Flag form for the must-haves:
#   ./scripts/deploy-remote.sh --host root@1.2.3.4 --namespace my-cr-ns
#
# Examples:
#   # First real deploy after bootstrap (assumes ENV file is already on the host)
#   DEPLOY_HOST=root@1.2.3.4 CR_NAMESPACE=jy-video ./scripts/deploy-remote.sh
#
#   # Push a fresh env file along with the rollout
#   DEPLOY_HOST=root@1.2.3.4 CR_NAMESPACE=jy-video \
#     ENV_FILE=./.env.production.staging \
#     ./scripts/deploy-remote.sh
#
#   # Fast rollback to a known good tag (no rebuild)
#   DEPLOY_HOST=root@1.2.3.4 CR_NAMESPACE=jy-video \
#     IMAGE_TAG=abc1234 SKIP_BUILD=1 \
#     ./scripts/deploy-remote.sh

set -euo pipefail

ADMIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── arg / env wiring ──────────────────────────────────────────────────────────
DEPLOY_HOST="${DEPLOY_HOST:-}"
CR_NAMESPACE="${CR_NAMESPACE:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
APP_DIR="${APP_DIR:-/opt/benchmark-admin}"
SSH_KEY="${SSH_KEY:-}"
ENV_FILE="${ENV_FILE:-}"
SKIP_BUILD="${SKIP_BUILD:-0}"
SKIP_PUSH="${SKIP_PUSH:-0}"
DOMAIN="${DOMAIN:-benchmark-admin.jy-video.cn}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host)        DEPLOY_HOST="$2";  shift 2 ;;
    --namespace)   CR_NAMESPACE="$2"; shift 2 ;;
    --tag)         IMAGE_TAG="$2";    shift 2 ;;
    --app-dir)     APP_DIR="$2";      shift 2 ;;
    --ssh-key)     SSH_KEY="$2";      shift 2 ;;
    --env-file)    ENV_FILE="$2";     shift 2 ;;
    --domain)      DOMAIN="$2";       shift 2 ;;
    --skip-build)  SKIP_BUILD=1;      shift   ;;
    --skip-push)   SKIP_PUSH=1;       shift   ;;
    -h|--help)
      sed -n '2,/^set -euo/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$DEPLOY_HOST" ]; then
  echo "DEPLOY_HOST is required (env or --host)." >&2
  exit 2
fi
if [ -z "$CR_NAMESPACE" ]; then
  echo "CR_NAMESPACE is required (env or --namespace)." >&2
  exit 2
fi
if [ -z "$IMAGE_TAG" ]; then
  if git -C "$ADMIN_DIR" rev-parse --short HEAD >/dev/null 2>&1; then
    IMAGE_TAG="$(git -C "$ADMIN_DIR" rev-parse --short HEAD)"
  else
    IMAGE_TAG="latest"
  fi
fi

# ── tool checks ───────────────────────────────────────────────────────────────
for bin in docker rsync ssh; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "Missing tool: $bin" >&2
    exit 1
  }
done
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 plugin is required ('docker compose')." >&2
  exit 1
}

# ── ssh / rsync wiring ────────────────────────────────────────────────────────
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS+=(-i "$SSH_KEY")
fi
SSH=(ssh "${SSH_OPTS[@]}" "$DEPLOY_HOST")
RSYNC_RSH="ssh ${SSH_OPTS[*]}"

# Vars compose needs in *both* environments (local build + remote up).
COMPOSE_ENV=(CR_NAMESPACE="$CR_NAMESPACE" IMAGE_TAG="$IMAGE_TAG")

echo "==> Target:     $DEPLOY_HOST:$APP_DIR"
echo "==> Image tag:  $IMAGE_TAG"
echo "==> Namespace:  $CR_NAMESPACE"

cd "$ADMIN_DIR"

# ── 1+2. build + push ─────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" != "1" ]; then
  echo "==> docker compose build (api + admin-nginx)"
  env "${COMPOSE_ENV[@]}" docker compose build
  if [ "$SKIP_PUSH" != "1" ]; then
    echo "==> docker compose push"
    env "${COMPOSE_ENV[@]}" docker compose push
  else
    echo "==> SKIP_PUSH=1, not pushing — images stay local."
  fi
else
  echo "==> SKIP_BUILD=1, assuming $IMAGE_TAG is already in CR."
fi

# ── 3. lay down deploy files on the host ──────────────────────────────────────
echo "==> ssh: ensure $APP_DIR + $APP_DIR/edge exist"
"${SSH[@]}" "mkdir -p '$APP_DIR/edge'"

echo "==> rsync compose files → $APP_DIR"
rsync -az --delete \
  -e "$RSYNC_RSH" \
  "$ADMIN_DIR/docker-compose.yml" \
  "$DEPLOY_HOST:$APP_DIR/docker-compose.yml"
rsync -az --delete \
  -e "$RSYNC_RSH" \
  "$ADMIN_DIR/edge/" \
  "$DEPLOY_HOST:$APP_DIR/edge/"

# ── 4. (optional) push the env file ───────────────────────────────────────────
if [ -n "$ENV_FILE" ]; then
  if [ ! -f "$ENV_FILE" ]; then
    echo "ENV_FILE does not exist: $ENV_FILE" >&2
    exit 1
  fi
  echo "==> rsync $ENV_FILE → $APP_DIR/.env.production"
  rsync -az \
    -e "$RSYNC_RSH" \
    "$ENV_FILE" \
    "$DEPLOY_HOST:$APP_DIR/.env.production"
  "${SSH[@]}" "chmod 600 '$APP_DIR/.env.production'"
fi

# ── 5. compose pull + up on the host ──────────────────────────────────────────
echo "==> ssh: docker compose pull + up -d on $DEPLOY_HOST"
"${SSH[@]}" "cd '$APP_DIR' && \
  ${COMPOSE_ENV[*]} docker compose pull && \
  ${COMPOSE_ENV[*]} docker compose up -d --remove-orphans"

# Ensure the shared edge proxy is running (idempotent — no-op if already up).
"${SSH[@]}" "cd '$APP_DIR/edge' && docker compose up -d"

# ── 6. health probe ───────────────────────────────────────────────────────────
echo "==> waiting for api healthcheck to go green (max 60s)"
deadline=$(( $(date +%s) + 60 ))
status=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  status=$("${SSH[@]}" "cd '$APP_DIR' && \
    ${COMPOSE_ENV[*]} docker compose ps --format '{{.Service}} {{.Health}}' \
    | awk '\$1 == \"api\" { print \$2 }'" || true)
  case "$status" in
    healthy)   echo "==> api is healthy"; break ;;
    "")        sleep 3 ;;
    *)         sleep 3 ;;
  esac
done
if [ "$status" != "healthy" ]; then
  echo "WARN: api health is '$status' after 60s — check 'docker compose logs api' on the host." >&2
fi

echo ""
echo "Deploy complete."
echo "Image:   cr.volces.com/$CR_NAMESPACE/benchmark-admin-{api,nginx}:$IMAGE_TAG"
echo "Public:  https://$DOMAIN  (Caddy auto-provisions TLS the first time DNS resolves)"
echo "Probe:   curl -fsS https://$DOMAIN/api/trpc/health"
