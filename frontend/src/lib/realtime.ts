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

export type RealtimeEvent = DomainRealtimeEvent | ChatRealtimeEvent;

type Listener = (e: RealtimeEvent) => void;

const listeners = new Set<Listener>();

export function subscribeRealtime(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
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

    if (type === 'hello' || type === 'ping') return;

    const ownClientId = getClientId();
    const incomingClientId = typeof obj.clientId === 'string' ? obj.clientId : '';
    const base = {
      actorId: typeof obj.actorId === 'string' ? obj.actorId : null,
      clientId: incomingClientId,
      ts: typeof obj.ts === 'string' ? obj.ts : new Date().toISOString(),
      echo: !!ownClientId && incomingClientId === ownClientId,
    };

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
}
