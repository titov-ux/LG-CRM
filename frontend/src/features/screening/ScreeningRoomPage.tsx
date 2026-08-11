import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleDot,
  Download,
  ExternalLink,
  Lightbulb,
  Mic,
  MonitorUp,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth';
import { filesApi, uploadFile } from '@/api/files';
import type {
  ScreeningQuestion,
  ScreeningQuestionStatus,
  ScreeningSpeaker,
} from '@/api/screenings';
import { ScreeningCapture, captureSupportIssue, describeCaptureError } from './audioCapture';
import { ScreeningAudioPlayer } from './ScreeningAudioPlayer';
import { ScreeningReportPanel } from './ScreeningReportPanel';
import {
  screeningKeys,
  useAddQuestion,
  useAttachScreeningAudio,
  useDeleteScreening,
  useFinishScreening,
  useRegenerateQuestions,
  useRemoveQuestion,
  useScreening,
  useScreeningSegments,
  useStartScreening,
  useUpdateQuestion,
  useUpdateScreening,
} from './hooks';
import {
  useScreeningSocket,
  type LiveHint,
  type LiveSegment,
  type SttStatus,
} from './useScreeningSocket';

/**
 * Комната скрининга: согласие → захват (микрофон + вкладка Телемоста) →
 * запись + live-транскрипт и подсказки AI-агента → выгрузка записи в S3 и
 * AI-отчёт после встречи.
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

function msToClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function secToClock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

/** Панель транскрипта: живые сегменты во время встречи, REST — после. */
function TranscriptPane({
  live,
  segments,
  partials,
  sttStatus,
}: {
  live: boolean;
  segments: LiveSegment[];
  partials: Partial<Record<ScreeningSpeaker, string>>;
  sttStatus: SttStatus;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** Автоскролл только если рекрутер и так внизу — иначе не дёргаем чтение. */
  const atBottomRef = useRef(true);

  const handleScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [segments.length, partials.recruiter, partials.candidate]);

  return (
    <div className="space-y-1.5">
      {live && sttStatus === 'unavailable' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11.5px] text-amber-700">
          Сервис распознавания недоступен — запись идёт, транскрипт появится,
          когда сервис поднимется.
        </div>
      )}
      {segments.length === 0 && !partials.recruiter && !partials.candidate && (
        <p className="py-3 text-center text-[12px] text-muted-foreground">
          {live
            ? sttStatus === 'ok'
              ? 'Слушаем… реплики появятся здесь по мере разговора.'
              : 'Ожидание распознавания…'
            : 'Транскрипт пуст.'}
        </p>
      )}
      <div
        ref={boxRef}
        onScroll={handleScroll}
        aria-live="polite"
        aria-relevant="additions text"
        className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1"
      >
        {segments.map((s) => (
          <div
            key={s.seq}
            className={cn(
              'rounded-md px-3 py-1.5 text-[12.5px] leading-snug',
              s.speaker === 'recruiter' ? 'bg-sky-50' : 'bg-emerald-50',
            )}
          >
            <span className="mr-2 text-[10.5px] font-semibold uppercase text-muted-foreground">
              {s.speaker === 'recruiter' ? '🎙 Рекрутер' : '👤 Кандидат'}
              <span className="ml-1.5 font-normal normal-case tnum">
                {msToClock(s.startedMs)}
              </span>
            </span>
            {s.text}
          </div>
        ))}
        {(['recruiter', 'candidate'] as ScreeningSpeaker[]).map(
          (sp) =>
            partials[sp] && (
              <div
                key={sp}
                className="rounded-md bg-muted/40 px-3 py-1.5 text-[12.5px] italic leading-snug opacity-60"
              >
                <span className="mr-2 text-[10.5px] font-semibold uppercase not-italic text-muted-foreground">
                  {sp === 'recruiter' ? '🎙 Рекрутер' : '👤 Кандидат'}
                </span>
                {partials[sp]}…
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/** Подсказки realtime-агента: копим последние несколько, со временем. */
function HintsPane({
  hints,
  onDismiss,
}: {
  hints: LiveHint[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="space-y-1.5" aria-live="polite">
      {hints.map((h) => (
        <div
          key={h.id}
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-2 text-[12px] leading-snug text-amber-900"
        >
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <div>{h.text}</div>
            <div className="mt-0.5 text-[10.5px] text-amber-700/70 tnum">
              {new Date(h.at).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
          <button
            type="button"
            aria-label="Скрыть подсказку"
            onClick={() => onDismiss(h.id)}
            className="shrink-0 rounded text-amber-700/60 transition-colors hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
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
  onSaveText,
}: {
  q: ScreeningQuestion;
  disabled: boolean;
  onCycle: () => void;
  onRemove: () => void;
  onSaveText: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(q.text);

  const startEdit = () => {
    setDraft(q.text);
    setEditing(true);
  };

  const save = () => {
    const text = draft.trim();
    setEditing(false);
    if (!text || text === q.text) return;
    onSaveText(text);
  };

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
        aria-label={`Вопрос «${q.text}» · статус: ${Q_STATUS_LABEL[q.status]}. Нажмите, чтобы поставить следующий статус`}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          q.status === 'answered'
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : 'border-muted-foreground/40 text-muted-foreground hover:border-foreground',
        )}
      >
        {q.status === 'answered' && <Check className="h-3 w-3" />}
        {q.status === 'asked' && <CircleDot className="h-3 w-3" />}
      </button>
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex gap-1.5">
            <Input
              autoFocus
              value={draft}
              aria-label="Текст вопроса"
              className="h-7 text-[12.5px]"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={save}
            />
          </div>
        ) : (
          <div className={cn('text-[13px] leading-snug', q.status === 'skipped' && 'line-through')}>
            {q.text}
          </div>
        )}
        {q.goal && <div className="text-[11px] text-muted-foreground">{q.goal}</div>}
        {q.source !== 'manual' && (
          <Badge variant="secondary" className="mt-1 text-[10px]">
            {q.source === 'pregenerated' ? 'AI · до встречи' : 'AI · follow-up'}
          </Badge>
        )}
      </div>
      {!editing && (
        <button
          type="button"
          disabled={disabled}
          onClick={startEdit}
          aria-label={`Изменить текст вопроса «${q.text}»`}
          title="Изменить текст"
          className="mt-0.5 shrink-0 rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={onRemove}
        aria-label={`Удалить вопрос «${q.text}»`}
        title="Удалить вопрос"
        className="mt-0.5 shrink-0 rounded text-muted-foreground opacity-0 transition-opacity hover:text-red-500 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ScreeningRoomPage() {
  const { id } = useParams({ from: '/_authed/video-interviews_/$id' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isLoading, isError, refetch, isRefetching } = useScreening(id);

  const canRun = useCan('screening:run');
  const canViewReport = useCan('screening:view_report');
  const me = useAuthStore((s) => s.user);

  const updateSession = useUpdateScreening();
  const startSession = useStartScreening();
  const finishSession = useFinishScreening();
  const deleteSession = useDeleteScreening();
  const attachAudio = useAttachScreeningAudio();
  const addQuestion = useAddQuestion();
  const updateQuestion = useUpdateQuestion();
  const removeQuestion = useRemoveQuestion();
  const regenerateQuestions = useRegenerateQuestions();

  const captureRef = useRef<ScreeningCapture | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [tabReady, setTabReady] = useState(false);
  const [levels, setLevels] = useState({ mic: 0, tab: 0 });
  const [tabSilent, setTabSilent] = useState(false);
  /** Захват реально работает в этой вкладке (после F5 — false). */
  const [captureActive, setCaptureActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  /** Записанный блоб, который не удалось выгрузить — даём повторить/скачать. */
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [telemostDraft, setTelemostDraft] = useState('');
  const [telemostEditing, setTelemostEditing] = useState(false);
  const [aiPulse, setAiPulse] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /** Тик раз в секунду только для перерисовки часов. */
  const [nowTs, setNowTs] = useState(() => Date.now());

  const isDraft = session?.status === 'draft';
  const isLive = session?.status === 'live';
  const isFailed = session?.status === 'error';
  // «Встреча позади» — включая error: пост-анализ мог упасть, но запись и
  // транскрипт есть, страница не должна выглядеть пустой.
  const isDone =
    session?.status === 'done' || session?.status === 'processing' || isFailed;
  /**
   * Бэк разрешает менять сессию только ведущему рекрутеру и админу (иначе 403,
   * а WS закрывается кодом 1008). Остальным — режим просмотра, иначе каждая
   * кнопка в комнате даёт ошибку.
   */
  const isOwner =
    !!session && (session.recruiterId === me?.id || me?.role === 'admin');
  const canControl = canRun && isOwner;
  const editable = (isDraft || isLive) && canControl;
  const supportIssue = captureSupportIssue();

  // Realtime-транскрипция + агент: сокет живёт, пока сессия live.
  const socket = useScreeningSocket(id, !!isLive && canControl);
  const sendFrameRef = useRef(socket.sendFrame);
  sendFrameRef.current = socket.sendFrame;
  const { data: storedSegments } = useScreeningSegments(id, !!isDone && canViewReport);

  /**
   * Длительность считаем по startedAt, а не тиками setInterval: вкладка
   * скрининга во время интервью фоновая, таймеры троттлятся и занижают время
   * (оно уезжает в отчёт и DOCX). После F5 значение тоже корректное.
   */
  const startedAtMs = session?.startedAt ? Date.parse(session.startedAt) : NaN;
  const elapsedSec = Number.isNaN(startedAtMs)
    ? 0
    : Math.max(0, Math.floor((nowTs - startedAtMs) / 1000));
  const currentElapsedSec = useCallback(
    () => (Number.isNaN(startedAtMs) ? 0 : Math.max(0, Math.round((Date.now() - startedAtMs) / 1000))),
    [startedAtMs],
  );

  useEffect(() => {
    if (!isLive) return;
    setNowTs(Date.now());
    const t = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [isLive]);

  // Останавливаем дорожки при уходе со страницы.
  useEffect(() => () => void captureRef.current?.stop(), []);

  useEffect(() => {
    if (!socket.questionsUpdatedAt) return;
    setAiPulse(true);
    const t = window.setTimeout(() => setAiPulse(false), 6_000);
    return () => window.clearTimeout(t);
  }, [socket.questionsUpdatedAt]);

  /** Выгрузка записи в S3 + привязка к сессии. Бросает при ошибке. */
  const uploadRecording = useCallback(
    async (blob: Blob) => {
      const file = new File([blob], `screening-${id.slice(0, 8)}.webm`, {
        type: blob.type || 'audio/webm',
      });
      const rec = await uploadFile({ entityType: 'screening', entityId: id, file });
      await attachAudio.mutateAsync({ id, fileId: rec.id });
    },
    [id, attachAudio],
  );

  const downloadBlobLocally = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screening-${id.slice(0, 8)}.webm`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const retryUpload = async () => {
    if (!pendingBlob) return;
    setUploading(true);
    try {
      await uploadRecording(pendingBlob);
      setPendingBlob(null);
      toast.success('Запись сохранена');
    } catch {
      toast.error('Снова не удалось выгрузить запись — попробуйте позже или скачайте локально');
    } finally {
      setUploading(false);
    }
  };

  /**
   * «Уже завершаемся» — общий флаг для кнопки «Завершить встречу» и хард-стопа
   * по лимиту длительности: без него оба пути звали `capture.stop()` и
   * выгружали запись дважды.
   */
  const finalizingRef = useRef(false);

  // Hard-stop по max duration: сервер уже перевёл сессию в processing —
  // забираем блоб (иначе он терялся), выгружаем и обновляем карточку.
  useEffect(() => {
    if (!socket.maxDurationHit || finalizingRef.current) return;
    finalizingRef.current = true;
    void (async () => {
      setUploading(true);
      let blob: Blob | null = null;
      try {
        blob = (await captureRef.current?.stop()) ?? null;
      } catch {
        blob = null;
      }
      captureRef.current = null;
      setCaptureActive(false);
      setMicReady(false);
      setTabReady(false);
      if (blob && blob.size > 0) {
        try {
          await uploadRecording(blob);
          toast.success('Запись сохранена');
        } catch {
          setPendingBlob(blob);
          toast.error('Запись не выгрузилась — повторите выгрузку или скачайте локально');
        }
      }
      setUploading(false);
      await queryClient.invalidateQueries({ queryKey: screeningKeys.byId(id) });
      toast.warning('Достигнут лимит длительности встречи — сессия завершена');
    })();
  }, [socket.maxDurationHit, id, queryClient, uploadRecording]);

  // Уход со страницы во время live выбросил бы записанный блоб — предупреждаем
  // и при внутренней навигации (TanStack useBlocker), и при F5/закрытии вкладки.
  const shouldWarnOnLeave = (!!isLive && captureActive) || !!pendingBlob;
  useBlocker({
    shouldBlockFn: () =>
      !window.confirm(
        pendingBlob
          ? 'Запись ещё не выгружена — если уйти, она будет потеряна. Уйти со страницы?'
          : 'Встреча идёт, запись не сохранена. Если уйти со страницы, запись будет потеряна. Уйти?',
      ),
    enableBeforeUnload: () => shouldWarnOnLeave,
    disabled: !shouldWarnOnLeave,
  });

  if (isError) {
    return (
      <div className="flex-1 space-y-3 px-6 pt-5">
        <div className="flex items-start gap-3">
          <Link
            to="/video-interviews"
            aria-label="Назад к списку видеоинтервью"
            className="mt-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </Link>
          <h1 className="text-[15px] font-semibold tracking-tight">Скрининг</h1>
        </div>
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-muted-foreground/60" />
            <div className="text-[13px] font-medium">Не удалось загрузить сессию скрининга</div>
            <p className="text-[12px] text-muted-foreground">
              Проверьте соединение и попробуйте ещё раз.
            </p>
            <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isRefetching}>
              <RotateCw className={cn('mr-1.5 h-3.5 w-3.5', isRefetching && 'animate-spin')} />
              Повторить
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !session) {
    return (
      <div className="flex-1 space-y-3 px-6 pt-5">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canRun && !canViewReport) {
    return (
      <div className="flex-1 space-y-3 px-6 pt-5">
        <Card>
          <CardContent className="space-y-2 p-6 text-center">
            <div className="text-[13px] font-medium">Нет доступа к AI-скринингу</div>
            <p className="text-[12px] text-muted-foreground">
              Обратитесь к администратору, если доступ нужен для работы.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getCapture = () => {
    if (!captureRef.current) {
      captureRef.current = new ScreeningCapture({
        onLevels: setLevels,
        onTabSilence: setTabSilent,
        onEnded: () => {
          setTabReady(false);
          toast.warning('Доступ к звуку вкладки остановлен — выберите вкладку заново');
        },
        onFrame: (channel, pcm) => sendFrameRef.current(channel, pcm),
      });
    }
    return captureRef.current;
  };

  const requestMic = async () => {
    if (supportIssue) {
      toast.error(supportIssue);
      return;
    }
    try {
      await getCapture().requestMic();
      setMicReady(true);
    } catch (e) {
      toast.error(describeCaptureError(e) ?? 'Доступ к микрофону не выдан');
    }
  };

  const requestTab = async () => {
    if (supportIssue) {
      toast.error(supportIssue);
      return;
    }
    try {
      const ok = await getCapture().requestTab();
      if (!ok) {
        toast.error('Не включена галка «Поделиться звуком вкладки» — попробуйте ещё раз');
        return;
      }
      setTabReady(true);
      setTabSilent(false);
    } catch (e) {
      // NotAllowedError — пользователь просто закрыл диалог выбора вкладки.
      const message = describeCaptureError(e);
      if (message) toast.error(message);
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
    try {
      await getCapture().start();
      setCaptureActive(true);
    } catch (e) {
      toast.error(describeCaptureError(e) ?? 'Не удалось запустить запись');
    }
  };

  /** Возобновление захвата в уже идущей встрече (после F5 или отвала вкладки). */
  const resumeCapture = async () => {
    try {
      await getCapture().start();
      setCaptureActive(true);
      setTabSilent(false);
      toast.success('Захват восстановлен — запись и распознавание идут');
    } catch (e) {
      toast.error(describeCaptureError(e) ?? 'Не удалось запустить запись');
    }
  };

  const finish = async () => {
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    const durationSec = currentElapsedSec();
    setUploading(true);
    // Порядок важен: сначала гасим захват и забираем блоб, потом выгружаем,
    // и только затем закрываем сессию. Иначе при ошибке выгрузки блоб терялся.
    let blob: Blob | null = null;
    try {
      blob = (await captureRef.current?.stop()) ?? null;
    } catch {
      blob = null;
    }
    captureRef.current = null;
    setCaptureActive(false);
    setMicReady(false);
    setTabReady(false);

    if (blob && blob.size > 0) {
      try {
        await uploadRecording(blob);
        toast.success('Запись сохранена');
      } catch {
        setPendingBlob(blob);
        toast.error('Запись не выгрузилась — повторите выгрузку или скачайте локально');
      }
    }

    try {
      await finishSession.mutateAsync({ id: session.id, durationSec });
      // Сокет гасим ТОЛЬКО после успешного finish: иначе упавшая мутация
      // оставляла бы live-сессию с намертво погашенным стримом.
      socket.stop();
    } catch {
      finalizingRef.current = false;
      toast.error('Не удалось завершить сессию — попробуйте ещё раз');
    } finally {
      setUploading(false);
    }
  };

  // Плеер сразу: пресайнд URL подгружаем сами, без кнопки «Прослушать».
  useEffect(() => {
    if (!isDone || !canViewReport || !session?.audioFileId) {
      setAudioUrl(null);
      setAudioLoading(false);
      return;
    }
    let cancelled = false;
    setAudioLoading(true);
    setAudioUrl(null);
    void filesApi
      .download(session.audioFileId)
      .then(({ url }) => {
        if (!cancelled) setAudioUrl(url);
      })
      .catch(() => {
        if (!cancelled) toast.error('Не удалось получить запись');
      })
      .finally(() => {
        if (!cancelled) setAudioLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isDone, canViewReport, session?.audioFileId]);

  const cycleStatus = (q: ScreeningQuestion) => {
    const next =
      Q_STATUS_ORDER[(Q_STATUS_ORDER.indexOf(q.status) + 1) % Q_STATUS_ORDER.length];
    updateQuestion.mutate(
      { id: session.id, questionId: q.id, payload: { status: next } },
      { onError: () => toast.error('Не удалось обновить статус вопроса') },
    );
  };

  const saveQuestionText = (q: ScreeningQuestion, text: string) => {
    updateQuestion.mutate(
      { id: session.id, questionId: q.id, payload: { text } },
      { onError: () => toast.error('Не удалось сохранить текст вопроса') },
    );
  };

  const submitQuestion = () => {
    const text = newQuestion.trim();
    if (!text) return;
    addQuestion.mutate(
      { id: session.id, text },
      { onError: () => toast.error('Не удалось добавить вопрос') },
    );
    setNewQuestion('');
  };

  const regenerate = async () => {
    if (!confirm('Перегенерировать план вопросов? Текущие AI-вопросы будут заменены.')) return;
    try {
      await regenerateQuestions.mutateAsync(session.id);
      toast.success('План вопросов обновлён');
    } catch {
      toast.error('Не удалось перегенерировать вопросы');
    }
  };

  const saveTelemost = async () => {
    const url = telemostDraft.trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      toast.error('Ссылка должна начинаться с http:// или https://');
      return;
    }
    try {
      await updateSession.mutateAsync({ id: session.id, payload: { telemostUrl: url } });
      setTelemostEditing(false);
      toast.success('Ссылка на Телемост сохранена');
    } catch {
      toast.error('Не удалось сохранить ссылку');
    }
  };

  const captureLost = isLive && !captureActive;
  const mmss = secToClock(elapsedSec);

  return (
    <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
      {/* Шапка */}
      <div className="flex items-start gap-3">
        <Link
          to="/video-interviews"
          aria-label="Назад к списку видеоинтервью"
          className="mt-1 rounded text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-[15px] font-semibold tracking-tight">
            Скрининг: {session.candidateName ?? 'кандидат'}
          </h1>
          <p className="text-[11.5px] text-muted-foreground">
            {session.vacancyTitle ?? 'Без вакансии'}
            {isLive && (
              <span
                className={cn(
                  'ml-2 font-medium',
                  captureActive ? 'text-red-500' : 'text-amber-600',
                )}
              >
                {captureActive ? `● запись · ${mmss}` : `встреча идёт · ${mmss} · запись не ведётся`}
              </span>
            )}
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

      {supportIssue && (isDraft || isLive) && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{supportIssue}</span>
        </div>
      )}

      {pendingBlob && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-[12px] text-red-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Запись встречи не выгрузилась в хранилище. Она хранится только в этой вкладке —
            не закрывайте страницу.
          </span>
          <Button size="sm" variant="outline" onClick={() => void retryUpload()} disabled={uploading}>
            <RotateCw className={cn('mr-1.5 h-3.5 w-3.5', uploading && 'animate-spin')} />
            {uploading ? 'Выгружаем…' : 'Повторить выгрузку'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadBlobLocally(pendingBlob)}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Скачать запись локально
          </Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Левая колонка: управление встречей */}
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-[13px] font-medium">Встреча</div>

              {/* Ссылку на Телемост можно добавить/поправить и после создания. */}
              {editable && (
                <div className="space-y-1.5">
                  {telemostEditing ? (
                    <div className="flex gap-1.5">
                      <Input
                        autoFocus
                        aria-label="Ссылка на встречу в Телемосте"
                        placeholder="https://telemost.yandex.ru/j/…"
                        value={telemostDraft}
                        className="h-8 text-[12px]"
                        onChange={(e) => setTelemostDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void saveTelemost()}
                      />
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => void saveTelemost()}
                        disabled={updateSession.isPending}
                      >
                        ОК
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        aria-label="Отменить правку ссылки"
                        onClick={() => setTelemostEditing(false)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-[12px] font-normal"
                      onClick={() => {
                        setTelemostDraft(session.telemostUrl ?? '');
                        setTelemostEditing(true);
                      }}
                    >
                      <Video className="mr-1.5 h-3.5 w-3.5" />
                      {session.telemostUrl ? 'Изменить ссылку на Телемост' : 'Добавить ссылку на Телемост'}
                    </Button>
                  )}
                </div>
              )}

              {isDraft && canControl && (
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
                      disabled={micReady || !!supportIssue}
                    >
                      <Mic className="mr-1.5 h-4 w-4" />
                      {micReady ? 'Микрофон подключён' : '1. Разрешить микрофон'}
                    </Button>
                    <Button
                      variant={tabReady ? 'outline' : 'default'}
                      size="sm"
                      className="w-full"
                      onClick={requestTab}
                      disabled={!micReady || tabReady || !!supportIssue}
                    >
                      <MonitorUp className="mr-1.5 h-4 w-4" />
                      {tabReady ? 'Звук вкладки подключён' : '2. Выбрать вкладку Телемоста'}
                    </Button>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={start}
                      disabled={
                        !micReady ||
                        !tabReady ||
                        !session.consentConfirmed ||
                        startSession.isPending
                      }
                    >
                      3. Начать встречу и запись
                    </Button>
                    {!session.consentConfirmed && (
                      <p className="text-[11px] leading-snug text-amber-700">
                        Начать встречу можно только после подтверждения согласия кандидата.
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Работайте в наушниках. Телемост — во вкладке этого же браузера. В диалоге
                    выбора включите «Поделиться звуком вкладки».
                  </p>
                </>
              )}

              {(isDraft || isLive) && !canControl && (
                <p className="text-[12px] text-muted-foreground">
                  {canRun
                    ? 'Скрининг ведёт другой рекрутер — доступен только просмотр.'
                    : 'У вас нет прав на проведение скрининга — доступен только просмотр.'}
                </p>
              )}

              {isLive && canControl && (
                <>
                  {/* F5 во время встречи: захват в новой вкладке не восстанавливается
                      сам — честно говорим об этом и даём восстановить. */}
                  {captureLost && (
                    <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-2.5">
                      <div className="flex items-start gap-2 text-[12px] font-medium text-red-700">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          Захват не активен после перезагрузки — звук встречи не пишется и
                          не распознаётся. Восстановите захват.
                        </span>
                      </div>
                      <Button
                        variant={micReady ? 'outline' : 'default'}
                        size="sm"
                        className="w-full"
                        onClick={requestMic}
                        disabled={micReady || !!supportIssue}
                      >
                        <Mic className="mr-1.5 h-4 w-4" />
                        {micReady ? 'Микрофон подключён' : '1. Разрешить микрофон'}
                      </Button>
                      <Button
                        variant={tabReady ? 'outline' : 'default'}
                        size="sm"
                        className="w-full"
                        onClick={requestTab}
                        disabled={!micReady || tabReady || !!supportIssue}
                      >
                        <MonitorUp className="mr-1.5 h-4 w-4" />
                        {tabReady ? 'Звук вкладки подключён' : '2. Выбрать вкладку Телемоста'}
                      </Button>
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => void resumeCapture()}
                        disabled={!micReady || !tabReady}
                      >
                        3. Возобновить запись
                      </Button>
                    </div>
                  )}

                  {captureActive && (
                    <>
                      <LevelBar label="🎙 Микрофон" level={levels.mic} active={levels.mic > 0.02} />
                      <LevelBar label="👤 Кандидат" level={levels.tab} active={levels.tab > 0.02} />
                    </>
                  )}
                  {captureActive && tabSilent && (
                    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11.5px] text-red-600">
                      <div>
                        Со вкладки Телемоста не идёт звук — проверьте галку «Поделиться звуком
                        вкладки»
                      </div>
                      <Button variant="outline" size="sm" className="w-full" onClick={requestTab}>
                        <MonitorUp className="mr-1.5 h-3.5 w-3.5" />
                        Выбрать вкладку заново
                      </Button>
                    </div>
                  )}
                  {/* при tabSilent такая же кнопка уже есть в красной плашке выше */}
                  {captureActive && !tabReady && !tabSilent && (
                    <Button variant="outline" size="sm" className="w-full" onClick={requestTab}>
                      <MonitorUp className="mr-1.5 h-3.5 w-3.5" />
                      Выбрать вкладку заново
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={finish}
                    disabled={uploading || finishSession.isPending}
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
                  {isFailed && (
                    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-[11.5px] text-red-700">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        AI-разбор встречи не удался. Запись и транскрипт сохранены — оцените
                        встречу вручную.
                      </span>
                    </div>
                  )}
                  {canViewReport ? (
                    session.audioFileId ? (
                      audioUrl ? (
                        <ScreeningAudioPlayer
                          src={audioUrl}
                          durationSec={session.durationSec}
                          className="w-full"
                        />
                      ) : audioLoading ? (
                        <Skeleton className="h-11 w-full rounded-md" />
                      ) : (
                        <div>Не удалось загрузить запись</div>
                      )
                    ) : (
                      <div>Запись не прикреплена</div>
                    )
                  ) : (
                    <div>Нет прав на просмотр записи</div>
                  )}
                </div>
              )}

              {canControl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={deleteSession.isPending}
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {isDraft ? 'Удалить черновик' : 'Удалить интервью'}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Подсказки realtime-агента */}
          {isLive && canControl && socket.hints.length > 0 && (
            <Card>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
                  Подсказки AI
                </div>
                <HintsPane hints={socket.hints} onDismiss={socket.dismissHint} />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Правая колонка: чек-лист вопросов + транскрипт + отчёт */}
        <div className="space-y-4">
        <Card>
          <CardContent className="space-y-2.5 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-medium">
                Вопросы
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {session.questions.filter((q) => q.status === 'answered').length}/
                  {session.questions.length} отвечено
                </span>
                {aiPulse && (
                  <Badge
                    variant="secondary"
                    className="ml-2 bg-amber-500/10 text-[10px] text-amber-700"
                  >
                    обновлено AI
                  </Badge>
                )}
              </div>
              {isDraft && canControl && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => void regenerate()}
                  disabled={regenerateQuestions.isPending}
                >
                  <RefreshCw
                    className={cn('h-3.5 w-3.5', regenerateQuestions.isPending && 'animate-spin')}
                  />
                  {regenerateQuestions.isPending ? 'Генерируем…' : 'Перегенерировать'}
                </Button>
              )}
            </div>

            {session.questions.length === 0 && (
              <p className="py-4 text-center text-[12px] text-muted-foreground">
                Добавьте вопросы — во время встречи отмечайте их кликом по кружку.
              </p>
            )}
            <div className={cn('space-y-1.5 transition-colors', aiPulse && 'rounded-md ring-1 ring-amber-300')}>
              {session.questions.map((q) => (
                <QuestionRow
                  key={q.id}
                  q={q}
                  disabled={!editable}
                  onCycle={() => cycleStatus(q)}
                  onRemove={() => {
                    removeQuestion.mutate(
                      { id: session.id, questionId: q.id },
                      { onError: () => toast.error('Не удалось удалить вопрос') },
                    );
                  }}
                  onSaveText={(text) => saveQuestionText(q, text)}
                />
              ))}
            </div>

            {editable && (
              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="Новый вопрос…"
                  aria-label="Новый вопрос"
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submitQuestion()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={submitQuestion}
                  aria-label="Добавить вопрос"
                  disabled={!newQuestion.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI-отчёт после встречи */}
        {isDone && canViewReport && (
          <Card>
            <CardContent className="space-y-2.5 p-4">
              <div className="text-[13px] font-medium">AI-отчёт</div>
              <ScreeningReportPanel session={session} />
            </CardContent>
          </Card>
        )}

        {/* Транскрипт: живой (WS, право screening:run) — во время встречи,
            из БД (право screening:view_report) — после */}
        {((isLive && canControl) || (isDone && canViewReport)) && (
          <Card>
            <CardContent className="space-y-2.5 p-4">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-medium">Транскрипт</div>
                {isLive && (
                  <span
                    className={cn(
                      'text-[11px]',
                      captureActive && socket.sttStatus === 'ok'
                        ? 'text-emerald-600'
                        : 'text-muted-foreground',
                    )}
                  >
                    {!captureActive
                      ? 'захват не активен'
                      : socket.sttStatus === 'ok'
                        ? '● распознавание идёт'
                        : socket.connected
                          ? 'подключение к распознаванию…'
                          : 'переподключение…'}
                  </span>
                )}
              </div>
              {isLive && socket.transcriptNotice && (
                <p className="text-[11.5px] text-muted-foreground">{socket.transcriptNotice}</p>
              )}
              <TranscriptPane
                live={!!isLive}
                sttStatus={socket.sttStatus}
                partials={isLive ? socket.partials : {}}
                segments={
                  isLive
                    ? socket.segments
                    : (storedSegments ?? []).map((s) => ({
                        seq: s.seq,
                        speaker: s.speaker,
                        text: s.text,
                        startedMs: s.startedMs,
                        endedMs: s.endedMs,
                      }))
                }
              />
            </CardContent>
          </Card>
        )}
        </div>
      </div>

      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => !deleteSession.isPending && setDeleteOpen(o)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isDraft
                ? 'Удалить черновик скрининга?'
                : isLive
                  ? 'Удалить идущую встречу?'
                  : 'Удалить интервью?'}
            </DialogTitle>
            <DialogDescription>
              {isDraft
                ? 'Черновик будет удалён без возможности восстановления.'
                : isLive
                  ? 'Запись и данные будут удалены безвозвратно.'
                  : 'Запись, транскрипт и отчёт будут удалены безвозвратно.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteSession.isPending}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={deleteSession.isPending}
              onClick={async () => {
                if (!session) return;
                try {
                  await deleteSession.mutateAsync(session.id);
                  setDeleteOpen(false);
                  toast.success(isDraft ? 'Черновик удалён' : 'Интервью удалено');
                  navigate({ to: '/video-interviews' });
                } catch {
                  toast.error(
                    isDraft
                      ? 'Не удалось удалить черновик'
                      : 'Не удалось удалить интервью',
                  );
                }
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {deleteSession.isPending ? 'Удаление…' : 'Удалить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
