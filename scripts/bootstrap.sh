#!/usr/bin/env bash
#
# Первичный деплой на свежей VM. Запускается из корня репозитория один раз.
#
# Что делает:
#   1. Проверяет .env.prod (создаёт из .example, если нет).
#   2. Проверяет наличие infra/certs/{fullchain,privkey}.pem — если нет, подсказывает где взять.
#   3. Собирает фронт (pnpm install + pnpm build).
#   4. docker compose build + up -d (без celery profile).
#   5. alembic upgrade head.
#   6. make seed (admin + permissions).
#   7. (опционально) seed-from-mocks для демо.
#   8. Smoke-проверка /healthz и /auth/login.
#
# Перед запуском убедитесь, что DNS A-запись домена → IP этой VM.

set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(pwd)"
COMPOSE="docker compose -f infra/docker-compose.prod.yml --env-file .env.prod"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://localhost/healthz}"
OPENAPI_URL="${OPENAPI_URL:-https://localhost/api/v1/openapi.json}"

CURL_HEALTH_OPTS=(-fsS)
if [[ "$HEALTHCHECK_URL" == https://* ]]; then
    CURL_HEALTH_OPTS+=(-k)
fi

CURL_OPENAPI_OPTS=(-fsS)
if [[ "$OPENAPI_URL" == https://* ]]; then
    CURL_OPENAPI_OPTS+=(-k)
fi

step() { printf "\n\033[1;36m[bootstrap]\033[0m %s\n" "$*"; }
die()  { printf "\n\033[1;31m[bootstrap] FAIL:\033[0m %s\n" "$*"; exit 1; }

# 1. .env.prod
if [ ! -f .env.prod ]; then
    step "копирую .env.prod.example → .env.prod (открывай в редакторе и заполняй)"
    cp .env.prod.example .env.prod
    chmod 600 .env.prod
    die "Заполни .env.prod (особенно JWT_SECRET, POSTGRES_PASSWORD, ADMIN_PASSWORD, S3-ключи) и перезапусти."
fi
if grep -qE 'CHANGE_ME|change-me-in-prod' .env.prod; then
    die ".env.prod содержит placeholder'ы (CHANGE_ME / change-me-in-prod). Заполни их."
fi

# 2. TLS-сертификат
if [ ! -f infra/certs/fullchain.pem ] || [ ! -f infra/certs/privkey.pem ]; then
    cat <<EOF
[bootstrap] TLS-сертификат не найден.
   Запусти сначала:
     sudo CERT_DOMAIN=<your-domain> CERT_EMAIL=<you@lg.ru> \\
         bash infra/scripts/issue-cert.sh
   Подробнее: docs/tls.md
EOF
    die "Нет infra/certs/{fullchain,privkey}.pem"
fi

# nginx.conf — копируем example, если нет
if [ ! -f infra/nginx.conf ]; then
    step "копирую infra/nginx.example.conf → infra/nginx.conf"
    cp infra/nginx.example.conf infra/nginx.conf
    echo "[bootstrap] поправь server_name в infra/nginx.conf перед прод-релизом"
fi

# 3. Сборка фронта
step "ставлю pnpm (если ещё нет) и собираю фронт"
if ! command -v pnpm >/dev/null 2>&1; then
    npm install -g pnpm
fi
(cd frontend && pnpm install --frozen-lockfile && pnpm build)

# Если bootstrap запускали под sudo — pnpm создал node_modules/dist под root,
# и обычный deploy-vm.sh от имени crm потом падает с EACCES при rm/rewrite.
# Возвращаем владельца сразу, чтобы инкрементальный деплой работал.
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    step "возвращаю владельца $SUDO_USER на $ROOT (после pnpm под root)"
    chown -R "$SUDO_USER:$SUDO_USER" "$ROOT"
fi

# 4. Docker compose
step "поднимаю стек"
$COMPOSE pull --quiet || true
$COMPOSE up -d --build postgres redis backend nginx

step "жду готовности backend (до 60 сек)"
for _ in $(seq 1 30); do
    if curl "${CURL_HEALTH_OPTS[@]}" "$HEALTHCHECK_URL" >/dev/null 2>&1; then break; fi
    sleep 2
done
curl "${CURL_HEALTH_OPTS[@]}" "$HEALTHCHECK_URL" >/dev/null || die "backend не отвечает ($HEALTHCHECK_URL)"

# 5. Миграции
step "alembic upgrade head"
$COMPOSE exec -T backend alembic upgrade head

# 6. Seed
step "seed-admin + seed-permissions"
$COMPOSE exec -T backend make seed

# 7. (опционально) seed-from-mocks
if [ "${SEED_FROM_MOCKS:-0}" = "1" ]; then
    step "залить демо-данные из frontend/mocks/db"
    (cd frontend && pnpm export-seed)
    docker cp frontend/seed_data.json "$($COMPOSE ps -q backend)":/app/frontend/seed_data.json
    $COMPOSE exec -T backend make seed-from-mocks
fi

# 8. Smoke
step "smoke checks"
curl "${CURL_HEALTH_OPTS[@]}" "$HEALTHCHECK_URL"
echo
curl "${CURL_OPENAPI_OPTS[@]}" "$OPENAPI_URL" | jq -r '.info.title'

# 9. Ежедневный бэкап (cron)
# По умолчанию ставим автоматически — БД без бэкапа в prod это всегда ошибка.
# Опт-аут через INSTALL_BACKUP_CRON=0.
if [ "${INSTALL_BACKUP_CRON:-1}" = "1" ]; then
    step "ставлю ежедневный cron-бэкап (01:00 UTC = 04:00 МСК)"
    if [ "$(id -u)" -eq 0 ]; then
        bash infra/scripts/install-backup-cron.sh
    else
        sudo -n bash infra/scripts/install-backup-cron.sh 2>/dev/null \
            || sudo bash infra/scripts/install-backup-cron.sh
    fi
fi

step "готово ✅ — стек поднят"
echo "Дальше:"
echo "  - проверь https://<domain>/healthz из внешней сети"
echo "  - запусти тестовый бэкап:  sudo bash infra/scripts/install-backup-cron.sh --run-now"
echo "  - поставь cert renew:      bash infra/scripts/setup-cert-renew.sh"
echo "  - подключи Sentry:         см. docs/sentry-setup.md"
echo "  - recovery-drill (раз в неделю):  см. backend/scripts/recovery_drill.sh"
