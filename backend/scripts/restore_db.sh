#!/usr/bin/env bash
#
# Восстановление БД из дампа в Object Storage. Использовать на staging для
# проверки бэкапа и при инциденте.
#
# Использование:
#   ./scripts/restore_db.sh s3://crm-lg-backups/daily/crm-lg-20260520T031500Z.dump.gz
#
# ВНИМАНИЕ: дроп схемы — деструктивно. Скрипт спрашивает подтверждение.

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "usage: $0 <s3-uri-to-dump>"; exit 2
fi

: "${DATABASE_URL:?DATABASE_URL не задан}"
: "${S3_ENDPOINT:=https://storage.yandexcloud.net}"
: "${S3_REGION:=ru-central1}"

PG_URL="${DATABASE_URL/postgresql+asyncpg/postgresql}"
S3_URI="$1"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
LOCAL="${TMP_DIR}/dump.gz"

echo "[restore] downloading ${S3_URI}"
AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws s3 cp "$S3_URI" "$LOCAL" \
        --endpoint-url="${S3_ENDPOINT}" \
        --region "${S3_REGION}"

echo "[restore] target DB: ${PG_URL}"
echo "Will DROP and re-create public schema. Type 'yes' to continue:"
read -r CONFIRM
[ "$CONFIRM" = "yes" ] || { echo "aborted"; exit 1; }

psql "$PG_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c "$LOCAL" | pg_restore --no-owner --no-acl --dbname="$PG_URL"

echo "[restore] OK"
