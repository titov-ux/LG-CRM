/**
 * Service worker — единственное место, откуда расширение ходит в наш API.
 *
 * URL бэка ЗАХАРДКОЖЕН: расширение публикуется в Chrome Web Store с
 * нейтральным именем, но фактически работает только с одним сервером.
 * Без корректного `lg_…`-токена сервер вернёт 401, поэтому установка
 * расширения посторонним сама по себе ничего им не даёт.
 *
 * Content-script шлёт сюда {type:'lg/importResume', url}, мы делаем POST
 * с Bearer-токеном из chrome.storage.local.
 */
const API_BASE_URL = 'https://crm.lachevsky.ru/api/v1';

async function getToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiToken'], (data) => {
      resolve((data.apiToken || '').trim());
    });
  });
}

async function importResume(url) {
  const apiToken = await getToken();
  if (!apiToken) {
    return {
      ok: false,
      code: 'no_token',
      message:
        'Не задан API-токен. Откройте настройки расширения и вставьте выданный администратором токен.',
    };
  }

  let resp;
  try {
    resp = await fetch(`${API_BASE_URL}/integrations/hh/import-resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({ url }),
    });
  } catch (e) {
    return {
      ok: false,
      code: 'network',
      message: `Сеть недоступна: ${e?.message || e}`,
    };
  }

  let body = null;
  try {
    body = await resp.json();
  } catch {
    /* пустое тело на 5xx */
  }

  if (resp.ok) {
    return { ok: true, candidate: body };
  }
  return {
    ok: false,
    code: body?.code || `http_${resp.status}`,
    message: body?.message || `HTTP ${resp.status}`,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'lg/importResume' && typeof msg.url === 'string') {
    importResume(msg.url).then(sendResponse);
    return true;
  }
  return false;
});
