# DNS-зона CRM-LG в Yandex Cloud

Отдельный Terraform-модуль / отдельный state. Создаёт `yandex_dns_zone` для `lachevsky.ru.` и записи `staging.lachevsky.ru` / `lachevsky.ru` / `www.lachevsky.ru`.

DNS-зона глобальна на оба контура и **не привязана к staging/prod-state'ам** — если когда-то снесём staging через `tofu destroy`, зона уцелеет.

## Запуск (первый раз)

```bash
cd infra/terraform/dns

cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars                   # уже предзаполнен под наш проект, проверь staging_ip

export YC_TOKEN=$(yc iam create-token)     # IAM-токен живёт 12 часов
tofu init
tofu plan  -out=dns.tfplan
tofu apply dns.tfplan
```

Что будет создано:
- `yandex_dns_zone.main` — публичная зона `lachevsky.ru.`
- `yandex_dns_recordset.staging_a` — `staging.lachevsky.ru. A 300 <staging_ip>`
- (опционально) `prod_apex_a`, `prod_www_a` — если в tfvars задан `prod_ip`

## NS для регистратора

После `apply` забрать NS-серверы:

```bash
tofu output ns_records
```

Они всегда одни и те же у YC: `ns1.yandexcloud.net.` и `ns2.yandexcloud.net.`.

В **reg.ru** (кабинет → домен → блок «DNS-серверы и управление зоной» → «Изменить» → «Свой список DNS-серверов»):
- `ns1.yandexcloud.net`
- `ns2.yandexcloud.net`

Сохранить. Распространение — 15–60 минут (TTL текущих NS у reg.ru — 3600 сек). Можно проверить:

```bash
dig +short NS lachevsky.ru @8.8.8.8
# жди появления ns1/ns2.yandexcloud.net вместо ns*.hosting.reg.ru
```

## Когда дойдём до prod

1. После `tofu apply` в основном модуле с prod-workspace — забираем `tofu output public_ip` для prod.
2. Возвращаемся сюда:
   ```bash
   $EDITOR terraform.tfvars     # вписать prod_ip
   export YC_TOKEN=$(yc iam create-token)
   tofu plan  -out=dns.tfplan
   tofu apply dns.tfplan
   ```
3. Это добавит recordset'ы для `lachevsky.ru` и `www.lachevsky.ru`.

## Добавить произвольную запись

В `main.tf` добавляем `yandex_dns_recordset` с `zone_id = yandex_dns_zone.main.id`. Для одноразовых записей (например, верификация владения домена для каких-нибудь Google Search Console) можно сделать через `yc dns zone add-records` руками, не через Terraform — drift не страшен, но фиксировать удобнее в коде.

## Удаление

```bash
tofu destroy
```

Удаляет всё, что было создано этим модулем. Не трогает staging/prod-инфру (она в другом state).

**Важно:** перед destroy убедиться, что NS у регистратора **уже переключены обратно**, иначе домен останется без рабочей зоны.
