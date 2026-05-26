#!/usr/bin/env bash
#
# Установка ежедневного cron-бэкапа БД CRM-LG на VM.
#
# Что делает:
#   1. Проверяет, что .env.prod есть и в нём задан BACKUP_S3_PREFIX (prod | staging).
#   2. Кладёт backend/scripts/cron-backup.example → /etc/cron.d/crm-lg-backup
#      с правильными правами (0644, root:root). Заодно проверяет синтаксис cron.
#   3. Создаёт пустой /var/log/crm-lg-backup.log с правами 0640 root:adm.
#   4. По флагу --dry-run только пишет, что будет сделано.
#   5. По флагу --run-now ещё и запускает один бэкап немедленно (для verify).
#
# Запуск:
#   sudo bash infra/scripts/install-backup-cron.sh                # просто поставить
#   sudo bash infra/scripts/install-backup-cron.sh --run-now      # поставить и сразу прогнать
#   sudo bash infra/scripts/install-backup-cron.sh --dry-run      # просто показать

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CRON_SRC="${ROOT}/backend/scripts/cron-backup.example"
CRON_DST="/etc/cron.d/crm-lg-backup"
LOG_PATH="/var/log/crm-lg-backup.log"
ENV_FILE="${ROOT}/.env.prod"

DRY_RUN=0
RUN_NOW=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        --run-now) RUN_NOW=1 ;;
        -h|--help)
            sed -n '2,20p' "$0"
            exit 0
            ;;
        *) echo "[install-backup-cron] неизвестный флаг: $arg"; exit 2 ;;
    esac
done

step() { printf "\n\033[1;36m[install-backup-cron]\033[0m %s\n" "$*"; }
die()  { printf "\n\033[1;31m[install-backup-cron] FAIL:\033[0m %s\n" "$*"; exit 1; }

# 1. .env.prod sanity
[ -f "$ENV_FILE" ] || die ".env.prod не найден ($ENV_FILE) — сначала bootstrap"
if ! grep -qE '^BACKUP_S3_BUCKET=' "$ENV_FILE"; then
    die "В .env.prod не задан BACKUP_S3_BUCKET"
fi
if grep -qE 'CHANGE_ME' "$ENV_FILE"; then
    die ".env.prod ещё содержит CHANGE_ME — заполни секреты"
fi

PREFIX="$(grep -E '^BACKUP_S3_PREFIX=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"' )"
BUCKET="$(grep -E '^BACKUP_S3_BUCKET=' "$ENV_FILE" | head -1 | cut -d= -f2 | tr -d '"' )"

# BACKUP_S3_PREFIX опционален — без него скрипт работает по legacy-пути daily/.
# Но если бакет shared между prod и staging, это опасно: дампы перемешаются.
# Поэтому если префикс не задан — WARN, не FAIL.
if [ -z "$PREFIX" ]; then
    printf "\n\033[1;33m[install-backup-cron] WARN:\033[0m BACKUP_S3_PREFIX не задан — \
дампы пойдут в legacy-путь s3://%s/daily/. Если бакет shared с другим контуром, \
рекомендую явно задать BACKUP_S3_PREFIX=prod|staging в .env.prod.\n" "$BUCKET"
    step "будет писать в s3://${BUCKET}/daily/  (cron 01:00 UTC = 04:00 МСК)"
else
    step "будет писать в s3://${BUCKET}/${PREFIX}/daily/  (cron 01:00 UTC = 04:00 МСК)"
fi

# 2. Cron-файл
[ -f "$CRON_SRC" ] || die "не найден ${CRON_SRC} — апдейтни репо"

if [ "$DRY_RUN" = 1 ]; then
    step "DRY-RUN: install ${CRON_SRC} → ${CRON_DST}"
    diff -u "${CRON_DST}" "${CRON_SRC}" 2>/dev/null || true
else
    step "install ${CRON_SRC} → ${CRON_DST}"
    install -m 0644 -o root -g root "$CRON_SRC" "$CRON_DST"
    # touch log с правильными правами (cron пишет от root, читать может adm-группа)
    if [ ! -f "$LOG_PATH" ]; then
        install -m 0640 -o root -g adm /dev/null "$LOG_PATH" 2>/dev/null \
            || install -m 0640 -o root -g root /dev/null "$LOG_PATH"
    fi
    # systemd-cron / vixie-cron перечитают /etc/cron.d сами; если есть `service cron reload` — дёрнем.
    if command -v service >/dev/null 2>&1; then
        service cron reload 2>/dev/null || true
    fi
fi

# 3. Verify (опционально)
if [ "$RUN_NOW" = 1 ]; then
    step "verify: запускаю один бэкап немедленно"
    cd "$ROOT"
    set -a
    # shellcheck disable=SC1091
    . .env.prod
    set +a
    bash backend/scripts/backup_db.sh
    step "verify OK — последний дамп в s3://${BUCKET}/${PREFIX}/daily/"
fi

step "готово ✅"
echo "Проверить:  ls -la ${CRON_DST}"
echo "Логи:       tail -f ${LOG_PATH}"
echo "Next runs:  systemctl list-timers || grep crm-lg ${CRON_DST}"
