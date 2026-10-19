#!/usr/bin/env bash
# Серверная часть деплоя (вызывается из infra/timeweb/deploy.sh). Запускается
# файлом, а не через stdin: `docker compose exec` съедает stdin, и всё после него
# молча не выполнялось.
# Нужны переменные DOMAIN и SERVER_IP.
set -euo pipefail
cd /opt/crm-lg
DC="sudo docker compose -f infra/docker-compose.timeweb.yml --env-file .env.prod --profile celery"
say() { printf "\n\033[1;35m[server]\033[0m %s\n" "$*"; }
envget() { grep -E "^$1=" .env.prod | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }

say "сборка фронтенда"
FE_LOG="$(mktemp)"
printf 'VITE_API_BASE_URL=/api/v1\nVITE_USE_MOCKS=false\nVITE_HR_EDO_ENABLED=false\nVITE_APP_TITLE="ЛГ Интеграция"\n' > frontend/.env.production
(cd frontend && pnpm install --frozen-lockfile --reporter=silent && pnpm build) >"$FE_LOG" 2>&1 \
  || { tail -40 "$FE_LOG"; exit 1; }
echo "  ✔ frontend/dist готов"

say "TLS-сертификат"
mkdir -p infra/certs infra/certbot-webroot
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ -L infra/certs/fullchain.pem ] && [ -e infra/certs/fullchain.pem ]; then
  echo "  ✔ Let's Encrypt уже есть"
elif [ "$DNS_IP" = "$SERVER_IP" ]; then
  $DC stop nginx >/dev/null 2>&1 || true
  sudo certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos \
       -m "$(envget ADMIN_EMAIL)" --keep-until-expiring
  ln -sf "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" infra/certs/fullchain.pem
  ln -sf "/etc/letsencrypt/live/$DOMAIN/privkey.pem"   infra/certs/privkey.pem
  echo "  ✔ Let's Encrypt выпущен для $DOMAIN"
else
  if [ ! -f infra/certs/fullchain.pem ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 -subj "/CN=$DOMAIN" \
      -keyout infra/certs/privkey.pem -out infra/certs/fullchain.pem >/dev/null 2>&1
  fi
  echo "  ⚠ DNS $DOMAIN → '${DNS_IP:-нет}', а не $SERVER_IP. Временный самоподписанный сертификат."
  echo "    После переключения DNS просто запустите deploy.sh ещё раз — выпустится настоящий."
fi

say "расширения PostgreSQL"
PG_URL="$(envget DATABASE_URL)"; PG_URL="${PG_URL/postgresql+asyncpg/postgresql}"
for ext in citext pg_trgm uuid-ossp; do
  psql "$PG_URL" -qc "CREATE EXTENSION IF NOT EXISTS \"$ext\";" && echo "  ✔ $ext" \
    || echo "  ⚠ $ext не включилось — включите в панели Timeweb (карточка БД → расширения)"
done

say "сборка и запуск контейнеров"
$DC build --quiet 2>&1 | tail -20
$DC up -d --remove-orphans
# env_file мог измениться — пересоздаём сервисы с кодом/конфигом (redis и stt не трогаем)
$DC up -d --force-recreate --no-deps backend celery-worker celery-beat nginx
for i in $(seq 1 60); do
  curl -fsk -H "Host: $DOMAIN" https://localhost/healthz >/dev/null 2>&1 && break; sleep 3
done
curl -fsk -H "Host: $DOMAIN" https://localhost/healthz >/dev/null || { $DC ps; $DC logs --tail=60 backend; exit 1; }
echo "  ✔ backend отвечает"

say "миграции и начальные данные"
$DC exec -T backend alembic upgrade head
$DC exec -T backend make seed

say "CORS для бакета (загрузка файлов из браузера)"
BUCKET="$(envget S3_BUCKET)"
CORS_JSON="$(mktemp)"
cat > "$CORS_JSON" <<JSON
{"CORSRules":[{"AllowedOrigins":["https://$DOMAIN","https://$SERVER_IP"],
 "AllowedMethods":["GET","PUT","POST","HEAD"],"AllowedHeaders":["*"],
 "ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}
JSON
AWS_ACCESS_KEY_ID="$(envget S3_ACCESS_KEY)" AWS_SECRET_ACCESS_KEY="$(envget S3_SECRET_KEY)" \
  /snap/bin/aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration "file://$CORS_JSON" \
  --endpoint-url "$(envget S3_ENDPOINT)" --region "$(envget S3_REGION)" \
  && echo "  ✔ CORS на $BUCKET" || echo "  ⚠ CORS не применился — файлы из браузера могут не грузиться"

say "ежедневный бэкап БД в S3 (04:00 МСК) + проверочный прогон"
sudo bash infra/scripts/install-backup-cron.sh --run-now 2>&1 | tail -6 || echo "  ⚠ бэкап не прошёл — смотрите вывод выше"

say "проверка интеграций"
$DC exec -T backend python -m scripts.check_integrations || true

say "итог"
$DC ps --format 'table {{.Name}}\t{{.Status}}'
