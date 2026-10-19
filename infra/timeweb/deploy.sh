#!/usr/bin/env bash
#
# Деплой CRM-LG на Timeweb Cloud. Запускать на Mac из папки CRM-LG:
#     bash infra/timeweb/deploy.sh
#
# Повторный запуск безопасен: это же и обновление прода.
#   1. Копирует код на сервер (rsync, без секретов/мусора) + .env.prod + nginx.conf.
#   2. На сервере: сборка фронта, сертификат (Let's Encrypt, если DNS уже
#      смотрит на сервер, иначе временный самоподписанный), расширения БД,
#      docker compose up, миграции, seed, CORS бакета, cron-бэкап, smoke-тест.
#
# Переменные: SERVER_IP (по умолчанию 5.129.198.46), SSH_KEY, DOMAIN.

set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"

SERVER_IP="${SERVER_IP:-5.129.198.46}"
DOMAIN="${DOMAIN:-crm.lachevsky.ru}"
REMOTE_DIR="/opt/crm-lg"
SSH_OPTS=(-o ConnectTimeout=15 -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
[ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)

step() { printf "\n\033[1;36m[deploy]\033[0m %s\n" "$*"; }
die()  { printf "\n\033[1;31m[deploy] FAIL:\033[0m %s\n" "$*"; exit 1; }

[ -f .env.prod ] || die "нет .env.prod в папке CRM-LG"

# Пользователь crm создаётся cloud-init; если его нет — заходим как root.
# Без BatchMode: если ключ под паролем (passphrase), ssh спросит его.
step "проверяю SSH до ${SERVER_IP}"
if ssh "${SSH_OPTS[@]}" "crm@${SERVER_IP}" true 2>/tmp/crm-ssh-err.log; then
  TARGET="crm@${SERVER_IP}"
elif ssh "${SSH_OPTS[@]}" "root@${SERVER_IP}" true 2>>/tmp/crm-ssh-err.log; then
  TARGET="root@${SERVER_IP}"
else
  echo "---- ошибка ssh ----"; cat /tmp/crm-ssh-err.log
  die "не пускает по SSH — пришлите этот вывод в чат"
fi
# Чтобы не вводить пароль ключа много раз — одно соединение на весь деплой.
SSH_OPTS+=(-o ControlMaster=auto -o ControlPath=/tmp/crm-deploy-%r@%h -o ControlPersist=10m)
SSH=(ssh "${SSH_OPTS[@]}" "$TARGET")
echo "  ✔ вход как ${TARGET%@*}"

step "подготовка сервера (Docker, Node.js, certbot, пользователь crm) — только если ещё не сделано"
"${SSH[@]}" 'sudo bash -s' <<'PROVISION'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
cloud-init status --wait >/dev/null 2>&1 || true
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1 \
   && command -v pnpm >/dev/null && [ -x /snap/bin/aws ] && command -v certbot >/dev/null && id crm >/dev/null 2>&1; then
  echo "  ✔ сервер уже подготовлен"; exit 0
fi
echo "  ставлю пакеты (3–5 мин)…"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git rsync unzip jq cron logrotate snapd \
  postgresql-client docker.io docker-compose-v2 docker-buildx >/dev/null
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{"registry-mirrors": ["https://dockerhub.timeweb.cloud"],
 "log-driver": "json-file", "log-opts": {"max-size": "20m", "max-file": "5"}}
JSON
systemctl enable --now docker >/dev/null 2>&1; systemctl restart docker
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pnpm >/dev/null || npm i -g pnpm >/dev/null 2>&1
[ -x /snap/bin/aws ] || snap install aws-cli --classic >/dev/null
command -v certbot >/dev/null || { snap install --classic certbot >/dev/null; ln -sf /snap/bin/certbot /usr/local/bin/certbot; }
if ! id crm >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G sudo,docker crm
  echo 'crm ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-crm && chmod 440 /etc/sudoers.d/90-crm
  install -d -m 700 -o crm -g crm /home/crm/.ssh
  install -m 600 -o crm -g crm /root/.ssh/authorized_keys /home/crm/.ssh/authorized_keys
fi
echo "alias dc='sudo docker compose -f /opt/crm-lg/infra/docker-compose.timeweb.yml --env-file /opt/crm-lg/.env.prod --profile celery'" > /etc/profile.d/crm-lg.sh
mkdir -p /opt/crm-lg
echo "  ✔ docker $(docker --version | awk '{print $3}' | tr -d ,), node $(node -v), pnpm $(pnpm -v)"
PROVISION
"${SSH[@]}" "sudo mkdir -p ${REMOTE_DIR} && sudo chown -R \$(id -un):\$(id -gn) ${REMOTE_DIR}"

step "копирую код"
rsync -az --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude '.pnpm-store/' --exclude '_to_delete/' \
  --exclude '_tmp*' --exclude 'Claude outputs/' --exclude '.claude/' --exclude '.DS_Store' \
  --exclude '__pycache__/' --exclude '.pytest_cache/' --exclude '.ruff_cache/' --exclude 'pytest-cache-files-*' \
  --exclude '.tanstack/' --exclude '*.docx' --exclude '*.pdf' \
  --exclude 'infra/terraform/' --exclude 'infra/rescue/' --exclude 'secrets.txt' \
  --exclude '/.env.prod' --exclude 'frontend/.env' --exclude 'frontend/.env.production' --exclude 'frontend/dist/' \
  --exclude 'infra/certs/' --exclude 'infra/nginx.conf' --exclude 'infra/certbot-webroot/' \
  -e "ssh ${SSH_OPTS[*]}" ./ "${TARGET}:${REMOTE_DIR}/"
scp "${SSH_OPTS[@]}" -q .env.prod "${TARGET}:${REMOTE_DIR}/.env.prod"
scp "${SSH_OPTS[@]}" -q infra/timeweb/nginx.conf "${TARGET}:${REMOTE_DIR}/infra/nginx.conf"
"${SSH[@]}" "chmod 600 ${REMOTE_DIR}/.env.prod"
echo "  ✔ код на сервере"

step "запускаю установку на сервере (первый раз 10–20 мин: сборка образов и модели распознавания)"
"${SSH[@]}" "cd ${REMOTE_DIR} && DOMAIN=${DOMAIN} SERVER_IP=${SERVER_IP} bash infra/timeweb/remote-setup.sh" </dev/null

step "готово ✅  Откройте https://${DOMAIN} (или https://${SERVER_IP}, пока не переключён DNS)."
echo "  Логин и пароль администратора — в secrets.txt (CRM_ADMIN_LOGIN / CRM_ADMIN_PASSWORD)."
