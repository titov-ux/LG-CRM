#!/usr/bin/env bash
#
# Обновление TLS-сертификата без даунтайма: webroot-mode + reload nginx.
#
# Запускается из cron (см. setup-cert-renew.sh). certbot сам решает, нужно ли
# обновлять (запускается каждый день, обновляет, если до истечения <30 дней).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEBROOT="${REPO_ROOT}/infra/certbot-webroot"
mkdir -p "$WEBROOT"

certbot renew \
    --webroot --webroot-path "$WEBROOT" \
    --deploy-hook "docker compose -f ${REPO_ROOT}/infra/docker-compose.prod.yml --env-file ${REPO_ROOT}/.env.prod exec nginx nginx -s reload" \
    --quiet
