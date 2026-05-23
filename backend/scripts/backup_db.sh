#!/usr/bin/env bash
#
# Ежедневный бэкап Postgres в Yandex Object Storage.
#
# Использование:
#   ENV-переменные из .env.prod (DATABASE_URL, S3_*, BACKUP_S3_BUCKET, BACKUP_RETENTION_DAYS).
#   ./scripts/backup_db.sh                  # сделать дамп и залить в S3
#
# Cron (пример — раз в сутки в 03:15):
#   15 3 * * * cd /opt/crm-lg && /usr/bin/env bash backend/scripts/backup_db.sh >> /var/log/crm-lg-backup.log 2>&1
#
# Требуется: pg_dump, gzip, awscli (aws s3 cp умеет работать с Yandex Object Storage
# через --endpoint-url=https://storage.yandexcloud.net).

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL не задан}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET не задан}"
: "${S3_ENDPOINT:=https://storage.yandexcloud.net}"
: "${S3_REGION:=ru-central1}"
: "${BACKUP_RETENTION_DAYS:=14}"

# DATABASE_URL у нас в asyncpg-формате: postgresql+asyncpg://user:pwd@host:port/db
# Превратим в стандартный postgresql:// для pg_dump.
PG_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

DUMP_PATH="${TMP_DIR}/crm-lg-${TS}.sql.gz"

echo "[backup] dumping → ${DUMP_PATH}"
pg_dump --format=custom --no-owner --no-acl "${PG_URL}" | gzip -9 > "${DUMP_PATH}"

REMOTE_KEY="daily/crm-lg-${TS}.dump.gz"
echo "[backup] uploading → s3://${BACKUP_S3_BUCKET}/${REMOTE_KEY}"
AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws s3 cp "${DUMP_PATH}" "s3://${BACKUP_S3_BUCKET}/${REMOTE_KEY}" \
        --endpoint-url="${S3_ENDPOINT}" \
        --region "${S3_REGION}" \
        --storage-class STANDARD

# Чистим бэкапы старше BACKUP_RETENTION_DAYS дней.
echo "[backup] pruning items older than ${BACKUP_RETENTION_DAYS} days"
CUTOFF="$(date -u -d "-${BACKUP_RETENTION_DAYS} days" +%s 2>/dev/null \
          || date -u -v "-${BACKUP_RETENTION_DAYS}d" +%s)"

AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws s3 ls "s3://${BACKUP_S3_BUCKET}/daily/" \
        --endpoint-url="${S3_ENDPOINT}" \
        --region "${S3_REGION}" \
| while read -r LINE; do
    KEY="$(echo "$LINE" | awk '{print $4}')"
    DATE="$(echo "$LINE" | awk '{print $1" "$2}')"
    [ -z "$KEY" ] && continue
    AGE_SEC="$(date -u -d "$DATE" +%s 2>/dev/null || true)"
    [ -z "$AGE_SEC" ] && continue
    if [ "$AGE_SEC" -lt "$CUTOFF" ]; then
        echo "[backup] removing s3://${BACKUP_S3_BUCKET}/daily/${KEY}"
        AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
        AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
            aws s3 rm "s3://${BACKUP_S3_BUCKET}/daily/${KEY}" \
                --endpoint-url="${S3_ENDPOINT}" \
                --region "${S3_REGION}"
    fi
done

echo "[backup] OK"
