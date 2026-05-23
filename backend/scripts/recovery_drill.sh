#!/usr/bin/env bash
#
# Еженедельный recovery-drill: проверяем, что свежий бэкап реально разворачивается.
#
# 1. Берём последний дамп из S3.
# 2. Поднимаем временную БД `crm_lg_drill` рядом с боевой.
# 3. Восстанавливаем дамп.
# 4. Проверяем invariants: alembic_version актуален; users непустая; users.is_active>0.
# 5. Дропаем drill-БД.
#
# Запуск:
#   bash backend/scripts/recovery_drill.sh
# Cron — раз в неделю в воскресенье:
#   30 5 * * 0 root cd /opt/crm-lg && set -a && . .env.prod && set +a && \
#        /usr/bin/env bash backend/scripts/recovery_drill.sh >> /var/log/crm-lg-drill.log 2>&1
#
# Требуется: aws, psql, pg_restore, gunzip.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL не задан}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET не задан}"
: "${S3_ENDPOINT:=https://storage.yandexcloud.net}"
: "${S3_REGION:=ru-central1}"

PG_URL_BASE="${DATABASE_URL/postgresql+asyncpg/postgresql}"
# Вычленим только host/user/password части, чтобы потом подменить имя БД.
ADMIN_URL="$(echo "$PG_URL_BASE" | sed -E 's|/[^/?]+($|\?)|/postgres\1|')"
DRILL_DB="crm_lg_drill_$(date -u +%s)"
DRILL_URL="$(echo "$PG_URL_BASE" | sed -E "s|/[^/?]+($|\?)|/${DRILL_DB}\1|")"

echo "[drill] target test DB: $DRILL_DB"

# Находим последний дамп.
LATEST_KEY="$(
    AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
    AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
        aws s3 ls "s3://${BACKUP_S3_BUCKET}/daily/" \
            --endpoint-url="${S3_ENDPOINT}" --region "${S3_REGION}" \
        | sort -k1,2 -r | head -1 | awk '{print $4}'
)"
[ -z "$LATEST_KEY" ] && { echo "[drill] нет файлов в s3://${BACKUP_S3_BUCKET}/daily/"; exit 1; }
echo "[drill] latest backup: $LATEST_KEY"

TMP_DIR="$(mktemp -d)"
LOCAL="${TMP_DIR}/dump.gz"
trap 'rm -rf "$TMP_DIR"; psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$DRILL_DB\";" || true' EXIT

AWS_ACCESS_KEY_ID="${S3_ACCESS_KEY:-${AWS_ACCESS_KEY_ID:-}}" \
AWS_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-${AWS_SECRET_ACCESS_KEY:-}}" \
    aws s3 cp "s3://${BACKUP_S3_BUCKET}/daily/${LATEST_KEY}" "$LOCAL" \
        --endpoint-url="${S3_ENDPOINT}" --region "${S3_REGION}"

echo "[drill] create + restore"
psql "$ADMIN_URL" -c "CREATE DATABASE \"$DRILL_DB\";"
gunzip -c "$LOCAL" | pg_restore --no-owner --no-acl --dbname="$DRILL_URL"

echo "[drill] invariants"
LATEST_REV="$(psql "$DRILL_URL" -tA -c "SELECT version_num FROM alembic_version;")"
USER_COUNT="$(psql "$DRILL_URL" -tA -c "SELECT count(*) FROM users;")"
ACTIVE_COUNT="$(psql "$DRILL_URL" -tA -c "SELECT count(*) FROM users WHERE is_active=true;")"

echo "[drill] alembic_version = $LATEST_REV"
echo "[drill] users total = $USER_COUNT"
echo "[drill] users active = $ACTIVE_COUNT"

EXIT=0
[ -z "$LATEST_REV" ]                    && { echo "[drill] FAIL: alembic_version пустой";    EXIT=1; }
[ "${USER_COUNT:-0}" -lt 1 ]            && { echo "[drill] FAIL: ни одного пользователя";    EXIT=1; }
[ "${ACTIVE_COUNT:-0}" -lt 1 ]          && { echo "[drill] FAIL: ни одного активного";       EXIT=1; }

if [ "$EXIT" = 0 ]; then
    echo "[drill] OK — бэкап восстанавливается, invariants держатся"
fi
exit $EXIT
