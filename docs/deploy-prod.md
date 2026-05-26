# Развёртывание prod-контура CRM-LG

Целевая конфигурация:
- Домен: **crm.lachevsky.ru** (DNS управляется через `infra/terraform/dns`).
- VM в Yandex Cloud: 4 vCPU / 8 GB / 100 GB SSD, Ubuntu 22.04.
- Files-бакет: `crm-lg-prod-files`.
- Backups-бакет: **общий со staging — `crm-lg-staging-backups`**, разделение через префикс `prod/daily/` vs `staging/daily/`.
- Ежедневный бэкап Postgres: **01:00 UTC = 04:00 МСК**, retention 30 дней.

Все «грабли», уже пройденные в staging (см. `~/memory/crm-lg-yc-deploy.md`), здесь учтены.

---

## 0. Подготовка локально

```bash
# OpenTofu (Terraform на macOS из РФ не ставится)
brew install opentofu

# YC CLI
yc init
export YC_TOKEN=$(yc iam create-token)   # живёт 12 часов; обновлять перед каждым plan/apply

# зеркало YC для провайдера
cat > ~/.tofurc <<'EOF'
provider_installation {
  network_mirror {
    url = "https://terraform-mirror.yandexcloud.net/"
    include = ["registry.terraform.io/*/*"]
  }
  direct {
    exclude = ["registry.terraform.io/*/*"]
  }
}
EOF
```

`infra/terraform/prod.tfvars` уже заполнен под `crm.lachevsky.ru`, проверь `ssh_public_key`.

---

## 1. Поднять prod-VM (OpenTofu)

```bash
cd infra/terraform
tofu init                                # если ещё не делали
tofu workspace new prod                  # отдельный state для prod
tofu workspace select prod
tofu plan  -var-file=prod.tfvars -out=prod.tfplan
tofu apply prod.tfplan
```

После `apply`:

```bash
tofu output public_ip          # → запоминаем; в DNS пойдёт сюда
tofu output ssh_command        # ssh crm@<ip>
tofu output s3_access_key      # для .env.prod
tofu output s3_secret_key
```

**Заметки:**
- `create_backups_bucket=false` — prod-state НЕ создаёт бакет бэкапов, переиспользует `crm-lg-staging-backups`. Чтобы дампы не смешались — `BACKUP_S3_PREFIX=prod`.
- Files-бакет (`crm-lg-prod-files`) создаётся новый, со своим CORS под `crm.lachevsky.ru`.
- Если cloud-init упирается в фиолетовый `needrestart`-диалог — Tab → Enter на `<Ok>`.

---

## 2. DNS

```bash
cd ../dns
$EDITOR terraform.tfvars                 # вписать prod_ip = <output public_ip>
export YC_TOKEN=$(yc iam create-token)
tofu plan  -out=dns.tfplan
tofu apply dns.tfplan
```

Это добавит `crm.lachevsky.ru. A 300 <prod_ip>`. Распространение — минуты-часы:

```bash
dig +short crm.lachevsky.ru @8.8.8.8
dig +short crm.lachevsky.ru @1.1.1.1
```

---

## 3. На VM: код + .env.prod

```bash
ssh crm@<prod_ip>

# репо
git clone https://github.com/lg-integration/crm-lg.git ~/lg-crm-tmp
sudo mv ~/lg-crm-tmp/* /opt/crm-lg/
sudo mv ~/lg-crm-tmp/.[!.]* /opt/crm-lg/ 2>/dev/null || true
rmdir ~/lg-crm-tmp
sudo chown -R crm:crm /opt/crm-lg
cd /opt/crm-lg

# секреты
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

В `.env.prod` обязательно заполнить (всё остальное уже под prod):

| Поле | Откуда |
| --- | --- |
| `POSTGRES_PASSWORD` | сгенерировать `openssl rand -base64 24` |
| `DATABASE_URL` | тот же пароль, формат `postgresql+asyncpg://crm:<pwd>@postgres:5432/crm_lg` |
| `JWT_SECRET` | `openssl rand -hex 48` |
| `ADMIN_PASSWORD` | длинный, в LastPass |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | из `tofu output -raw s3_access_key/s3_secret_key` |
| `SENTRY_DSN` | (опционально) из Sentry-проекта prod |
| `APP_BASE_URL` | `https://crm.lachevsky.ru` (НЕ голый `lachevsky.ru`, иначе invite-ссылки уйдут в никуда) |
| `SMTP_PASSWORD` | пароль приложения из Яндекс ID для `noreply@lachevsky.group` (тот же, что на staging) |

Без `SMTP_PASSWORD` invite-письма не уйдут — в ответе `POST /users` придёт `inviteUrl`, фронт покажет «Не удалось отправить письмо автоматически». Остальные `SMTP_*` уже под prod в example.

`BACKUP_S3_BUCKET=crm-lg-staging-backups`, `BACKUP_S3_PREFIX=prod` — менять не надо, уже в example.

Подправить nginx-конфиг под prod-домен:

```bash
cp infra/nginx.example.conf infra/nginx.conf
sed -i 's/staging\.lachevsky\.ru/crm.lachevsky.ru/g' infra/nginx.conf
```

---

## 4. TLS

```bash
sudo CERT_DOMAIN=crm.lachevsky.ru CERT_EMAIL=titovalexeys@gmail.com \
    bash infra/scripts/issue-cert.sh
```

Проверь, что симлинки `infra/certs/{fullchain,privkey}.pem → /etc/letsencrypt/live/crm.lachevsky.ru/...` появились.

В `docker-compose.prod.yml` уже смонтированы оба volume (`./certs` и `/etc/letsencrypt`) — без этого nginx падает.

Авторенью:

```bash
bash infra/scripts/setup-cert-renew.sh
```

---

## 5. Bootstrap (стек + бэкап-cron)

```bash
sudo /usr/local/bin/crm-lg-bootstrap.sh
```

Внутри идут: сборка фронта (`pnpm install` + `pnpm build`), `docker compose up -d`, `alembic upgrade head` (запускается уже из `/opt/crm-lg`, поэтому `.env.prod` подхватывается), `make seed`, smoke `/healthz` + `/openapi.json`.

В конце автоматически ставится **cron-бэкап** (см. шаг 6). Чтобы пропустить — `INSTALL_BACKUP_CRON=0 sudo -E /usr/local/bin/crm-lg-bootstrap.sh`.

Если Node на VM ещё нет:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pnpm
```

---

## 6. Ежедневный бэкап БД

`bootstrap.sh` уже зовёт `infra/scripts/install-backup-cron.sh`. Если хочется поставить отдельно:

```bash
sudo bash infra/scripts/install-backup-cron.sh           # просто поставить
sudo bash infra/scripts/install-backup-cron.sh --run-now # поставить и прогнать один бэкап немедленно
```

Что это делает:
- Кладёт `/etc/cron.d/crm-lg-backup` с расписанием `0 1 * * *` (01:00 UTC = 04:00 МСК).
- Создаёт `/var/log/crm-lg-backup.log`.
- `--run-now` ещё и один раз запускает `backend/scripts/backup_db.sh` — чтобы убедиться, что `pg_dump`, ключи S3 и сеть работают.

Проверка:

```bash
# что в S3 что-то появилось
aws s3 ls s3://crm-lg-staging-backups/prod/daily/ \
    --endpoint-url=https://storage.yandexcloud.net \
    --region ru-central1

# cron-файл
ls -la /etc/cron.d/crm-lg-backup
cat   /etc/cron.d/crm-lg-backup

# лог
tail -f /var/log/crm-lg-backup.log
```

**Retention:** автоматическое удаление файлов старше `BACKUP_RETENTION_DAYS=30` (только в `prod/daily/` — staging не трогаем).

**Recovery-drill:** раз в неделю по воскресеньям — `backend/scripts/recovery_drill.sh`. Cron-пример в шапке файла, в этом deploy-гайде не ставится автоматически (на prod хочется делать с явного согласия — он создаёт временную drill-БД на том же postgres-инстансе).

---

## 7. Постдеплой-чеклист

- `curl https://crm.lachevsky.ru/healthz` → `ok`
- `curl https://crm.lachevsky.ru/api/v1/openapi.json | jq .info.title` → `CRM LG API`
- Логин под `ADMIN_EMAIL` через UI работает.
- В Sentry-проекте prod появляются события (фронт + бэк отдельные DSN — см. `docs/sentry-setup.md`).
- В 01:00 UTC следующего дня в `s3://crm-lg-staging-backups/prod/daily/` появился новый `crm-lg-*.dump.gz`.
- `dig crm.lachevsky.ru @8.8.8.8` отдаёт prod-IP отовсюду.

---

## 8. Откат и восстановление

Восстановиться из бэкапа:

```bash
# найти нужный дамп
aws s3 ls s3://crm-lg-staging-backups/prod/daily/ \
    --endpoint-url=https://storage.yandexcloud.net --region ru-central1

# восстановить
cd /opt/crm-lg
set -a && . .env.prod && set +a
bash backend/scripts/restore_db.sh s3://crm-lg-staging-backups/prod/daily/crm-lg-20260601T010000Z.dump.gz
```

Скрипт спрашивает `yes` перед `DROP SCHEMA public CASCADE`. После восстановления — `alembic upgrade head` (на случай, если в коде уже более новые миграции, чем в дампе).
