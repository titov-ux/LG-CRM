#!/usr/bin/env bash
#
# Получить TLS-сертификат через certbot (Let's Encrypt) в standalone-режиме.
# Запускается ОДИН РАЗ при первом подъёме VM, до старта nginx.
#
# Использование:
#   sudo CERT_DOMAIN=staging.crm.lg.ru CERT_EMAIL=ops@lg.ru bash infra/scripts/issue-cert.sh
#
# После: положит fullchain.pem / privkey.pem в infra/certs/.
#
# Если nginx уже запущен на :80 — сначала остановите его (`docker compose ... stop nginx`)
# либо используйте webroot-режим (см. renew-cert.sh).

set -euo pipefail

: "${CERT_DOMAIN:?CERT_DOMAIN не задан}"
: "${CERT_EMAIL:?CERT_EMAIL не задан}"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CERT_DST="${REPO_ROOT}/infra/certs"
mkdir -p "$CERT_DST"

# Standalone — certbot сам поднимет временный listener на :80 для ACME-challenge.
certbot certonly \
    --standalone \
    --non-interactive --agree-tos \
    --email "$CERT_EMAIL" \
    -d "$CERT_DOMAIN"

# Симлинки на актуальные fullchain/privkey, чтобы nginx ничего про /etc/letsencrypt/live не знал.
ln -sf "/etc/letsencrypt/live/${CERT_DOMAIN}/fullchain.pem" "${CERT_DST}/fullchain.pem"
ln -sf "/etc/letsencrypt/live/${CERT_DOMAIN}/privkey.pem"   "${CERT_DST}/privkey.pem"
chmod -R 755 /etc/letsencrypt/live /etc/letsencrypt/archive

echo "[issue-cert] OK — ${CERT_DST}/{fullchain,privkey}.pem"
echo "[issue-cert] Не забудьте поставить renew в cron: bash infra/scripts/setup-cert-renew.sh"
