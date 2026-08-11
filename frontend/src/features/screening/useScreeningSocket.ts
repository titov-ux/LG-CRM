/**
 * Единственный WS-клиент комнаты скрининга: /api/v1/ws/screening/{id}?token=…
 *
 * Отправляет PCM-фреймы (1 байт канала + PCM16LE 16 кГц) и принимает события
 * транскрипта, обновления чек-листа вопросов (`questions.updated`) и подсказки
 * AI-агента (`hint`). Reconnect с экспоненциальным backoff, пока сокет нужен.
 *
 * Особенности:
 *  - дедуп финальных сегментов по `seq` (при reconnect сервер может прислать
 *    уже виденное — бэк нумерует сквозным счётчиком);
 *  - `hello.lastSeq` после реконнекта: если сервер ушёл вперёд, дозагружаем
 *    пропущенное через REST `GET /screenings/{id}/transcript` ({items,lastSeq})
 *    и сливаем по seq;
 *  - PCM-буфер (~2 с) пока WS не OPEN: иначе на reconnect теряется интервал
 *    аудио («дозагрузка недостающего» с клиента);
 *  - graceful-завершение: `stop()` шлёт `{type:"stop"}` перед закрытием — иначе
 *    бэкенд теряет последние сегменты. В cleanup эффекта `stop` НЕ шлём: в dev
 *    StrictMode это рвало бы STT-мост на первом же mount/unmount;
 *  - «погашенный» сокет (лимит длительности, 1008) не переподключается; флаг
 *    снимается при смене sessionId и при повторном включении (`enabled`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth';
import {
  screeningsApi,
  type ScreeningQuestion,
  type ScreeningSession,
  type ScreeningSpeaker,
} from '@/api/screenings';
import { screeningKeys } from './hooks';
import type { PcmChannel } from './audioCapture';

export interface LiveSegment {
  seq: number;
  speaker: ScreeningSpeaker;
  text: string;
  startedMs: number;
  endedMs: number;
}

/** Подсказка AI-агента рекрутеру: показываем последние несколько. */
export interface LiveHint {
  id: number;
  text: string;
  at: number;
}

export type SttStatus = 'connecting' | 'ok' | 'unavailable';

const MAX_HINTS = 5;
/** Сервер закрывает WS этим кодом, если пользователь не ведёт эту сессию. */
const WS_POLICY_VIOLATION = 1008;
/** Пауза перед close() — чтобы сервер успел прочитать `stop`. */
const STOP_GRACE_MS = 400;
/**
 * Сколько PCM-фреймов держать, пока сокет reconnect'ится.
 * Worklet шлёт ~50 мс чанки × 2 канала → ~80 ≈ 2 с аудио; старше не тащим.
 */
const PCM_BUFFER_MAX = 80;

function wsUrl(sessionId: string, token: string): string {
  const path = `${API_BASE_URL}/ws/screening/${sessionId}?token=${encodeURIComponent(token)}`;
  if (/^https?:\/\//i.test(API_BASE_URL)) return path.replace(/^http/, 'ws');
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${path}`;
}

/** Нормализация вопросов из `questions.updated` (бэк шлёт camelCase DTO). */
function parseQuestions(raw: unknown): ScreeningQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ScreeningQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    if (typeof q.id !== 'string' || typeof q.text !== 'string') continue;
    out.push({
      id: q.id,
      position: Number(q.position ?? 0),
      text: q.text,
      goal: (q.goal as string | null | undefined) ?? null,
      source: (q.source as ScreeningQuestion['source']) ?? 'followup',
      status: (q.status as ScreeningQuestion['status']) ?? 'pending',
      answerSummary: (q.answerSummary as string | null | undefined) ?? null,
    });
  }
  return out.sort((a, b) => a.position - b.position);
}

function mergeSegments(prev: LiveSegment[], incoming: LiveSegment[]): LiveSegment[] {
  if (incoming.length === 0) return prev;
  const bySeq = new Map<number, LiveSegment>();
  for (const s of prev) bySeq.set(s.seq, s);
  for (const s of incoming) bySeq.set(s.seq, s);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function useScreeningSocket(sessionId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [sttStatus, setSttStatus] = useState<SttStatus>('connecting');
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [partials, setPartials] = useState<Partial<Record<ScreeningSpeaker, string>>>({});
  const [hints, setHints] = useState<LiveHint[]>([]);
  /** Метка последнего `questions.updated` — для мягкой подсветки чек-листа. */
  const [questionsUpdatedAt, setQuestionsUpdatedAt] = useState<number | null>(null);
  /** Этап 6: сервер закрыл сессию по SCREENING_MAX_DURATION_MIN. */
  const [maxDurationHit, setMaxDurationHit] = useState(false);
  /** Причина, по которой live-транскрипт неполный (403 на дозагрузке и т.п.). */
  const [transcriptNotice, setTranscriptNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const hintIdRef = useRef(0);
  const segmentsRef = useRef<LiveSegment[]>([]);
  segmentsRef.current = segments;
  /**
   * Сокет погашен намеренно (лимит длительности / ручное завершение / 1008) —
   * реконнект запрещён. Снимается при смене сессии и при повторном включении:
   * иначе неудачная попытка завершить встречу гасила стрим навсегда.
   */
  const killedRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  /** Докуда уже дозагружали транскрипт по REST — чтобы не дёргать его зря. */
  const backfilledSeqRef = useRef(0);
  /** 403 на `GET /transcript` — повторять бессмысленно, сообщаем один раз. */
  const backfillDeniedRef = useRef(false);
  /**
   * PCM, накопленный пока WS не OPEN (reconnect / краткий обрыв).
   * Без буфера «дыра» в транскрипте на время реконнекта.
   */
  const pcmBufferRef = useRef<Uint8Array[]>([]);

  // Смена сессии — полный сброс живого состояния и «погашенности».
  useEffect(() => {
    killedRef.current = false;
    retryRef.current = 0;
    backfilledSeqRef.current = 0;
    backfillDeniedRef.current = false;
    pcmBufferRef.current = [];
    setSegments([]);
    setPartials({});
    setHints([]);
    setQuestionsUpdatedAt(null);
    setSttStatus('connecting');
    setMaxDurationHit(false);
    setTranscriptNotice(null);
  }, [sessionId]);

  // Сокет снова понадобился (например, «Завершить» упало и сессия осталась
  // live) — снимаем «погашенность», иначе PCM молча уходили бы в никуда.
  useEffect(() => {
    if (!enabled) return;
    killedRef.current = false;
    retryRef.current = 0;
  }, [enabled]);

  /** Дозагрузка пропущенных сегментов после реконнекта (hello.lastSeq). */
  const backfill = useCallback(
    async (lastSeq: number) => {
      if (backfillDeniedRef.current) return;
      const localMax = segmentsRef.current.reduce((m, s) => Math.max(m, s.seq), 0);
      if (lastSeq <= Math.max(localMax, backfilledSeqRef.current)) return;
      try {
        const { items, lastSeq: storedSeq } = await screeningsApi.transcript(sessionId);
        setSegments((prev) =>
          mergeSegments(
            prev,
            items.map((s) => ({
              seq: s.seq,
              speaker: s.speaker,
              text: s.text,
              startedMs: s.startedMs,
              endedMs: s.endedMs,
            })),
          ),
        );
        // `lastSeq` из БД может отставать от обещанного в hello (сегмент ещё
        // пишется) — запоминаем достигнутый курсор, остальное дойдёт по WS.
        backfilledSeqRef.current = Math.max(backfilledSeqRef.current, storedSeq);
      } catch (e) {
        const status = (e as { response?: { status?: number } } | null)?.response?.status;
        if (status === 403) {
          // Нет права `screening:view_report` — REST-дозагрузка недоступна,
          // ретраить нечего: показываем только реплики этого подключения.
          backfillDeniedRef.current = true;
          setTranscriptNotice(
            'Нет прав на просмотр сохранённого транскрипта — показываем только реплики с момента подключения.',
          );
        }
        /* сеть моргнула — попробуем на следующем reconnect */
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;

    const connect = () => {
      if (disposed || !enabledRef.current || killedRef.current) return;
      const token = useAuthStore.getState().accessToken;
      if (!token) {
        // Токен ещё не подъехал (refresh в полёте) — пробуем позже, иначе
        // сокет не поднимется до перезагрузки страницы.
        scheduleReconnect();
        return;
      }
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(sessionId, token));
      } catch {
        scheduleReconnect();
        return;
      }
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
        try {
          ws.send(JSON.stringify({ type: 'start', sampleRate: 16000 }));
        } catch {
          /* ignore */
        }
        // Дозаливаем кадры, накопленные за обрыв — иначе STT теряет интервал.
        const pending = pcmBufferRef.current;
        pcmBufferRef.current = [];
        for (const frame of pending) {
          if (ws.readyState !== WebSocket.OPEN) {
            // Соединение снова упало mid-flush — остаток обратно в буфер.
            pcmBufferRef.current.push(frame);
            continue;
          }
          try {
            ws.send(frame);
          } catch {
            pcmBufferRef.current.push(frame);
            break;
          }
        }
        if (pcmBufferRef.current.length > PCM_BUFFER_MAX) {
          pcmBufferRef.current.splice(
            0,
            pcmBufferRef.current.length - PCM_BUFFER_MAX,
          );
        }
      };
      ws.onerror = () => {
        // onclose придёт следом и запустит reconnect — здесь только закрываем.
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      };
      ws.onclose = (ev) => {
        setConnected(false);
        // Недоговорённая фраза после обрыва протухла — иначе висит вечно.
        setPartials({});
        if (wsRef.current === ws) wsRef.current = null;
        if (ev.code === WS_POLICY_VIOLATION) {
          // Нет прав вести эту сессию либо она уже не live — реконнект
          // бессмыслен, перечитываем карточку, чтобы UI обновил статус.
          killedRef.current = true;
          setSttStatus('unavailable');
          void queryClient.invalidateQueries({ queryKey: screeningKeys.byId(sessionId) });
          return;
        }
        if (disposed || !enabledRef.current || killedRef.current) return;
        scheduleReconnect();
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case 'hello': {
            setSttStatus(msg.sttReady ? 'ok' : 'unavailable');
            void backfill(Number(msg.lastSeq ?? 0));
            break;
          }
          case 'session.state': {
            // Сервер шлёт sttReady и при падении, и при подъёме моста —
            // разбираем оба направления, иначе баннер висит после починки.
            if (typeof msg.sttReady === 'boolean') {
              setSttStatus(msg.sttReady ? 'ok' : 'unavailable');
            }
            if (msg.error === 'max_duration') {
              setMaxDurationHit(true);
              killedRef.current = true;
              ws.close();
            }
            break;
          }
          case 'transcript.partial': {
            const speaker = msg.speaker as ScreeningSpeaker;
            setPartials((p) => ({ ...p, [speaker]: String(msg.text ?? '') }));
            break;
          }
          case 'transcript.final': {
            const seg: LiveSegment = {
              seq: Number(msg.seq ?? 0),
              speaker: msg.speaker as ScreeningSpeaker,
              text: String(msg.text ?? ''),
              startedMs: Number(msg.startedMs ?? 0),
              endedMs: Number(msg.endedMs ?? 0),
            };
            setSegments((prev) =>
              prev.some((s) => s.seq === seg.seq)
                ? prev
                : [...prev, seg].sort((a, b) => a.seq - b.seq),
            );
            setPartials((p) => ({ ...p, [seg.speaker]: undefined }));
            break;
          }
          case 'questions.updated': {
            const questions = parseQuestions(msg.questions);
            if (questions.length === 0) break;
            queryClient.setQueryData<ScreeningSession>(
              screeningKeys.byId(sessionId),
              (prev) => (prev ? { ...prev, questions } : prev),
            );
            setQuestionsUpdatedAt(Date.now());
            break;
          }
          case 'hint': {
            const text = String(msg.text ?? '').trim();
            if (!text) break;
            hintIdRef.current += 1;
            const hint: LiveHint = { id: hintIdRef.current, text, at: Date.now() };
            setHints((prev) => [...prev, hint].slice(-MAX_HINTS));
            break;
          }
          default:
            break; // ping и прочее
        }
      };
    };

    const scheduleReconnect = () => {
      if (timerRef.current !== null) return;
      const delay =
        Math.min(30_000, 1000 * 2 ** retryRef.current) * (0.75 + Math.random() * 0.5);
      retryRef.current += 1;
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        connect();
      }, delay);
    };

    connect();
    return () => {
      disposed = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      // `{type:"stop"}` здесь НЕ шлём: cleanup срабатывает и на размонтировании
      // (в dev StrictMode — сразу после mount), а stop рвёт STT-мост на бэке.
      // Явное завершение встречи идёт через `stop()` ниже.
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      setConnected(false);
    };
  }, [sessionId, enabled, backfill, queryClient]);

  /**
   * PCM-фрейм от audioCapture → на сервер.
   * Если WS не OPEN (reconnect) — кладём в кольцевой буфер и сливаем на open.
   */
  const sendFrame = useCallback((channel: PcmChannel, pcm: ArrayBuffer) => {
    if (killedRef.current) return;
    const buf = new Uint8Array(1 + pcm.byteLength);
    buf[0] = channel;
    buf.set(new Uint8Array(pcm), 1);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(buf);
        return;
      } catch {
        /* сеть моргнула — кадр уйдёт в буфер ниже */
      }
    }
    const q = pcmBufferRef.current;
    q.push(buf);
    if (q.length > PCM_BUFFER_MAX) q.splice(0, q.length - PCM_BUFFER_MAX);
  }, []);

  /**
   * Явное graceful-завершение (кнопка «Завершить встречу»): отправляем `stop`
   * и запрещаем реконнект, не дожидаясь, пока сменится статус сессии.
   */
  const stop = useCallback(() => {
    killedRef.current = true;
    pcmBufferRef.current = [];
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'stop' }));
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, STOP_GRACE_MS);
    } else {
      ws.close();
    }
    setConnected(false);
  }, []);

  const dismissHint = useCallback((id: number) => {
    setHints((prev) => prev.filter((h) => h.id !== id));
  }, []);

  return {
    connected,
    sttStatus,
    segments,
    partials,
    hints,
    questionsUpdatedAt,
    transcriptNotice,
    sendFrame,
    stop,
    dismissHint,
    maxDurationHit,
  };
}
