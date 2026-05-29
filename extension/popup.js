/**
 * popup.js — настройки расширения. Хранит только apiToken в
 * chrome.storage.local. URL бэка захардкожен в background.js, посторонним
 * подменить его нельзя.
 *
 * Кнопка «Проверить» — GET /me/api-tokens с тем же Bearer-токеном:
 * 200 = валиден, 401 = неверный/отозван.
 */
const API_BASE_URL = 'https://crm.lachevsky.ru/api/v1';

const els = {
  apiToken: document.getElementById('apiToken'),
  save: document.getElementById('save'),
  test: document.getElementById('test'),
  status: document.getElementById('status'),
  form: document.getElementById('form'),
};

function setStatus(msg, kind = '') {
  els.status.textContent = msg;
  els.status.className = `status${kind ? ' ' + kind : ''}`;
}

function load() {
  chrome.storage.local.get(['apiToken'], (data) => {
    els.apiToken.value = data.apiToken || '';
  });
}

function save() {
  const apiToken = els.apiToken.value.trim();
  if (!apiToken.startsWith('lg_')) {
    setStatus('Токен должен начинаться с lg_', 'err');
    return false;
  }
  chrome.storage.local.set({ apiToken }, () => {
    setStatus('Сохранено', 'ok');
  });
  return true;
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  save();
});

els.test.addEventListener('click', async () => {
  const apiToken = els.apiToken.value.trim();
  if (!apiToken) {
    setStatus('Сначала введите токен', 'err');
    return;
  }
  els.test.disabled = true;
  setStatus('Проверяем…');
  try {
    const resp = await fetch(`${API_BASE_URL}/me/api-tokens`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (resp.ok) {
      setStatus('Токен валиден ✓', 'ok');
    } else if (resp.status === 401) {
      setStatus('401: токен отозван или неизвестен', 'err');
    } else {
      setStatus(`Ошибка ${resp.status}`, 'err');
    }
  } catch (e) {
    setStatus(`Сеть: ${e?.message || e}`, 'err');
  } finally {
    els.test.disabled = false;
  }
});

load();
