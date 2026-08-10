/**
 * WS-клиент комнаты скрининга: /api/v1/ws/screening/{sessionId}?token=…
 *
 * Отправляет PCM-фреймы (1 байт канала + PCM16LE 16 кГц) и принимает события
 * транскрипта. Reconnect с экспоненциальным backoff, пока `enabled`.
 * Дедуп финальных сегментов по `seq` (при reconnect сервер может прислать
 * уже виденное — бэк нумерует сквозным счётчиком).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '@/lib/constants';
import { useAuthStore } from '@/stores/auth';
import type { ScreeningSpeaker } from '@/api/screenings';

export interface LiveSegment {
  seq: number;
  speaker: ScreeningSpeaker;
  text: string;
  startedMs: number;
  endedMs: number;
}

export type SttStatus = 'connecting' | 'ok' | 'unavailable';

function wsUrl(sessionId: string, token: string): string {
  const path = `${API_BASE_URL}/ws/screening/${sessionId}?token=${encodeURIComponent(token)}`;
  if (/^https?:\/\//i.test(API_BASE_URL)) return path.replace(/^http/, 'ws');
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${path}`;
}

export function useScreeningSocket(sessionId: string, enabled: boolean) {
  const [connected, setConnected] = useState(false);
  const [sttStatus, setSttStatus] = useState<SttStatus>('connecting');
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [partials, setPartials] = useState<Partial<Record<ScreeningSpeaker, string>>>({});
  /** Этап 6: сервер закрыл сессию по SCREENING_MAX_DURATION_MIN. */
  const [maxDurationHit, setMaxDurationHit] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    setMaxDurationHit(false);

    const connect = () => {
      if (disposed || !enabledRef.current) return;
      const token = useAuthStore.getState().accessToken;
      if (!token) return;
      const ws = new WebSocket(wsUrl(sessionId, token));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (disposed || !enabledRef.current) return;
        const delay =
          Math.min(30_000, 1000 * 2 ** retryRef.current) * (0.75 + Math.random() * 0.5);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
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
          case 'hello':
            setSttStatus(msg.sttReady ? 'ok' : 'unavailable');
            break;
          case 'session.state': {
            if (msg.sttReady === false) setSttStatus('unavailable');
            if (msg.error === 'max_duration') {
              setMaxDurationHit(true);
              enabledRef.current = false;
              ws.close();
            }
            break;
          }
          case 'stt.available':
            setSttStatus('ok');
            break;
          case 'stt.unavailable':
            setSttStatus('unavailable');
            break;
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
          default:
            break; // ping и прочее
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [sessionId, enabled]);

  /** PCM-фрейм от audioCapture → на сервер. Молча дропаем, если WS не готов. */
  const sendFrame = useCallback((channel: 0 | 1, pcm: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buf = new Uint8Array(1 + pcm.byteLength);
    buf[0] = channel;
    buf.set(new Uint8Array(pcm), 1);
    ws.send(buf);
  }, []);

  return { connected, sttStatus, segments, partials, sendFrame, maxDurationHit };
}
