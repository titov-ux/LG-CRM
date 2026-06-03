/**
 * WebSocket-клиент realtime-событий.
 *
 * Подключение однократное — синглтон на вкладку, переиспользуется всеми
 * хуками. Реконнект с экспоненциальным backoff (но капом 30с), чтобы при
 * падении бэкенда не долбить его 100 раз в секунду.
 *
 * Сервер шлёт два типа JSON-сообщений:
 *  - `{ type: 'hello' | 'ping' }` — служебные, для UI неинтересны
 *  - доменные события `{ type: 'vacancy.changed' | 'candidate.changed', kind, id, ids, actorId, clientId, ts }`
 *
 * Доменные события публикуются через простой `EventTarget`-подобный listener.
 */

import { WS_URL } from './constants';
import { getClientId } from './clientId';

export type RealtimeEntity = 'vacancy' | 'candidate';

export type RealtimeKind =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'reordered'
  | 'archived'
  | 'restored';

export type ChatRealtimeType =
  | 'chat.message_created'
  | 'chat.message_updated'
  | 'chat.message_deleted'
  | 'chat.conversation_changed'
  | 'chat.read'
  | 'chat.reaction_changed';

export type PresenceRealtimeType = 'user.presence' | 'user.presence_snapshot';

interface RealtimeEventBase {
  actorId: string | null;
  clientId: string;
  ts: string;
  /** true, если событие — эхо от своей же вкладки (clientId совпал). */
  echo: boolean;
}

export interface DomainRealtimeEvent extends RealtimeEventBase {
  type: 'vacancy.changed' | 'candidate.changed';
  entity: RealtimeEntity;
  kind: RealtimeKind;
  id: string | null;
  ids: string[];
}

export interface ChatRealtimeEvent extends RealtimeEventBase {
  type: ChatRealtimeType;
  conversationId: string | null;
  messageId: string | null;
  /** Произвольные payload-поля, прокинутые с бэка (например, preview, kind). */
  payload: Record<string, unknown>;
}

export interface PresenceRealtimeEvent extends RealtimeEventBase {
  type: PresenceRealtimeType;
  userId: string | null;
  online: boolean | null;
  onlineUserIds: string[];
}

export interface CalendarRealtimeEvent extends RealtimeEventBase {
  type: 'calendar.event_changed';
  kind: 'created' | 'updated' | 'canceled' | 'deleted';
  id: string | null;
}

export interface MatchScoredRealtimeEvent extends RealtimeEventBase {
  type: 'match.scored';
  vacancyId: string | null;
  candidateId: string | null;
  matchId: string | null;
}

export type RealtimeEvent =
  | DomainRealtimeEvent
  | ChatRealtimeEvent
  | PresenceRealtimeEvent
  | CalendarRealtimeEvent
  | MatchScoredRealtimeEvent;

type Listener = (e: RealtimeEvent) => void;
type PresenceListener = (onlineUserIds: Set<string>) => void;

const listeners = new Set<Listener>();
const presenceListeners = new Set<PresenceListener>();
let onlineUserIds = new Set<string>();

export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOnlineUserIdsSnapshot(): Set<string> {
  return new Set(onlineUserIds);
}

export function subscribeOnlineUsers(listener: PresenceListener): () => void {
  presenceListeners.add(listener);
  listener(getOnlineUserIdsSnapshot());
  return () => presenceListeners.delete(listener);
}

function emit(event: RealtimeEvent): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch (err) {
      // listener-ы не должны валить друг друга.
      // eslint-disable-next-line no-console
      console.warn('realtime listener threw', err);
    }
  }
}

function emitPresence(): void {
  const snapshot = getOnlineUserIdsSnapshot();
  for (const fn of presenceListeners) {
    try {
      fn(snapshot);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('presence listener threw', err);
    }
  }
}

function setPresenceSnapshot(ids: string[]): void {
  onlineUserIds = new Set(ids);
  emitPresence();
}

function applyPresenceChange(userId: string, online: boolean): void {
  if (!userId) return;
  if (online) onlineUserIds.add(userId);
  else onlineUserIds.delete(userId);
  emitPresence();
}

// --- connection ------------------------------------------------------------

let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let currentTokenFactory: (() => string | null) | null = null;
let started = false;

function backoffMs(): number {
  // 1s → 2s → 4s → 8s → ... → 30s.
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5));
  // Джиттер ±25%, чтобы N клиентов не реконнектились ровно в одну секунду.
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = backoffMs();
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openSocket();
  }, delay);
}

function openSocket(): void {
  if (!WS_URL || !currentTokenFactory) return;
  const token = currentTokenFactory();
  if (!token) {
    // Нет токена → подождём, пока появится; useRealtimeConnection дёрнет start() заново.
    return;
  }
  // Закрываем старое соединение, если ещё живо.
  try {
    socket?.close();
  } catch {
    /* ignore */
  }

  const url = `${WS_URL}?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(getClientId())}`;
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.addEventListener('open', () => {
    reconnectAttempt = 0;
  });

  ws.addEventListener('message', (msg) => {
    let data: unknown;
    try {
      data = JSON.parse(typeof msg.data === 'string' ? msg.data : '');
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;
    const obj = data as Record<string, unknown>;
    const type = obj.type;
    const ownClientId = getClientId();
    const incomingClientId = typeof obj.clientId === 'string' ? obj.clientId : '';
    const base = {
      actorId: typeof obj.actorId === 'string' ? obj.actorId : null,
      clientId: incomingClientId,
      ts: typeof obj.ts === 'string' ? obj.ts : new Date().toISOString(),
      echo: !!ownClientId && incomingClientId === ownClientId,
    };

    if (type === 'hello') {
      const ids = Array.isArray(obj.onlineUserIds)
        ? obj.onlineUserIds.filter((v): v is string => typeof v === 'string')
        : [];
      setPresenceSnapshot(ids);
      emit({
        ...base,
        type: 'user.presence_snapshot',
        userId: null,
        online: null,
        onlineUserIds: ids,
      });
      return;
    }
    if (type === 'ping') return;

    if (type === 'vacancy.changed' || type === 'candidate.changed') {
      emit({
        ...base,
        type,
        entity: type === 'vacancy.changed' ? 'vacancy' : 'candidate',
        kind: (obj.kind as RealtimeKind) ?? 'updated',
        id: typeof obj.id === 'string' ? obj.id : null,
        ids: Array.isArray(obj.ids) ? (obj.ids as string[]) : [],
      });
      return;
    }

    if (type === 'calendar.event_changed') {
      emit({
        ...base,
        type: 'calendar.event_changed',
        kind: (obj.kind as CalendarRealtimeEvent['kind']) ?? 'updated',
        id: typeof obj.id === 'string' ? obj.id : null,
      });
      return;
    }

    if (type === 'match.scored') {
      emit({
        ...base,
        type: 'match.scored',
        vacancyId: typeof obj.vacancyId === 'string' ? obj.vacancyId : null,
        candidateId: typeof obj.candidateId === 'string' ? obj.candidateId : null,
        matchId: typeof obj.matchId === 'string' ? obj.matchId : null,
      });
      return;
    }

    if (typeof type === 'string' && type.startsWith('chat.')) {
      emit({
        ...base,
        type: type as ChatRealtimeType,
        conversationId:
          typeof obj.conversationId === 'string' ? obj.conversationId : null,
        messageId: typeof obj.messageId === 'string' ? obj.messageId : null,
        payload: obj as Record<string, unknown>,
      });
      return;
    }

    if (type === 'user.presence') {
      const userId = typeof obj.userId === 'string' ? obj.userId : null;
      const online =
        typeof obj.online === 'boolean' ? obj.online : null;
      if (userId && online !== null) {
        applyPresenceChange(userId, online);
      }
      emit({
        ...base,
        type: 'user.presence',
        userId,
        online,
        onlineUserIds: [],
      });
      return;
    }
  });

  ws.addEventListener('close', () => {
    if (socket === ws) socket = null;
    if (started) scheduleReconnect();
  });

  ws.addEventListener('error', () => {
    // Сам по себе error не закрывает сокет — но обычно за ним идёт close.
    // Если нет — закроем сами, чтобы не висеть в полуоткрытом состоянии.
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
}

/** Отправить сообщение на сервер, если сокет открыт. Возвращает успех. */
export function sendRealtime(payload: Record<string, unknown>): boolean {
  if (socket && socket.readyState === WebSocket.OPEN) {
    try {
      socket.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

// --- activity tracking (Этап 3 учёта времени) ------------------------------
// «Активное» время = вкладка видима И было взаимодействие. Раз в
// ACTIVITY_PING_MS, если оба условия выполнены, шлём `{type:'activity'}`.
// Сервер сам считает дельты и дедуплицирует вкладки (см. record_activity).

const ACTIVITY_PING_MS = 30_000;
// Считаем «idle», если взаимодействия не было дольше этого порога.
const IDLE_TIMEOUT_MS = 120_000;
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
] as const;

let lastInteraction = 0;
let activityTimer: ReturnType<typeof setInterval> | null = null;
let activityAttached = false;

function markInteraction(): void {
  lastInteraction = Date.now();
}

function activityTick(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastInteraction >= IDLE_TIMEOUT_MS) return;
  sendRealtime({ type: 'activity' });
}

function onVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    markInteraction();
    activityTick();
  }
}

function startActivityTracking(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (activityAttached) return;
  activityAttached = true;
  lastInteraction = Date.now(); // старт канала = считаем активным
  for (const ev of ACTIVITY_EVENTS) {
    window.addEventListener(ev, markInteraction, { passive: true });
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  activityTimer = setInterval(activityTick, ACTIVITY_PING_MS);
}

function stopActivityTracking(): void {
  if (!activityAttached) return;
  activityAttached = false;
  if (typeof window !== 'undefined') {
    for (const ev of ACTIVITY_EVENTS) {
      window.removeEventListener(ev, markInteraction);
    }
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
  if (activityTimer) {
    clearInterval(activityTimer);
    activityTimer = null;
  }
}

/** Запустить realtime-канал. Идемпотентно. */
export function startRealtime(tokenFactory: () => string | null): void {
  currentTokenFactory = tokenFactory;
  if (started) {
    // Если уже стартанули, но сокет закрыт — попробуем открыть сейчас (новый
    // токен мог прилететь после refresh / login).
    if (!socket) openSocket();
    return;
  }
  started = true;
  openSocket();
  startActivityTracking();
}

/** Полностью остановить и закрыть. Дёргается на logout. */
export function stopRealtime(): void {
  started = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempt = 0;
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  socket = null;
  stopActivityTracking();
  setPresenceSnapshot([]);
}
