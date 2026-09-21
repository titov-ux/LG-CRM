import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Статус доступа к веб-камере на форме входа.
 * Совпадает по смыслу с backend `SnapshotStatus`, кроме `ok` — он выставляется
 * только по факту удачного кадра при отправке (см. capture()).
 */
export type CameraStatus = 'starting' | 'ready' | 'denied' | 'no_camera' | 'error';

/** Причина, отправляемая на бэк, когда кадр получить не удалось. */
export type SnapshotReason = 'denied' | 'no_camera' | 'error';

export interface LoginCamera {
  videoRef: React.RefObject<HTMLVideoElement>;
  status: CameraStatus;
  /** true, если превью живое и можно снимать кадр. */
  ready: boolean;
  /**
   * Снять текущий кадр. Возвращает JPEG-Blob либо null, если камера не готова
   * или отрисовать кадр не удалось.
   */
  capture: () => Promise<Blob | null>;
  /** Причина отсутствия кадра для журнала (когда ready=false). */
  reason: SnapshotReason;
}

function mapGetUserMediaError(err: unknown): Exclude<CameraStatus, 'starting' | 'ready'> {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
    return 'no_camera';
  return 'error';
}

/**
 * Управляет потоком веб-камеры на странице логина: запрашивает доступ,
 * показывает живое превью (прозрачность сбора — сотрудник видит, что делается
 * снимок) и умеет снять один кадр в JPEG.
 *
 * Поток останавливается при размонтировании — камера не «висит» после входа.
 */
export function useLoginCamera(enabled = true): LoginCamera {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('starting');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('no_camera');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          // play() может отклониться, если элемент ещё не в DOM — не критично.
          void videoRef.current.play().catch(() => undefined);
        }
        setStatus('ready');
      } catch (err) {
        if (!cancelled) setStatus(mapGetUserMediaError(err));
      }
    }

    void start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enabled]);

  const capture = useCallback(async (): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || status !== 'ready') return null;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
  }, [status]);

  const reason: SnapshotReason =
    status === 'denied' ? 'denied' : status === 'no_camera' ? 'no_camera' : 'error';

  return { videoRef, status, ready: status === 'ready', capture, reason };
}
