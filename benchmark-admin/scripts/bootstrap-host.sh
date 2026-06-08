#!/usr/bin/env bash
# One-time provisioning for a fresh host that runs benchmark-admin behind the
# shared Caddy edge proxy (and, later, other services such as multica on the
# same box). Idempotent — safe to re-run.
#
# Usage, from this repo's benchmark-admin/ directory on the new host:
#   sudo ./scripts/bootstrap-host.sh
set -euo pipefail

APP_DIR=/opt/benchmark-admin

# 1. Docker + compose plugin
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker via get.docker.com"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || {
  echo "ERROR: 'docker compose' plugin not available — install docker-compose-plugin and re-run." >&2
  exit 1
}

# 2. Shared edge network — every service stack attaches to this
docker network inspect edge >/dev/null 2>&1 || docker network create edge

# 3. Lay down the deploy files under $APP_DIR
mkdir -p "$APP_DIR/edge"
cp docker-compose.yml "$APP_DIR/"
cp edge/docker-compose.yml edge/Caddyfile "$APP_DIR/edge/"
if [ ! -f "$APP_DIR/.env.production" ]; then
  cp .env.example "$APP_DIR/.env.production"
  echo "==> Created $APP_DIR/.env.production from .env.example — fill in real secrets."
fi

# 4. Bring up the edge proxy (Caddy owns :80/:443 and auto-provisions TLS)
( cd "$APP_DIR/edge" && docker compose up -d )

cat <<NOTE

Host is provisioned. Remaining steps:
  1) Edit $APP_DIR/.env.production with real values.
     SESSION_SECRET must be 64 hex chars:  openssl rand -hex 32
  2) Point DNS: A record benchmark-admin.jy-video.cn -> this host's public IP
     (open security-group ports 80 and 443).
  3) Deploy the app stack from your local checkout:
       DEPLOY_HOST=root@<this-host> CR_NAMESPACE=<your-cr-namespace> \\
         ./scripts/deploy-remote.sh
     (See ./scripts/deploy-remote.sh --help for ENV_FILE / SKIP_BUILD flags.)
NOTE
