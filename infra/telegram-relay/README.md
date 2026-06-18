# Telegram-релей на Cloudflare Worker

Зачем: с egress-IP нашего prod (Yandex Cloud, `111.88.246.234`) `api.telegram.org`
заблокирован — исходящий `sendMessage` падает по `ConnectTimeout`, уведомления
не доходят. Cloudflare до Telegram достаёт, поэтому backend ходит через этот
воркер. Бесплатного тарифа Workers (100 000 запросов/сутки) хватает с запасом.

Код backend менять не нужно: клиент строит URL как `{base}/bot{token}/{method}`,
а мы просто подменяем `base` на адрес воркера через `TELEGRAM_API_BASE`.

## Деплой (делается один раз, с любой машины вне РФ или из РФ — Cloudflare доступен)

Нужен Node.js 18+. Все команды — из папки `infra/telegram-relay/`.

```bash
cd infra/telegram-relay

# 1. Залогиниться в Cloudflare (откроется браузер; аккаунт бесплатный, карта не нужна).
npx wrangler login

# 2. Положить bot-токен секретом (тот же, что TELEGRAM_BOT_TOKEN в .env.prod).
#    Вставить значение по запросу — в git/код токен не попадает.
npx wrangler secret put BOT_TOKEN

# 3. Задеплоить воркер.
npx wrangler deploy
```

После `deploy` Wrangler напечатает URL вида:

```
https://crm-lg-tg-relay.<твой-субдомен>.workers.dev
```

Проверка, что воркер жив (должно вернуть `tg-relay: ok`):

```bash
curl https://crm-lg-tg-relay.<твой-субдомен>.workers.dev/
```

## Подключение к backend

На prod-VM в `/opt/crm-lg/.env.prod`:

```bash
TELEGRAM_API_BASE=https://crm-lg-tg-relay.<твой-субдомен>.workers.dev
```

Перезапустить backend (на старте он заодно перерегистрирует вебхук уже через релей):

```bash
cd /opt/crm-lg
dc up -d backend          # алиас из cloud-init; или: docker compose ... up -d backend
```

Проверить доставку — повторить диагностику или дёрнуть любое уведомление
(назначить вакансию / оставить комментарий). В логах вместо `ConnectTimeout`
должно стать тихо, а сообщение — прийти в бот.

```bash
docker logs --since 10m crm-lg-backend 2>&1 | grep -i telegram
```

## Безопасность

Воркер — не открытый прокси: он форвардит запрос, только если путь начинается с
`/bot<BOT_TOKEN>/`, то есть обслуживает исключительно наш бот. Без знания токена
воркер бесполезен (любой другой путь → `403`).

## Обслуживание

- Сменили bot-токен у @BotFather → обновить и секрет воркера
  (`npx wrangler secret put BOT_TOKEN`), и `TELEGRAM_BOT_TOKEN` в `.env.prod`.
- Лимиты Free-плана: 100 000 запросов/сутки, ~1000 rps. Наш поток уведомлений
  на порядки ниже.
- Если когда-нибудь Cloudflare окажется недоступен с VM — альтернатива та же
  по смыслу: SOCKS5-прокси вне РФ через `TELEGRAM_API_PROXY` (см. `.env.prod.example`).
