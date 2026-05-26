#!/usr/bin/env bash
#
# Ежедневный бэкап Postgres в Yandex Object Storage.
#
# Использование:
#   ENV-переменные из .env.prod (DATABASE_URL, S3_*, BACKUP_S3_BUCKET,
#   BACKUP_S3_PREFIX, BACKUP_RETENTION_DAYS).
#   ./scripts/backup_db.sh                  # сделать дамп и залить в S3
#
# Cron (пример — раз в сутки в 01:00 UTC = 04:00 МСК):
#   0 1 * * * cd /opt/crm-lg && /usr/bin/env bash backend/scripts/backup_db.sh \
#       >> /var/log/crm-lg-backup.log 2>&1
#
# Раскладка по бакету: s3://<BACKUP_S3_BUCKET>/<BACKUP_S3_PREFIX>/daily/<file>
# BACKUP_S3_PREFIX обязателен (например, "prod" или "staging") — мы делим
# один бакет между контурами и не хотим смешивать дампы.
#
# Требуется: pg_dump, gzip, awscli (aws s3 cp умеет работать с Yandex Object
# Storage через --endpoint-url=https://storage.yandexcloud.net).

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL не задан}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET не задан}"
# BACKUP_S3_PREFIX — опциональный. Пусто = пишем в s3://<bucket>/daily/...
# (легаси-поведение staging до 2026-05-26). Для prod ставим "prod", чтобы не
# смешиваться со staging в общем бакете.
: "${BACKUP_S3_PREFIX:=}"
: "${S3_ENDPOINT:=https://storage.yandexcloud.net}"
: "${S3_REGION:=ru-central1}"
: "${BACKUP_RETENTION_DAYS:=30}"

# pg_dump запускаем ВНУТРИ postgres-контейнера (`docker exec`):
#  - не зависим от наличия pg_dump на хосте VM;
#  - версия pg_dump гарантированно совпадает с версией сервера (postgres 16);
#  - hostname `postgres` из DATABASE_URL разрешается только внутри docker-сети,
#    с хоста VM он недоступен — поэтому прямой pg_dump падал с
#    "could not translate host name "postgres" to address" (см. memory).

: "${POSTGRES_USER:=crm}"
: "${POSTGRES_DB:=crm_lg}"
: "${POSTGRES_CONTAINER:=crm-lg-postgres}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DUMP_PATH="${TMP_DIR}/crm-lg-${TS}.dump.gz"

echo "[backup] dumping → ${DUMP_PATH}"
docker exec -i "${POSTGRES_CONTAINER}" \
    pg_dump --format=custom --no-owner --no-acl \
        -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    | gzip -9 > "${DUMP_PATH}"

# Префикс без обрамляющих слешей, чтобы итоговый ключ был чистым.
# Пустой префикс → пишем в legacy-путь daily/... (как до 2026-05-26).
PREFIX_CLEAN="${BACKUP_S3_PREFIX#/}"; PREFIX_CLEAN="${PREFIX_CLEAN%/}"
if [ -n "$PREFIX_CLEAN" ]; then
    BACKUP_PATH="${PREFIX_CLEAN}/daily"
else
    BACKUP_PATH="daily"
fi
REMOTE_KEY="${BACKUP_PATH}/crm-lg-${TS}.dump.gz"

echo "[backup] uploading → s3://${BACKUP_S3_BUCKET}/${REMOTE_KEY}"
AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws s3 cp "${DUMP_PATH}" "s3://${BACKUP_S3_BUCKET}/${REMOTE_KEY}" \
        --endpoint-url="${S3_ENDPOINT}" \
        --region "${S3_REGION}" \
        --storage-class STANDARD

# Чистим бэкапы старше BACKUP_RETENTION_DAYS дней.
# Удаляем только из своего пути (с префиксом или без) — чужой контур не трогаем.
echo "[backup] pruning items older than ${BACKUP_RETENTION_DAYS} days under ${BACKUP_PATH}/"
CUTOFF="$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%s 2>/dev/null \
          || date -u -v "-${BACKUP_RETENTION_DAYS}d" +%s)"

AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws s3 ls "s3://${BACKUP_S3_BUCKET}/${BACKUP_PATH}/" \
        --endpoint-url="${S3_ENDPOINT}" \
        --region "${S3_REGION}" \
| while read -r LINE; do
    KEY="$(echo "$LINE" | awk '{print $4}')"
    DATE="$(echo "$LINE" | awk '{print $1" "$2}')"
    [ -z "$KEY" ] && continue
    AGE_SEC="$(date -u -d "$DATE" +%s 2>/dev/null || true)"
    [ -z "$AGE_SEC" ] && continue
    if [ "$AGE_SEC" -lt "$CUTOFF" ]; then
        echo "[backup] removing s3://${BACKUP_S3_BUCKET}/${BACKUP_PATH}/${KEY}"
        AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
        AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
            aws s3 rm "s3://${BACKUP_S3_BUCKET}/${BACKUP_PATH}/${KEY}" \
                --endpoint-url="${S3_ENDPOINT}" \
                --region "${S3_REGION}"
    fi
done

echo "[backup] OK"
