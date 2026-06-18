#!/usr/bin/env bash
# Диагностика доставки уведомлений в Telegram с prod-VM.
#
# Запускать НА самой VM (там, где крутится backend), под пользователем `crm`:
#   ssh crm@130.193.48.47
#   cd /opt/crm-lg && bash scripts/diag-telegram.sh
#
# Скрипт ничего не меняет — только читает и делает диагностические запросы.
# Главная гипотеза: api.telegram.org режется с egress-IP этого сервера,
# поэтому исходящий sendMessage молча падает по таймауту.

set -uo pipefail

ENV_FILE="${ENV_FILE:-/opt/crm-lg/.env.prod}"
BACKEND="${BACKEND:-crm-lg-backend}"
TG_BASE_DEFAULT="https://api.telegram.org"

line() { printf '\n========== %s ==========\n' "$1"; }
ok()   { printf '  [ OK ] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; }

# --- 0. Загружаем .env.prod (только нужные переменные) ----------------------
line "0. Конфигурация из $ENV_FILE"
if [ ! -r "$ENV_FILE" ]; then
  bad "не могу прочитать $ENV_FILE (запусти на VM под crm)"; exit 1
fi
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
TG_TOKEN="$(get TELEGRAM_BOT_TOKEN)"
TG_PROXY="$(get TELEGRAM_API_PROXY)"
TG_API_BASE="$(get TELEGRAM_API_BASE)"
TG_API_BASE="${TG_API_BASE:-$TG_BASE_DEFAULT}"
if [ -n "$TG_TOKEN" ]; then ok "TELEGRAM_BOT_TOKEN задан (${TG_TOKEN:0:8}…)"; else bad "TELEGRAM_BOT_TOKEN пуст — интеграция выключена"; fi
printf '  TELEGRAM_API_PROXY = %s\n' "${TG_PROXY:-<пусто, идём напрямую>}"
printf '  TELEGRAM_API_BASE  = %s\n' "$TG_API_BASE"

# --- 1. Egress-IP -----------------------------------------------------------
line "1. Внешний (egress) IPv4 этого сервера"
EGRESS="$(curl -4 -s --max-time 10 https://api.ipify.org || true)"
printf '  egress IPv4: %s\n' "${EGRESS:-<не определился>}"

# --- 2. Прямая достижимость api.telegram.org С ХОСТА ------------------------
line "2. Прямой доступ к api.telegram.org с ХОСТА (curl)"
if curl -4 -s --max-time 8 -o /dev/null -w '  HTTP %{http_code}, время %{time_total}s\n' "$TG_BASE_DEFAULT/"; then
  ok "IPv4 до api.telegram.org отвечает"
else
  bad "IPv4 до api.telegram.org НЕдоступен (таймаут/ConnectError) — это и есть блокировка"
fi
printf '  -- IPv6 (ожидаемо может быть unreachable) --\n'
curl -6 -s --max-time 8 -o /dev/null -w '  HTTP %{http_code}, время %{time_total}s\n' "$TG_BASE_DEFAULT/" \
  || bad "IPv6 до api.telegram.org недоступен"

# --- 3. Достижимость ИЗ backend-контейнера (тем же httpx, что в проде) ------
line "3. Доступ к Telegram ИЗ контейнера $BACKEND (httpx, как в приложении)"
if docker ps --format '{{.Names}}' | grep -qx "$BACKEND"; then
  docker exec -e TG_TOKEN="$TG_TOKEN" -e TG_PROXY="$TG_PROXY" -e TG_BASE="$TG_API_BASE" "$BACKEND" \
    python - <<'PY'
import os, asyncio, httpx
base  = os.environ.get("TG_BASE") or "https://api.telegram.org"
proxy = os.environ.get("TG_PROXY") or None
token = os.environ.get("TG_TOKEN") or ""

async def hit(name, url):
    try:
        async with httpx.AsyncClient(timeout=8, proxy=proxy) as c:
            r = await c.get(url)
        d = {}
        try: d = r.json()
        except Exception: pass
        extra = ""
        if isinstance(d, dict):
            res = d.get("result")
            if name == "getMe" and isinstance(res, dict):
                extra = f" username=@{res.get('username')}"
            if name == "getWebhookInfo" and isinstance(res, dict):
                extra = (f" url={res.get('url')!r} pending={res.get('pending_update_count')} "
                         f"last_error={res.get('last_error_message')!r}")
        print(f"  [ OK ] {name}: HTTP {r.status_code} ok={d.get('ok')}{extra}")
    except Exception as e:
        print(f"  [FAIL] {name}: {e!r}")

async def main():
    print(f"  base={base} proxy={proxy or '<нет>'}")
    if not token:
        print("  токена нет — пропускаю getMe/getWebhookInfo"); return
    await hit("getMe", f"{base}/bot{token}/getMe")
    await hit("getWebhookInfo", f"{base}/bot{token}/getWebhookInfo")

asyncio.run(main())
PY
else
  bad "контейнер $BACKEND не запущен (docker ps его не видит)"
fi

# --- 4. Свежие ошибки доставки в логах backend ------------------------------
line "4. Ошибки Telegram в логах backend (последние)"
docker logs --since 72h "$BACKEND" 2>&1 | grep -iE 'telegram' | tail -20 \
  || echo "  (упоминаний Telegram в логах за 72ч не найдено)"

line "ИТОГ"
cat <<'EOF'
  Читать так:
   * Шаг 2/3 FAIL по IPv4  → api.telegram.org режется с этого сервера.
     Лечится ТОЛЬКО релеем вне РФ: TELEGRAM_API_PROXY=socks5://...
     или TELEGRAM_API_BASE=https://<cloudflare-worker>.workers.dev
   * Шаг 3 getWebhookInfo показал url=... и pending>0 → апдейты копятся,
     вебхук жив, проблема именно в ИСХОДЯЩЕЙ доставке.
   * Если шаг 3 OK при заданном PROXY/BASE — релей уже работает,
     ищем причину в другом (токен/таблица users.telegram_chat_id/тумблер).
EOF
