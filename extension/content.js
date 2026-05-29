/**
 * Content-script: вставляет на страницу резюме hh.ru плавающую кнопку
 * «Сохранить резюме». По клику шлёт сообщение background-скрипту с текущим URL,
 * тот вызывает наш API. UI-состояния (loading → success/error toast) —
 * все здесь, чтобы не зависеть от popup'а.
 *
 * Запускается на:
 *   https://hh.ru/resume/<id>
 *   https://*.hh.ru/resume/<id>
 *
 * Manifest m3 не даёт нам React, поэтому всё на DOM API. Намеренно минималистично.
 */
(() => {
  const FAB_ID = 'lg-ext-fab';

  /** Простая проверка, что мы на странице резюме (а не списка). */
  function isResumeUrl(href) {
    try {
      const u = new URL(href);
      // URL вида /resume/<hex_id>, не /resumes (список) и не /resume_audit.
      return /\/resume\/[0-9a-f]{10,}/i.test(u.pathname);
    } catch {
      return false;
    }
  }

  function bookSvg() {
    // Простая SVG-иконка — встроена в JS, чтобы не подгружать ассеты.
    return `
      <svg class="lg-ext-fab__icon" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round"
           stroke-linejoin="round" aria-hidden="true">
        <path d="M19 21V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v16l7-3 7 3z"/>
      </svg>
    `;
  }

  function ensureButton() {
    if (document.getElementById(FAB_ID)) return;
    const btn = document.createElement('button');
    btn.id = FAB_ID;
    btn.type = 'button';
    btn.className = 'lg-ext-fab';
    btn.innerHTML = `${bookSvg()}<span>Сохранить резюме</span>`;
    btn.addEventListener('click', onClick);
    document.body.appendChild(btn);
  }

  function setBusy(busy) {
    const btn = document.getElementById(FAB_ID);
    if (!btn) return;
    if (busy) {
      btn.disabled = true;
      btn.innerHTML = `<span class="lg-ext-fab__spinner"></span><span>Сохраняем…</span>`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `${bookSvg()}<span>Сохранить резюме</span>`;
    }
  }

  function showToast({ title, description, variant = 'default', timeout = 4000 }) {
    const el = document.createElement('div');
    el.className = `lg-ext-toast lg-ext-toast--${variant}`;
    el.innerHTML = `
      <div>
        <p class="lg-ext-toast__title"></p>
        ${description ? '<p class="lg-ext-toast__desc"></p>' : ''}
      </div>
    `;
    el.querySelector('.lg-ext-toast__title').textContent = title;
    if (description) {
      el.querySelector('.lg-ext-toast__desc').textContent = description;
    }
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 180ms ease, transform 180ms ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-4px)';
      setTimeout(() => el.remove(), 200);
    }, timeout);
  }

  async function onClick() {
    const url = window.location.href;
    if (!isResumeUrl(url)) {
      showToast({
        title: 'Это не страница резюме',
        description: 'Откройте конкретное резюме на hh.ru и попробуйте снова.',
        variant: 'error',
      });
      return;
    }
    setBusy(true);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'lg/importResume', url });
      if (res && res.ok) {
        showToast({
          title: 'Резюме сохранено',
          description: res.candidate?.fullName
            ? `${res.candidate.fullName} добавлен в базу.`
            : 'Кандидат добавлен в базу.',
          variant: 'success',
        });
      } else {
        const desc = res?.message || res?.code || 'Неизвестная ошибка';
        showToast({
          title: 'Не удалось сохранить',
          description: desc,
          variant: 'error',
          timeout: 6000,
        });
      }
    } catch (e) {
      showToast({
        title: 'Не удалось сохранить',
        description: e?.message || String(e),
        variant: 'error',
        timeout: 6000,
      });
    } finally {
      setBusy(false);
    }
  }

  // hh.ru — SPA, URL меняется без перезагрузки. Слушаем history-события и
  // переоткрытие табов, чтобы кнопка не пропадала при переходе между резюме.
  function syncButton() {
    if (isResumeUrl(window.location.href)) {
      ensureButton();
    } else {
      const btn = document.getElementById(FAB_ID);
      if (btn) btn.remove();
    }
  }

  syncButton();
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    setTimeout(syncButton, 100);
  };
  window.addEventListener('popstate', () => setTimeout(syncButton, 100));
  // Доп. страховка: если hh подгружает резюме через React, дождёмся появления body.
  const obs = new MutationObserver(() => syncButton());
  obs.observe(document.body, { childList: true });
})();
