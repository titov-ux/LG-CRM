import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Плеер записи скрининга.
 *
 * MediaRecorder (WebM + timeslice) часто отдаёт файл без Duration → нативный
 * `<audio controls>` держит ползунок в конце при Infinity/NaN. Берём известную
 * длительность сессии как fallback и рисуем свой scrubber.
 */
export function ScreeningAudioPlayer({
  src,
  durationSec,
  className,
}: {
  src: string;
  /** Длительность встречи с бэка — fallback, пока браузер не знает Duration. */
  durationSec?: number | null;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const scrubbing = useRef(false);

  const known = durationSec && durationSec > 0 ? durationSec : 0;
  // Infinity/NaN — типичный MediaRecorder WebM; заниженная finite duration —
  // тоже бывает на чанкованной записи. Тогда берём длительность сессии.
  const mediaOk = Number.isFinite(mediaDuration) && mediaDuration > 0;
  const duration =
    mediaOk && !(known > 0 && mediaDuration < known * 0.85) ? mediaDuration : known;
  const progress = duration > 0 ? Math.min(1, current / duration) : 0;

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setMediaDuration(0);
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const syncDuration = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setMediaDuration(d);
    };
    const onTime = () => {
      if (!scrubbing.current) setCurrent(el.currentTime);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrent(el.duration && Number.isFinite(el.duration) ? el.duration : known);
    };

    el.addEventListener('loadedmetadata', syncDuration);
    el.addEventListener('durationchange', syncDuration);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    syncDuration();

    return () => {
      el.removeEventListener('loadedmetadata', syncDuration);
      el.removeEventListener('durationchange', syncDuration);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
    };
  }, [src, known]);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    try {
      if (el.paused) await el.play();
      else el.pause();
    } catch {
      /* autoplay / abort — игнорируем */
    }
  };

  const seekRatio = (ratio: number) => {
    const el = audioRef.current;
    if (!el || duration <= 0) return;
    const next = Math.max(0, Math.min(duration, ratio * duration));
    try {
      el.currentTime = next;
    } catch {
      /* seek до готовности файла */
    }
    setCurrent(next);
  };

  return (
    <div className={cn('flex items-center gap-2 rounded-md border bg-muted/40 px-2 py-1.5', className)}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => void toggle()}
        aria-label={playing ? 'Пауза' : 'Слушать'}
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <span className="w-10 shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {formatClock(current)}
      </span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(progress * 1000)}
        disabled={duration <= 0}
        aria-label="Позиция в записи"
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground disabled:opacity-50 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
        onPointerDown={() => {
          scrubbing.current = true;
        }}
        onPointerUp={(e) => {
          scrubbing.current = false;
          seekRatio(Number(e.currentTarget.value) / 1000);
        }}
        onChange={(e) => {
          const ratio = Number(e.target.value) / 1000;
          setCurrent(ratio * duration);
          if (!scrubbing.current) seekRatio(ratio);
        }}
      />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {formatClock(duration)}
      </span>
    </div>
  );
}
