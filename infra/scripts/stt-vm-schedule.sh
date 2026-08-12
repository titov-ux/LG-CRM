#!/usr/bin/env bash
# Включение/выключение отдельной STT-VM (GPU или большой CPU) по расписанию.
#
# Зачем. По плану Этапа 6 GPU-VM под stt-service держат только в рабочие часы:
# остановленный инстанс в Yandex Cloud не тарифицируется за vCPU/RAM/GPU
# (диск оплачивается всегда), а скрининги идут только днём. Ручное
# «не забыть выключить вечером» не работает — отсюда скрипт + cron.
#
# Инстанс создаётся OpenTofu/Terraform: infra/terraform/stt.tf,
# `create_stt_vm = true`. Имя там — `local.stt_vm_name`, то есть
# var.stt_vm_name, а если он пуст — "${var.vm_name}-stt". Скрипт НИЧЕГО не
# создаёт и не удаляет: только start/stop уже существующей VM.
#
# Требуется: yc CLI (https://yandex.cloud/docs/cli/), авторизованный профиль
# (`yc init`) с правом compute.operator на каталог.
#
# Переменные окружения (можно положить в /etc/default/crm-lg-stt-vm):
#   STT_VM_NAME   — имя инстанса, напр. crm-lg-prod-stt  (или STT_VM_ID)
#   STT_VM_ID     — ID инстанса; приоритетнее имени, не зависит от переименований
#   YC_FOLDER_ID  — каталог, если не хотим полагаться на дефолт профиля
#   YC_PROFILE    — профиль yc CLI (актуально для cron от root)
#
# Использование:
#   infra/scripts/stt-vm-schedule.sh start|stop|status
#
# CRON (рабочие часы 09:00–20:00 МСК = UTC+3 → 06:00–17:00 UTC, пн–пт).
# ВАЖНО: crond считает время в TZ хоста. На YC-VM это обычно UTC, поэтому
# ниже времена в UTC; если на хосте выставлена Europe/Moscow — либо укажите
# CRON_TZ=UTC, либо пишите 09/20 вместо 06/17. Проверить: `date` и `timedatectl`.
#
#   # /etc/cron.d/crm-lg-stt-vm
#   CRON_TZ=UTC
#   SHELL=/bin/bash
#   YC_PROFILE=default
#   STT_VM_NAME=crm-lg-prod-stt
#   0 6 * * 1-5 root /opt/crm-lg/infra/scripts/stt-vm-schedule.sh start >> /var/log/crm-lg-stt-vm.log 2>&1
#   0 17 * * 1-5 root /opt/crm-lg/infra/scripts/stt-vm-schedule.sh stop  >> /var/log/crm-lg-stt-vm.log 2>&1
#
# ВНИМАНИЕ (обе стороны расписания):
#  * пока VM выключена, backend не может подключиться к STT: комната скрининга
#    работает, идёт запись в S3, но живого транскрипта нет (sttReady=false,
#    в метриках — screening_stt_errors_total). Вечерние/выходные встречи
#    придётся включать вручную (`... start`) либо расширить окно в cron;
#  * стоп не спрашивает, идёт ли встреча прямо сейчас. Перед плановым stop
#    убедитесь, что активных сессий нет (см. status: активные сессии видны в
#    /healthz stt-service и в screening_active_sessions на бэкенде);
#  * после start внутренний IP сохраняется, а публичный (ephemeral NAT) может
#    смениться. STT_URL в .env.prod должен указывать на ВНУТРЕННИЙ адрес
#    (ws://<stt_private_ip>:8765) — тогда правки не нужны; `status` печатает оба.
set -euo pipefail

usage() {
    cat >&2 <<'USAGE'
Использование: stt-vm-schedule.sh start|stop|status

Инстанс задаётся переменными окружения STT_VM_ID или STT_VM_NAME
(см. комментарий в начале файла и infra/terraform/stt.tf).
USAGE
    exit 2
}

ACTION="${1:-}"
[ -n "$ACTION" ] || usage

if ! command -v yc >/dev/null 2>&1; then
    echo "ОШИБКА: yc CLI не найден в PATH (нужен для start/stop инстанса)." >&2
    exit 1
fi

VM_ID="${STT_VM_ID:-}"
VM_NAME="${STT_VM_NAME:-}"
if [ -z "$VM_ID" ] && [ -z "$VM_NAME" ]; then
    echo "ОШИБКА: задайте STT_VM_ID или STT_VM_NAME (имя из infra/terraform/stt.tf)." >&2
    exit 1
fi

# Собираем общие аргументы: ID приоритетнее имени (переименование VM не ломает cron).
YC_ARGS=()
if [ -n "$VM_ID" ]; then
    YC_ARGS+=(--id "$VM_ID")
    TARGET="$VM_ID"
else
    YC_ARGS+=(--name "$VM_NAME")
    TARGET="$VM_NAME"
fi
if [ -n "${YC_FOLDER_ID:-}" ]; then
    YC_ARGS+=(--folder-id "$YC_FOLDER_ID")
fi
if [ -n "${YC_PROFILE:-}" ]; then
    # Глобальный флаг профиля: под cron домашний ~/.config/yandex-cloud может
    # отличаться от того, где вы делали `yc init`.
    YC_ARGS+=(--profile "$YC_PROFILE")
fi

log() {
    # Метка времени в UTC — чтобы лог cron сходился с расписанием.
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

# Текущее состояние: PROVISIONING|RUNNING|STOPPING|STOPPED|... либо пусто,
# если инстанса нет / нет прав.
vm_status() {
    yc compute instance get "${YC_ARGS[@]}" --format json 2>/dev/null |
        grep -o '"status": *"[A-Z_]*"' | head -n1 | sed 's/.*"\([A-Z_]*\)"$/\1/'
}

STATUS="$(vm_status || true)"
if [ -z "$STATUS" ]; then
    echo "ОШИБКА: инстанс '$TARGET' не найден (или нет прав / не тот каталог)." >&2
    echo "Проверьте: yc compute instance list" >&2
    exit 1
fi

case "$ACTION" in
    start)
        if [ "$STATUS" = "RUNNING" ]; then
            log "STT-VM '$TARGET' уже RUNNING — ничего не делаем."
            exit 0
        fi
        log "Запускаю STT-VM '$TARGET' (было: $STATUS)…"
        yc compute instance start "${YC_ARGS[@]}"
        log "Готово. Состояние: $(vm_status)."
        # Docker-сервис поднимается сам (restart: unless-stopped), но модель
        # faster-whisper прогревается не мгновенно — первые минуты после старта
        # латентность STT выше обычной.
        log "Проверьте: curl -fsS http://<stt_private_ip>:8765/healthz"
        ;;
    stop)
        if [ "$STATUS" = "STOPPED" ]; then
            log "STT-VM '$TARGET' уже STOPPED — ничего не делаем."
            exit 0
        fi
        log "Останавливаю STT-VM '$TARGET' (было: $STATUS)…"
        yc compute instance stop "${YC_ARGS[@]}"
        log "Готово. Состояние: $(vm_status)."
        ;;
    status)
        log "STT-VM '$TARGET': $STATUS"
        # Оба адреса: внутренний нужен для STT_URL, публичный — для SSH.
        yc compute instance get "${YC_ARGS[@]}" \
            --format json |
            grep -E '"(ip_address|nat_ip_address)"' || true
        ;;
    *)
        usage
        ;;
esac
