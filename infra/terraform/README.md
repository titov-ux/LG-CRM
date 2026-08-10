# Terraform для Yandex Cloud

Поднимает staging- и prod-инфраструктуру: сеть + VM с Docker + два S3-бакета + сервисный аккаунт со статическими ключами. Один и тот же код, два контура через **OpenTofu workspaces** и разные `*.tfvars`.

> Мы используем **OpenTofu** (`tofu`) вместо Terraform — это open-source форк, drop-in совместимый. Yandex его официально поддерживает, нет проблем со скачиванием из РФ.

## Что создаётся

- VPC + subnet в выбранной зоне
- Security group: входящий 22/80/443, исходящий — всё
- Compute Instance (Ubuntu 22.04) с cloud-init
- Object Storage:
  - `${files_bucket}` — файлы кандидатов (presigned upload, CORS под `${domain}`)
  - `${backups_bucket}` — pg_dump из `backend/scripts/backup_db.sh`
- Service Account `${vm_name}-s3-sa` с ролью `storage.editor` + static access keys

Размер VM / диска задаётся в `*.tfvars`.

## Подготовка (один раз)

```bash
brew install opentofu                          # см. ../../docs/yandex-cloud-deploy.md
yc init                                        # OAuth + cloud-id/folder-id
cp staging.tfvars.example staging.tfvars       # заполнить
cp prod.tfvars.example    prod.tfvars          # заполнить
$EDITOR staging.tfvars prod.tfvars             # подставить ssh_public_key и проверить bucket-имена
```

`*.tfvars` под `.gitignore`. `*.tfvars.example` — коммитим.

В обоих файлах **`ssh_public_key`** заполняется из `cat ~/.ssh/id_ed25519.pub`. **Имена бакетов** должны отличаться между контурами и быть глобально уникальными в Yandex Object Storage.

## Workspaces

`tofu init` инициализирует providers и создаёт state. Дальше — два workspace'а, каждый со своим state (state хранит `tfstate` отдельно для staging и prod, ресурсы не пересекаются).

```bash
cd infra/terraform

tofu init                                # один раз, общий шаг
tofu workspace new staging               # создаём workspace
tofu workspace new prod                  # второй workspace
tofu workspace list                      # видно оба + default

# Куда мы сейчас "указываем":
tofu workspace show
```

Переключение между контурами — `tofu workspace select staging|prod`. **State у workspaces отдельный, ресурсы не пересекаются.**

## Развернуть staging

```bash
tofu workspace select staging
tofu plan  -var-file=staging.tfvars -out=staging.tfplan
tofu apply staging.tfplan
```

После `apply` забираем outputs:

```bash
tofu output public_ip                          # IP для DNS A-записи
tofu output ssh_command                        # ssh crm@<ip>
tofu output -raw s3_access_key                 # для .env.prod (никуда больше не светить)
tofu output -raw s3_secret_key                 # для .env.prod
tofu output files_bucket                       # для .env.prod (S3_BUCKET)
tofu output backups_bucket                     # для .env.prod (BACKUP_S3_BUCKET)
```

DNS: создать `A`-запись `staging.<domain> → <public_ip>` у своего регистратора, подождать распространения.

Дальше — раздел «Bootstrap VM» ниже.

## Развернуть prod

То же самое, другой workspace:

```bash
tofu workspace select prod
tofu plan  -var-file=prod.tfvars -out=prod.tfplan
tofu apply prod.tfplan
tofu output public_ip
# ...и т.д.
```

DNS: `A`-запись `<domain> → <public_ip>` уже корневая, не staging.

## Bootstrap VM

После `apply` и распространения DNS:

```bash
ssh crm@<public_ip>
sudo /usr/local/bin/crm-lg-bootstrap.sh
```

Скрипт:
1. Клонит репо в `/opt/crm-lg` (по умолчанию `CRM_LG_REPO=https://github.com/lg-integration/crm-lg.git` — переопределяется env-переменной перед запуском).
2. Запускает `scripts/bootstrap.sh`, который:
   - копирует `.env.prod.example → .env.prod` и просит заполнить;
   - проверяет, что TLS-сертификат уже выпущен (`infra/scripts/issue-cert.sh` нужно запустить заранее);
   - собирает фронт, поднимает docker compose, гонит alembic upgrade head + seed.

Порядок на свежей VM: сначала **`issue-cert.sh`** (он использует certbot standalone на :80), потом `crm-lg-bootstrap.sh`. Иначе nginx займёт :80 и certbot не сможет получить challenge.

```bash
# на VM, до bootstrap:
cd /opt/crm-lg                         # если ещё нет — git clone сделает bootstrap
sudo CERT_DOMAIN=staging.crm.lg.ru CERT_EMAIL=ops@lg.ru bash infra/scripts/issue-cert.sh
sudo /usr/local/bin/crm-lg-bootstrap.sh
```

## Удаление контура

```bash
tofu workspace select staging
tofu destroy -var-file=staging.tfvars
```

Перед `destroy` обязательно очистить бакеты — `aws s3 rm s3://crm-lg-staging-files --recursive --endpoint-url=https://storage.yandexcloud.net`, иначе Object Storage не даст их удалить.

## STT-VM (AI-скрининг, Этап 6)

По умолчанию `stt-service` крутится в `docker-compose.prod.yml` на основной VM
(CPU, модель `small`). Если по итогам spike (Этап 0) нужен GPU (T4) или
отдельный CPU-инстанс под 5–8 параллельных встреч — в `*.tfvars`:

```hcl
create_stt_vm   = true
stt_platform_id = "gpu-standard-v3"  # или standard-v3 для CPU
stt_gpus        = 1                  # 0 на CPU
stt_cores       = 8
stt_memory_gb   = 32
```

После `tofu apply`:

```bash
tofu output stt_private_ip
tofu output stt_ssh_command
```

На STT-VM: Docker + (для GPU) NVIDIA Container Toolkit, затем собрать
`services/stt` с `STT_FULL=1`, `STT_DEVICE=cuda`, `STT_COMPUTE_TYPE=int8_float16`,
`STT_MODEL=large-v3-turbo`. В `.env.prod` основной CRM-VM:

```
STT_URL=ws://<stt_private_ip>:8765
```

Порт 8765 открыт только из подсети CRM (security group `stt`).

## Где state

По умолчанию — локально в `terraform.tfstate.d/<workspace>/`. Это нормально для одиночного админа, но рискованно: если потеряешь Mac/перенесёшь репо — потеряешь state. На следующем витке (когда понадобится команда) — переедем на remote backend в S3 (Yandex Object Storage поддерживает s3-протокол для backend'а Terraform).
