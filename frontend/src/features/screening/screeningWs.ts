/**
 * WebSocket-клиент комнаты скрининга (/api/v1/ws/screening/{id}).
 *
 * Шлёт PCM-фреймы, принимает transcript.partial/final, questions.updated,
 * hint; умеет reconnect с экспоненциальным backoff (как lib/realtime.ts).
 */

import { screeningWsUrl } from '@/lib/constants';
import type { ScreeningQuestion, ScreeningSpeaker } from '@/api/screenings';
import type { PcmChannel } from './audioCapture';

export interface TranscriptEvent {
  type: 'transcript.partial' | 'transcript.final';
  speaker: ScreeningSpeaker;
  text: string;
  seq?: number;
  startedMs?: number;
  endedMs?: number;
  latencyMs?: number;
}

export interface ScreeningSocketHandlers {
  getToken: () => string | null | undefined;
  onPartial?: (ev: TranscriptEvent) => void;
  onFinal?: (ev: TranscriptEvent) => void;
  onQuestionsUpdated?: (questions: ScreeningQuestion[]) => void;
  onHint?: (text: string) => void;
  onHello?: (info: { lastSeq: number; sttReady: boolean }) => void;
  onState?: (state: {
    status: string;
    sttReady?: boolean;
    error?: string;
  }) => void;
  onConnection?: (connected: boolean) => void;
}

function backoffMs(attempt: number): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  const jitter = base * (0.75 + Math.random() * 0.5);
  return jitter;
}

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

export class ScreeningSocket {
  private ws: WebSocket | null = null;
  private wanted = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private stoppedByUs = false;

  constructor(
    private sessionId: string,
    private handlers: ScreeningSocketHandlers,
  ) {}

  start(): void {
    this.wanted = true;
    this.stoppedByUs = false;
    this.open();
  }

  /** Корректное завершение: stop → close, без reconnect. */
  stop(): void {
    this.wanted = false;
    this.stoppedByUs = true;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'stop' }));
      } catch {
        /* ignore */
      }
      window.setTimeout(() => this.ws?.close(), 400);
    } else {
      this.ws?.close();
    }
    this.ws = null;
    this.handlers.onConnection?.(false);
  }

  /** Бинарный фрейм: 1 байт канала + PCM16LE. */
  sendPcm(channel: PcmChannel, pcm: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = new Uint8Array(1 + pcm.byteLength);
    buf[0] = channel;
    buf.set(new Uint8Array(pcm), 1);
    this.ws.send(buf);
  }

  private open(): void {
    if (!this.wanted) return;
    const url = screeningWsUrl(this.sessionId);
    if (!url) {
      this.handlers.onState?.({ status: 'live', sttReady: false, error: 'ws_unavailable' });
      return;
    }
    const token = this.handlers.getToken();
    if (!token) {
      this.scheduleReconnect();
      return;
    }

    const full = `${url}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(full);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.handlers.onConnection?.(true);
      try {
        ws.send(JSON.stringify({ type: 'start', sampleRate: 16000 }));
      } catch {
        /* ignore */
      }
    };

    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      const type = msg.type as string | undefined;
      if (type === 'ping') return;
      if (type === 'hello') {
        this.handlers.onHello?.({
          lastSeq: Number(msg.lastSeq ?? 0),
          sttReady: Boolean(msg.sttReady),
        });
        return;
      }
      if (type === 'transcript.partial' || type === 'transcript.final') {
        const ev: TranscriptEvent = {
          type,
          speaker: (msg.speaker as ScreeningSpeaker) ?? 'candidate',
          text: String(msg.text ?? ''),
          seq: msg.seq != null ? Number(msg.seq) : undefined,
          startedMs: msg.startedMs != null ? Number(msg.startedMs) : undefined,
          endedMs: msg.endedMs != null ? Number(msg.endedMs) : undefined,
          latencyMs: msg.latencyMs != null ? Number(msg.latencyMs) : undefined,
        };
        if (type === 'transcript.partial') this.handlers.onPartial?.(ev);
        else this.handlers.onFinal?.(ev);
        return;
      }
      if (type === 'questions.updated') {
        this.handlers.onQuestionsUpdated?.(parseQuestions(msg.questions));
        return;
      }
      if (type === 'hint') {
        const text = String(msg.text ?? '').trim();
        if (text) this.handlers.onHint?.(text);
        return;
      }
      if (type === 'session.state') {
        this.handlers.onState?.({
          status: String(msg.status ?? ''),
          sttReady: msg.sttReady as boolean | undefined,
          error: msg.error as string | undefined,
        });
      }
    };

    ws.onclose = () => {
      this.handlers.onConnection?.(false);
      if (this.wanted && !this.stoppedByUs) this.scheduleReconnect();
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer !== null) return;
    const delay = backoffMs(this.reconnectAttempt++);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }
}
