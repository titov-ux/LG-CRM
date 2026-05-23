# TLS-сертификат для CRM-LG

Два варианта: Let's Encrypt через certbot (по умолчанию) или Yandex Certificate Manager.

## Вариант A — Let's Encrypt (рекомендованный)

Бесплатно, авто-обновление, никаких ручных действий после первого выпуска.

### Первый выпуск

1. Убедитесь, что **DNS A-запись** домена → ваш IP уже распространилась (`dig +short staging.crm.lg.ru` должен вернуть тот же IP, что Terraform).
2. На VM запустите выпуск:

   ```bash
   sudo CERT_DOMAIN=staging.crm.lg.ru CERT_EMAIL=ops@lg.ru \
       bash /opt/crm-lg/infra/scripts/issue-cert.sh
   ```

   Скрипт сам поднимет временный listener на `:80` для ACME-challenge — если nginx уже запущен, остановите его (`docker compose ... stop nginx`).

3. Поставьте автообновление:

   ```bash
   bash /opt/crm-lg/infra/scripts/setup-cert-renew.sh
   ```

   Это создаёт `/etc/cron.d/crm-lg-cert-renew` — каждый день в 04:30 UTC certbot проверяет срок и обновляет, если осталось <30 дней. После обновления автоматически перечитывает nginx (`nginx -s reload`).

### Что если cert уже есть

`issue-cert.sh` — идемпотентен. Если домен тот же, certbot вернёт существующий сертификат без выпуска нового (rate-limit Let's Encrypt: 5 идентичных сертификатов в неделю — не злоупотребляйте).

### Проверка

```bash
curl -sSI https://staging.crm.lg.ru/healthz | head -5
openssl s_client -connect staging.crm.lg.ru:443 -servername staging.crm.lg.ru </dev/null \
    | openssl x509 -noout -dates
```

`notAfter` должен быть в будущем; через ~60 дней cron сделает renew автоматически.

---

## Вариант B — Yandex Certificate Manager

Подходит, если предпочитаете не возиться с cron'ом и держать сертификат в облаке.

### Один раз

```bash
# Выпуск через CM с DNS-валидацией (для Let's Encrypt-сертификата).
yc certificate-manager certificate request \
    --name crm-lg-staging \
    --domains staging.crm.lg.ru \
    --challenge-type DNS

# yc распечатает CNAME-запись, которую надо добавить в DNS-зону домена.
# После добавления — дождаться выдачи (статус ISSUED), может занять несколько минут:
yc certificate-manager certificate get crm-lg-staging --full
```

### Скачивание для nginx

```bash
yc certificate-manager certificate content crm-lg-staging --format pem > /tmp/cert.zip
unzip -d infra/certs/ /tmp/cert.zip
# Yandex отдаёт chain.pem + privkey.pem — переименуйте/симлинкните под наши имена:
mv infra/certs/chain.pem    infra/certs/fullchain.pem
# privkey.pem остаётся как есть.

docker compose -f infra/docker-compose.prod.yml --env-file .env.prod restart nginx
```

### Обновление

CM сам перевыпускает за 30 дней до истечения и публикует новую версию. Скачивание новой версии нужно автоматизировать (cron-скрипт, аналогичный `renew-cert.sh`, но с `yc certificate-manager content`).

---

## Какой вариант выбрать

- Маленький проект, один домен — **Вариант A**, проще.
- Несколько доменов / wildcard / интеграция с Application Load Balancer — **Вариант B**.

Для CRM-LG достаточно варианта A.
