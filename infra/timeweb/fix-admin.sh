#!/usr/bin/env bash
# Диагностика/починка входа админа. Запуск на Mac из папки CRM-LG:
#     bash infra/timeweb/fix-admin.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"
SERVER_IP="${SERVER_IP:-5.129.198.46}"
scp -q .env.prod "crm@${SERVER_IP}:/opt/crm-lg/.env.prod"
scp -q infra/timeweb/remote-fix-admin.sh "crm@${SERVER_IP}:/opt/crm-lg/infra/timeweb/remote-fix-admin.sh"
ssh "crm@${SERVER_IP}" "bash /opt/crm-lg/infra/timeweb/remote-fix-admin.sh" </dev/null
