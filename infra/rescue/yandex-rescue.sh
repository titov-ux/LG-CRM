#!/usr/bin/env bash
#
# Аварийная выгрузка данных CRM-LG из старого Yandex Cloud (prod).
# Запускать на Mac из папки CRM-LG:
#     bash infra/rescue/yandex-rescue.sh
#
# Скрипт ТОЛЬКО ЧИТАЕТ: ничего не удаляет и не меняет в Яндексе.
# Каждый шаг независим — если один не сработал, остальные всё равно выполнятся.
#
#   1. Проверка ВМ и диска через yc CLI (если установлен).
#   2. SSH на старый сервер → дамп БД (pg_dump), .env.prod, при неудаче — сырой каталог Postgres.
#   3. Скачивание бакетов Object Storage: файлы prod, бэкапы БД, файлы staging.
#
# Результат: ~/CRM-LG-rescue/<дата-время>/  (вне репозитория — там персональные данные).
#
# Переменные (необязательно):
#   SSH_KEY=~/.ssh/id_ed25519    ключ для сервера (по умолчанию пробуем стандартные)
#   SERVER_IP=130.193.48.47      IP старого prod
#   SKIP_S3=1 / SKIP_SSH=1 / SKIP_YC=1   пропустить шаг

set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TF="${ROOT}/infra/terraform/terraform.tfstate.d"
SERVER_IP="${SERVER_IP:-130.193.48.47}"
SERVER_USER="crm"
VM_ID="fhmp026ekbas8d2r0sa9"
DISK_ID="fhm2vjl84ev0oo8s874p"
FOLDER_ID="b1gl1opj9lktq3k2vp0v"
S3_ENDPOINT="https://storage.yandexcloud.net"
OUT="${HOME}/CRM-LG-rescue/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
LOG="${OUT}/rescue.log"

say()  { printf "\n\033[1;36m[rescue]\033[0m %s\n" "$*" | tee -a "$LOG"; }
ok()   { printf "\033[1;32m  ✔ %s\033[0m\n" "$*" | tee -a "$LOG"; }
bad()  { printf "\033[1;31m  ✘ %s\033[0m\n" "$*" | tee -a "$LOG"; }

say "Папка для выгрузки: $OUT"

# ───────────────────────── 1. yc: состояние ВМ и диска ─────────────────────────
if [ "${SKIP_YC:-0}" != 1 ]; then
  say "1/3 Состояние ВМ и диска в Yandex Cloud"
  if command -v yc >/dev/null 2>&1; then
    yc compute instance get "$VM_ID" --folder-id "$FOLDER_ID" >"${OUT}/yc-vm.txt" 2>&1 \
      && ok "ВМ найдена: $(grep -E '^status:' "${OUT}/yc-vm.txt")" \
      || bad "ВМ не отвечает/не найдена (подробно: yc-vm.txt)"
    yc compute disk get "$DISK_ID" --folder-id "$FOLDER_ID" >"${OUT}/yc-disk.txt" 2>&1 \
      && ok "Загрузочный диск существует: $(grep -E '^status:' "${OUT}/yc-disk.txt")" \
      || bad "Диск не найден (yc-disk.txt)"
    yc compute snapshot list --folder-id "$FOLDER_ID" >"${OUT}/yc-snapshots.txt" 2>&1 \
      && ok "Список снимков дисков: yc-snapshots.txt"
    if grep -qE '^status: READY' "${OUT}/yc-disk.txt" 2>/dev/null; then
      echo "  → Диск жив. Даже если ВМ не стартует, данные можно спасти снимком:" | tee -a "$LOG"
      echo "    yc compute snapshot create --disk-id $DISK_ID --name crm-lg-prod-rescue --folder-id $FOLDER_ID" | tee -a "$LOG"
      echo "    (затем — новая ВМ из снимка, и снова этот скрипт с SERVER_IP=<новый IP>)" | tee -a "$LOG"
    fi
  else
    bad "yc CLI не установлен — пропускаю (brew install yandex-cloud-cli не обязателен)"
  fi
fi

# ───────────────────────── 2. SSH: дамп БД с сервера ─────────────────────────
if [ "${SKIP_SSH:-0}" != 1 ]; then
  say "2/3 Подключение к серверу ${SERVER_USER}@${SERVER_IP}"
  SSH_OPTS=(-o ConnectTimeout=10 -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
  [ -n "${SSH_KEY:-}" ] && SSH_OPTS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
  SSH=(ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_IP}")

  if "${SSH[@]}" true 2>>"$LOG"; then
    ok "Сервер доступен по SSH"

    "${SSH[@]}" 'cat /opt/crm-lg/.env.prod' >"${OUT}/env.prod.from-server" 2>>"$LOG" \
      && chmod 600 "${OUT}/env.prod.from-server" \
      && ok ".env.prod сохранён (секреты: JWT, ключи API, SMTP)" \
      || bad "Не удалось прочитать /opt/crm-lg/.env.prod"

    DUMP="${OUT}/crm_lg-$(date +%Y%m%dT%H%M%S).dump"
    if "${SSH[@]}" 'docker exec crm-lg-postgres sh -c "pg_dump -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -Fc"' >"$DUMP" 2>>"$LOG" \
       && [ -s "$DUMP" ]; then
      ok "Дамп БД: $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))"
    else
      bad "pg_dump не получился (контейнер не запущен?). Пробую забрать сырой каталог Postgres…"
      rm -f "$DUMP"
      "${SSH[@]}" 'sudo sh -c "tar -C /var/lib/docker/volumes -czf - \$(ls /var/lib/docker/volumes | grep postgres_data)"' \
        >"${OUT}/postgres_data-raw.tgz" 2>>"$LOG" && [ -s "${OUT}/postgres_data-raw.tgz" ] \
        && ok "Сырой каталог Postgres: postgres_data-raw.tgz ($(du -h "${OUT}/postgres_data-raw.tgz" | cut -f1)) — поднимается в postgres:16" \
        || { bad "Сырой каталог тоже не забрать"; rm -f "${OUT}/postgres_data-raw.tgz"; }
    fi

    "${SSH[@]}" 'ls -la /opt/crm-lg; docker ps -a; df -h; sudo tail -50 /var/log/crm-lg-backup.log' \
      >"${OUT}/server-state.txt" 2>&1 && ok "Состояние сервера: server-state.txt"
  else
    bad "Сервер ${SERVER_IP} недоступен по SSH (подробности в rescue.log)"
  fi
fi

# ───────────────────────── 3. S3: бакеты Object Storage ─────────────────────────
if [ "${SKIP_S3:-0}" != 1 ]; then
  say "3/3 Бакеты Object Storage"
  if ! command -v aws >/dev/null 2>&1; then
    bad "Нет aws CLI. Установите: brew install awscli — и запустите скрипт снова с SKIP_SSH=1 SKIP_YC=1"
  else
    # Ключи берём из локального state OpenTofu (prod и staging).
    keys_for() {  # $1 = prod|staging → печатает "ACCESS SECRET"
      python3 - "$TF/$1/terraform.tfstate" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
for r in s["resources"]:
    if r["type"] == "yandex_iam_service_account_static_access_key":
        a = r["instances"][0]["attributes"]
        print(a["access_key"], a["secret_key"]); break
PY
    }
    sync_bucket() {  # $1 = env, $2 = bucket
      read -r AK SK < <(keys_for "$1") || { bad "Нет ключей $1 в state"; return; }
      mkdir -p "${OUT}/s3/$2"
      if AWS_ACCESS_KEY_ID="$AK" AWS_SECRET_ACCESS_KEY="$SK" \
         aws s3 sync "s3://$2" "${OUT}/s3/$2" --endpoint-url "$S3_ENDPOINT" --region ru-central1 --only-show-errors 2>>"$LOG"; then
        ok "s3://$2 → $(find "${OUT}/s3/$2" -type f | wc -l | tr -d ' ') файлов, $(du -sh "${OUT}/s3/$2" | cut -f1)"
      else
        bad "s3://$2 недоступен (подробности в rescue.log)"
      fi
    }
    sync_bucket prod    crm-lg-prod-files
    sync_bucket staging crm-lg-staging-backups
    sync_bucket staging crm-lg-staging-files
    LATEST="$(find "${OUT}/s3/crm-lg-staging-backups/prod" -name '*.dump.gz' 2>/dev/null | sort | tail -1)"
    [ -n "$LATEST" ] && ok "Самый свежий дамп prod из бэкапов: $(basename "$LATEST")"
  fi
fi

say "Готово. Всё в: $OUT"
echo "  Напишите в чат, что получилось — по rescue.log я пойму, что удалось спасти."
