import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  Check,
  CircleDot,
  ExternalLink,
  Mic,
  MonitorUp,
  Plus,
  Square,
  Trash2,
  Video,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { filesApi, uploadFile } from '@/api/files';
import type { ScreeningQuestion, ScreeningQuestionStatus, ScreeningSegment } from '@/api/screenings';
import { useAuthStore } from '@/stores/auth';
import { ScreeningCapture } from './audioCapture';
import { ScreeningSocket, type TranscriptEvent } from './screeningWs';
import {
  useAddQuestion,
  useAttachScreeningAudio,
  useFinishScreening,
  useRemoveQuestion,
  useScreening,
  useScreeningTranscript,
  useStartScreening,
  useUpdateQuestion,
  useUpdateScreening,
} from './hooks';

/**
 * Комната скрининга (Этапы 1–2): согласие → захват → запись + live-транскрипт
 * по WS → выгрузка в S3. Чек-лист пока вручную; AI-агент — Этапы 3–4.
 */

function LevelBar({ level, label, active }: { level: number; label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[11px] text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-[width] duration-150', active ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
          style={{ width: `${Math.min(100, level * 300)}%` }}
        />
      </div>
    </div>
  );
}

const Q_STATUS_ORDER: ScreeningQuestionStatus[] = ['pending', 'asked', 'answered', 'skipped'];
const Q_STATUS_LABEL: Record<ScreeningQuestionStatus, string> = {
  pending: 'не задан',
  asked: 'задан',
  answered: 'отвечен',
  skipped: 'пропущен',
};

function QuestionRow({
  q,
  disabled,
  onCycle,
  onRemove,
}: {
  q: ScreeningQuestion;
  disabled: boolean;
  onCycle: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 rounded-md border px-3 py-2',
        q.status === 'answered' && 'border-emerald-200 bg-emerald-50/50',
        q.status === 'skipped' && 'opacity-50',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onCycle}
        title={`Статус: ${Q_STATUS_LABEL[q.status]} (клик — следующий)`}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
          q.status === 'answered'
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-muted-foreground/40 text-muted-foreground hover:border-foreground',
        )}
      >
        {q.status === 'answered' && <Check className="h-3 w-3" />}
        {q.status === 'asked' && <CircleDot className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13px] leading-snug', q.status === 'skipped' && 'line-through')}>
          {q.text}
        </div>
        {q.goal && <div className="text-[11px] text-muted-foreground">{q.goal}</div>}
        {q.source !== 'manual' && (
          <Badge variant="secondary" className="mt-1 text-[10px]">
            {q.source === 'pregenerated' ? 'AI · до встречи' : 'AI · follow-up'}
          </Badge>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        className="mt-0.5 hidden shrink-0 text-muted-foreground hover:text-red-500 group-hover:block"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TranscriptPanel({
  finals,
  partials,
  connected,
  sttReady,
  sttError,
  live,
}: {
  finals: ScreeningSegment[];
  partials: Partial<Record<'recruiter' | 'candidate', string>>;
  connected: boolean;
  sttReady: boolean;
  sttError: string | null;
  live: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [finals.length, partials.recruiter, partials.candidate]);

  return (
    <Card className="flex min-h-[320px] flex-col">
      <CardContent className="flex flex-1 flex-col space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-medium">Транскрипт</div>
          {live && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {connected ? (
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-amber-500" />
              )}
              {!sttReady || sttError
                ? sttError === 'stt_unavailable'
                  ? 'STT недоступен'
                  : connected
                    ? 'ожидание STT…'
                    : 'переподключение…'
                : connected
                  ? 'live'
                  : 'переподключение…'}
            </div>
          )}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto rounded-md bg-muted/30 p-2.5 text-[12.5px] leading-snug">
          {finals.length === 0 && !partials.recruiter && !partials.candidate && (
            <p className="py-6 text-center text-muted-foreground">
              {live ? 'Реплики появятся здесь по мере разговора' : 'Транскрипт пуст'}
            </p>
          )}
          {finals.map((s) => (
            <div
              key={s.id || `seq-${s.seq}`}
              className={cn(
                'rounded-md px-2.5 py-1.5',
                s.speaker === 'recruiter' ? 'bg-sky-50/80' : 'bg-background',
              )}
            >
              <div className="mb-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                <span className="font-medium">
                  {s.speaker === 'recruiter' ? 'Рекрутер' : 'Кандидат'}
                </span>
                <span>{formatMs(s.startedMs)}</span>
              </div>
              <div>{s.text}</div>
            </div>
          ))}
          {(['recruiter', 'candidate'] as const).map((sp) =>
            partials[sp] ? (
              <div
                key={`partial-${sp}`}
                className={cn(
                  'rounded-md px-2.5 py-1.5 italic opacity-70',
                  sp === 'recruiter' ? 'bg-sky-50/50' : 'bg-background',
                )}
              >
                <div className="mb-0.5 text-[10.5px] text-muted-foreground">
                  {sp === 'recruiter' ? 'Рекрутер' : 'Кандидат'} · …
                </div>
                <div>{partials[sp]}</div>
              </div>
            ) : null,
          )}
          <div ref={bottomRef} />
        </div>
      </CardContent>
    </Card>
  );
}

export function ScreeningRoomPage() {
  const { id } = useParams({ from: '/_authed/video-interviews_/$id' });
  const { data: session, isLoading } = useScreening(id);

  const updateSession = useUpdateScreening();
  const startSession = useStartScreening();
  const finishSession = useFinishScreening();
  const attachAudio = useAttachScreeningAudio();
  const addQuestion = useAddQuestion();
  const updateQuestion = useUpdateQuestion();
  const removeQuestion = useRemoveQuestion();

  const captureRef = useRef<ScreeningCapture | null>(null);
  const socketRef = useRef<ScreeningSocket | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [tabReady, setTabReady] = useState(false);
  const [levels, setLevels] = useState({ mic: 0, tab: 0 });
  const [tabSilent, setTabSilent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [newQuestion, setNewQuestion] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [finals, setFinals] = useState<ScreeningSegment[]>([]);
  const [partials, setPartials] = useState<Partial<Record<'recruiter' | 'candidate', string>>>({});
  const [wsConnected, setWsConnected] = useState(false);
  const [sttReady, setSttReady] = useState(true);
  const [sttError, setSttError] = useState<string | null>(null);

  const isLive = session?.status === 'live';
  const isDone = session?.status === 'done' || session?.status === 'processing';
  const { data: savedTranscript } = useScreeningTranscript(id, !!session && (isLive || !!isDone));

  const startSocket = useCallback(
    (sessionId: string) => {
      socketRef.current?.stop();
      const sock = new ScreeningSocket(sessionId, {
        getToken: () => useAuthStore.getState().accessToken,
        onConnection: setWsConnected,
        onHello: ({ sttReady: ready }) => {
          setSttReady(ready);
          if (!ready) setSttError('stt_unavailable');
          else setSttError(null);
        },
        onPartial: (ev: TranscriptEvent) => {
          setPartials((p) => ({ ...p, [ev.speaker]: ev.text }));
        },
        onFinal: (ev: TranscriptEvent) => {
          setPartials((p) => {
            const next = { ...p };
            delete next[ev.speaker];
            return next;
          });
          if (ev.seq == null) return;
          const seq = ev.seq;
          setFinals((prev) => {
            if (prev.some((s) => s.seq === seq)) return prev;
            const seg: ScreeningSegment = {
              id: `live-${seq}`,
              seq,
              speaker: ev.speaker,
              text: ev.text,
              startedMs: ev.startedMs ?? 0,
              endedMs: ev.endedMs ?? 0,
            };
            return [...prev, seg].sort((a, b) => a.seq - b.seq);
          });
        },
        onState: (state) => {
          if (state.sttReady === false) {
            setSttReady(false);
            setSttError(state.error ?? 'stt_unavailable');
          } else if (state.sttReady === true) {
            setSttReady(true);
            setSttError(null);
          }
        },
      });
      socketRef.current = sock;
      sock.start();
    },
    [],
  );

  useEffect(() => {
    if (!savedTranscript) return;
    setFinals((prev) => {
      const bySeq = new Map<number, ScreeningSegment>();
      for (const s of savedTranscript.items) bySeq.set(s.seq, s);
      for (const s of prev) if (!bySeq.has(s.seq)) bySeq.set(s.seq, s);
      return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    });
  }, [savedTranscript]);

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  useEffect(
    () => () => {
      void captureRef.current?.stop();
      socketRef.current?.stop();
    },
    [],
  );

  // Сессия уже live (reload) — поднимаем WS; захват нужно разрешить заново.
  useEffect(() => {
    if (!session || session.status !== 'live' || recording) return;
    if (socketRef.current) return;
    startSocket(session.id);
  }, [session, recording, startSocket]);

  if (isLoading || !session) {
    return (
      <div className="flex-1 space-y-3 px-6 pt-5">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isDraft = session.status === 'draft';
  const editable = isDraft || isLive;

  const getCapture = () => {
    if (!captureRef.current) {
      captureRef.current = new ScreeningCapture({
        onLevels: setLevels,
        onTabSilence: setTabSilent,
        onEnded: () => {
          setTabReady(false);
          toast.warning('Доступ к звуку вкладки остановлен — выберите вкладку заново');
        },
        onPcmFrame: (channel, pcm) => {
          socketRef.current?.sendPcm(channel, pcm);
        },
      });
    }
    return captureRef.current;
  };

  const requestMic = async () => {
    if (!ScreeningCapture.isSupported()) {
      toast.error('Нужен Chrome / Яндекс Браузер / Edge');
      return;
    }
    try {
      await getCapture().requestMic();
      setMicReady(true);
    } catch {
      toast.error('Нет доступа к микрофону');
    }
  };

  const requestTab = async () => {
    try {
      const ok = await getCapture().requestTab();
      if (!ok) {
        toast.error('Не включена галка «Поделиться звуком вкладки» — попробуйте ещё раз');
        return;
      }
      setTabReady(true);
    } catch {
      /* пользователь закрыл диалог */
    }
  };

  const start = async () => {
    try {
      await startSession.mutateAsync(session.id);
    } catch (e) {
      const err = e as { response?: Response };
      const body = await err.response?.json?.().catch(() => null);
      if (body?.detail?.code === 'consent_required') {
        toast.error('Сначала подтвердите согласие кандидата на запись');
      } else {
        toast.error('Не удалось начать сессию');
      }
      return;
    }
    startSocket(session.id);
    await getCapture().start();
    setRecording(true);
    setElapsed(0);
  };

  const finish = async () => {
    setRecording(false);
    setUploading(true);
    try {
      socketRef.current?.stop();
      socketRef.current = null;
      const blob = await getCapture().stop();
      await finishSession.mutateAsync({ id: session.id, durationSec: elapsed });
      if (blob && blob.size > 0) {
        const file = new File([blob], `screening-${session.id.slice(0, 8)}.webm`, {
          type: 'audio/webm',
        });
        const rec = await uploadFile({ entityType: 'screening', entityId: session.id, file });
        await attachAudio.mutateAsync({ id: session.id, fileId: rec.id });
        toast.success('Запись сохранена');
      }
    } catch {
      toast.error('Встреча завершена, но запись сохранить не удалось');
    } finally {
      setUploading(false);
      setMicReady(false);
      setTabReady(false);
      captureRef.current = null;
    }
  };

  const openAudio = async () => {
    if (!session.audioFileId) return;
    try {
      const { url } = await filesApi.download(session.audioFileId);
      setAudioUrl(url);
    } catch {
      toast.error('Не удалось получить запись');
    }
  };

  const cycleStatus = (q: ScreeningQuestion) => {
    const next =
      Q_STATUS_ORDER[(Q_STATUS_ORDER.indexOf(q.status) + 1) % Q_STATUS_ORDER.length];
    updateQuestion.mutate({ id: session.id, questionId: q.id, payload: { status: next } });
  };

  const submitQuestion = () => {
    const text = newQuestion.trim();
    if (!text) return;
    addQuestion.mutate({ id: session.id, text });
    setNewQuestion('');
  };

  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
      <div className="flex items-start gap-3">
        <Link
          to="/video-interviews"
          className="mt-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Скрининг: {session.candidateName ?? 'кандидат'}
          </h1>
          <p className="text-[11.5px] text-muted-foreground">
            {session.vacancyTitle ?? 'Без вакансии'}
            {isLive && <span className="ml-2 font-medium text-red-500">● запись · {mmss}</span>}
          </p>
        </div>
        {session.telemostUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={session.telemostUrl} target="_blank" rel="noreferrer">
              <Video className="mr-1.5 h-4 w-4" /> Открыть Телемост
              <ExternalLink className="ml-1.5 h-3 w-3" />
            </a>
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-[13px] font-medium">Встреча</div>

              {isDraft && (
                <>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
                    <Checkbox
                      checked={session.consentConfirmed}
                      onCheckedChange={(v) =>
                        updateSession.mutate({
                          id: session.id,
                          payload: { consentConfirmed: v === true },
                        })
                      }
                      className="mt-0.5"
                    />
                    <span className="text-[11.5px] leading-snug text-muted-foreground">
                      Кандидат предупреждён и дал согласие на запись и обработку разговора
                      (обязательно по 152-ФЗ)
                    </span>
                  </label>

                  <div className="space-y-2">
                    <Button
                      variant={micReady ? 'outline' : 'default'}
                      size="sm"
                      className="w-full"
                      onClick={requestMic}
                      disabled={micReady}
                    >
                      <Mic className="mr-1.5 h-4 w-4" />
                      {micReady ? 'Микрофон подключён' : '1. Разрешить микрофон'}
                    </Button>
                    <Button
                      variant={tabReady ? 'outline' : 'default'}
                      size="sm"
                      className="w-full"
                      onClick={requestTab}
                      disabled={!micReady || tabReady}
                    >
                      <MonitorUp className="mr-1.5 h-4 w-4" />
                      {tabReady ? 'Звук вкладки подключён' : '2. Выбрать вкладку Телемоста'}
                    </Button>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={start}
                      disabled={!micReady || !tabReady || startSession.isPending}
                    >
                      3. Начать встречу и запись
                    </Button>
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Работайте в наушниках. Телемост — во вкладке этого же браузера. В диалоге
                    выбора включите «Поделиться звуком вкладки».
                  </p>
                </>
              )}

              {isLive && (
                <>
                  <LevelBar label="🎙 Микрофон" level={levels.mic} active={levels.mic > 0.02} />
                  <LevelBar label="👤 Кандидат" level={levels.tab} active={levels.tab > 0.02} />
                  {tabSilent && (
                    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[11.5px] text-red-600">
                      Со вкладки Телемоста не идёт звук — проверьте галку «Поделиться звуком
                      вкладки»
                    </div>
                  )}
                  {!recording && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11.5px] text-amber-800">
                      Страница перезагружена — заново разрешите микрофон и вкладку, чтобы
                      продолжить запись и транскрипт.
                      <div className="mt-2 space-y-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={requestMic}
                          disabled={micReady}
                        >
                          Микрофон
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={requestTab}
                          disabled={!micReady || tabReady}
                        >
                          Вкладка Телемоста
                        </Button>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={!micReady || !tabReady}
                          onClick={async () => {
                            startSocket(session.id);
                            await getCapture().start();
                            setRecording(true);
                          }}
                        >
                          Продолжить запись
                        </Button>
                      </div>
                    </div>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={finish}
                    disabled={uploading}
                  >
                    <Square className="mr-1.5 h-3.5 w-3.5" />
                    {uploading ? 'Сохраняем запись…' : 'Завершить встречу'}
                  </Button>
                </>
              )}

              {isDone && (
                <div className="space-y-2 text-[12px] text-muted-foreground">
                  <div>
                    Встреча завершена
                    {session.durationSec
                      ? ` · ${Math.floor(session.durationSec / 60)} мин ${session.durationSec % 60} c`
                      : ''}
                  </div>
                  {session.audioFileId ? (
                    audioUrl ? (
                      <audio controls src={audioUrl} className="w-full" />
                    ) : (
                      <Button variant="outline" size="sm" onClick={openAudio}>
                        Прослушать запись
                      </Button>
                    )
                  ) : (
                    <div>Запись не прикреплена</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="space-y-2.5 p-4">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-medium">
                Вопросы
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {session.questions.filter((q) => q.status === 'answered').length}/
                  {session.questions.length} отвечено
                </span>
              </div>
            </div>

            {session.questions.length === 0 && (
              <p className="py-4 text-center text-[12px] text-muted-foreground">
                Добавьте вопросы — во время встречи отмечайте их кликом по кружку.
              </p>
            )}
            <div className="space-y-1.5">
              {session.questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  disabled={!editable}
                  onCycle={() => cycleStatus(q)}
                  onRemove={() => removeQuestion.mutate({ id: session.id, questionId: q.id })}
                />
              ))}
            </div>

            {editable && (
              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="Новый вопрос…"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitQuestion()}
                />
                <Button size="sm" variant="outline" onClick={submitQuestion} disabled={!newQuestion.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <TranscriptPanel
          finals={finals}
          partials={partials}
          connected={wsConnected}
          sttReady={sttReady}
          sttError={sttError}
          live={!!isLive}
        />
      </div>
    </div>
  );
}
