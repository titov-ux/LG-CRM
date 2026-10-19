#!/usr/bin/env bash
set -euo pipefail
cd /opt/crm-lg; chmod 600 .env.prod
DC="sudo docker compose -f infra/docker-compose.timeweb.yml --env-file .env.prod --profile celery"
echo "== ADMIN_EMAIL в конфиге сервера: $(grep -E '^ADMIN_EMAIL=' .env.prod | cut -d= -f2)"
echo "== пересоздаю backend с новым конфигом"
$DC up -d --force-recreate backend 2>&1 | tail -5
for i in $(seq 1 30); do $DC exec -T backend curl -fs localhost:8000/healthz >/dev/null 2>&1 && break; sleep 2; done
echo "== ADMIN_EMAIL внутри контейнера: $($DC exec -T backend printenv ADMIN_EMAIL)"
echo "== seed"
$DC exec -T backend python -m scripts.seed_admin
echo "== снимаю блокировку входа после неудачных попыток"
$DC exec -T redis sh -c 'redis-cli --scan --pattern "*login*" | xargs -r redis-cli del' || true
echo "== пользователи в базе"
URL="$(grep -E '^DATABASE_URL=' .env.prod | cut -d= -f2- | sed 's/+asyncpg//')"
psql "$URL" -c "select email, role, is_active, created_at::date from users order by created_at;"
