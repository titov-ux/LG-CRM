/**
 * Звуки уведомлений чата — без аудиофайлов, через Web Audio API.
 *
 * Slack-подобные ощущения: короткий мягкий «pop» на новое сообщение и
 * двух-нотный «chime» на @-упоминание. Создавать AudioContext до первого
 * клика юзера нельзя (браузер заблокирует autoplay), поэтому контекст
 * инициализируется лениво.
 *
 * Глобальный enabled-флаг хранится в localStorage и переключается из шапки
 * сайдбара чата (см. `useChatSoundsEnabled`).
 */
import { useEffect, useState } from 'react';

const LS_KEY = 'chat.sounds.enabled';
const THROTTLE_MS = 800;

let ctx: AudioContext | null = null;
let lastPlayedAt = 0;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Klass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Klass) return null;
  try {
    ctx = new Klass();
  } catch {
    return null;
  }
  return ctx;
}

interface Note {
  /** Частота, Гц. */
  freq: number;
  /** Когда нота стартует относительно начала, сек. */
  startAt: number;
  /** Длительность, сек. */
  duration: number;
  /** Пиковая громкость 0..1. */
  gain: number;
}

function playSequence(notes: Note[]): void {
  if (!isEnabled()) return;
  const now = Date.now();
  if (now - lastPlayedAt < THROTTLE_MS) return;
  const audio = getCtx();
  if (!audio) return;
  // Если контекст заснул (Safari/Chrome автосаспенд) — попробуем разбудить.
  if (audio.state === 'suspended') {
    void audio.resume().catch(() => {});
  }
  lastPlayedAt = now;
  const t0 = audio.currentTime;
  for (const n of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = n.freq;
    osc.connect(gain).connect(audio.destination);
    // ADSR-«огибающая»: быстрый attack + экспоненциальный decay,
    // чтобы звук был мягким, без щелчков.
    const start = t0 + n.startAt;
    const end = start + n.duration;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(n.gain, start + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

/** «Knock-brush»: одна короткая нота 520 → 380 Гц, ~120 мс. */
export function playMessageSound(): void {
  playSequence([
    { freq: 520, startAt: 0, duration: 0.12, gain: 0.18 },
  ]);
}

/** «Hi-five»: две ноты, 660 → 880 Гц, общая длительность ~250 мс. */
export function playMentionSound(): void {
  playSequence([
    { freq: 660, startAt: 0, duration: 0.12, gain: 0.22 },
    { freq: 880, startAt: 0.1, duration: 0.16, gain: 0.22 },
  ]);
}

// === enabled flag ==========================================================

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  // По умолчанию ВКЛ — пользователь сам решит выключить.
  const raw = window.localStorage.getItem(LS_KEY);
  return raw === null ? true : raw === '1';
}

function setEnabled(value: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LS_KEY, value ? '1' : '0');
  // Хук слушает событие 'storage' автоматически, но он стреляет только в
  // других вкладках. Для текущей — наш собственный CustomEvent.
  window.dispatchEvent(new CustomEvent('chat:sounds-changed'));
}

/**
 * React-хук для чтения/переключения флага. Перерисовывает компонент при
 * изменении (через storage + chat:sounds-changed).
 */
export function useChatSoundsEnabled(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(isEnabled());
  useEffect(() => {
    const sync = () => setValue(isEnabled());
    window.addEventListener('storage', sync);
    window.addEventListener('chat:sounds-changed', sync as EventListener);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('chat:sounds-changed', sync as EventListener);
    };
  }, []);
  return [value, (next: boolean) => setEnabled(next)];
}
