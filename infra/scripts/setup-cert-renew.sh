#!/usr/bin/env bash
#
# Ставит ежедневный cron-job для обновления TLS-сертификата.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

CRON_FILE="/etc/cron.d/crm-lg-cert-renew"
sudo tee "$CRON_FILE" > /dev/null <<EOF
# CRM-LG: автообновление TLS-сертификата (Let's Encrypt).
# Запускается каждый день в 04:30 UTC. Certbot сам обновит, если осталось <30 дней.
30 4 * * * root /usr/bin/env bash ${REPO_ROOT}/infra/scripts/renew-cert.sh >> /var/log/crm-lg-cert.log 2>&1
EOF

sudo systemctl reload cron || sudo service cron reload || true
echo "[setup-cert-renew] установлен ${CRON_FILE}"
