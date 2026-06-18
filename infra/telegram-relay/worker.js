/**
 * Cloudflare Worker — релей Telegram Bot API для prod-сервера в РФ.
 *
 * Зачем: с egress-IP нашей VM (Yandex Cloud) api.telegram.org заблокирован,
 * исходящий sendMessage падает по ConnectTimeout. Cloudflare до Telegram
 * достаёт, поэтому backend ходит не напрямую, а через этот воркер:
 *   TELEGRAM_API_BASE=https://<worker>.workers.dev
 * Наш клиент (app/integrations/telegram.py) строит URL как
 *   {base}/bot{token}/{method}, так что менять код backend не нужно.
 *
 * Безопасность: воркер НЕ открытый прокси. Он пропускает запрос, только если
 * путь начинается с /bot<BOT_TOKEN>/ — то есть обслуживает ровно наш бот.
 * BOT_TOKEN кладётся секретом Wrangler (`wrangler secret put BOT_TOKEN`),
 * в коде и git его нет.
 */

const TELEGRAM_API = "https://api.telegram.org";

export default {
  async fetch(request, env) {
    const token = env.BOT_TOKEN;
    if (!token) {
      return new Response("relay misconfigured: BOT_TOKEN not set", { status: 500 });
    }

    const url = new URL(request.url);

    // Простой self-check без токена: GET / → 200 ok (для проверки, что воркер жив).
    if (url.pathname === "/" || url.pathname === "") {
      return new Response("tg-relay: ok\n", { status: 200 });
    }

    // Пускаем только наш бот. Любой другой путь — 403.
    if (!url.pathname.startsWith(`/bot${token}/`)) {
      return new Response("forbidden", { status: 403 });
    }

    const target = `${TELEGRAM_API}${url.pathname}${url.search}`;
    const init = {
      method: request.method,
      headers: {
        "content-type": request.headers.get("content-type") || "application/json",
      },
      body: ["GET", "HEAD"].includes(request.method)
        ? undefined
        : await request.arrayBuffer(),
    };

    let resp;
    try {
      resp = await fetch(target, init);
    } catch (e) {
      return new Response(`relay upstream error: ${e}`, { status: 502 });
    }

    // Прозрачно возвращаем тело и статус Telegram (включая ok:false с описанием).
    return new Response(resp.body, {
      status: resp.status,
      headers: {
        "content-type": resp.headers.get("content-type") || "application/json",
      },
    });
  },
};
