#!/usr/bin/env bash
# Run this ONCE on the ECS before the first docker compose up.
# Requirements: port 80 open, DNS A record for benchmark-admin.jy-video.cn pointing to this ECS.
set -euo pipefail

DOMAIN="benchmark-admin.jy-video.cn"
EMAIL="admin@jy-video.cn"

mkdir -p /var/www/certbot

# Temporary nginx to serve the ACME challenge on port 80
docker run --rm -d --name tmp-nginx -p 80:80 \
  -v /var/www/certbot:/var/www/certbot \
  nginx:1.27-alpine

sleep 2

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos --non-interactive

docker stop tmp-nginx || true

echo "Certs obtained for $DOMAIN. Run: docker compose up -d"
