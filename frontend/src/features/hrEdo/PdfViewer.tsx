/**
 * Просмотр PDF через pdfjs-dist (canvas по страницам).
 *
 * Работает одинаково на iOS Safari / Android Chrome, где встроенный просмотр
 * PDF в iframe ненадёжен. `onReachEnd` вызывается, когда пользователь
 * прокрутил документ до конца — от этого зависит кнопка «Подписать».
 * pdfjs и worker грузятся лениво с нашего домена (как в extractPdfText).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PdfPageProxy {
  getViewport(args: { scale: number }): { width: number; height: number };
  render(args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
}
interface PdfDocProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(args: { data: ArrayBuffer }): { promise: Promise<PdfDocProxy> };
}

let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [mod, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJs>,
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
      ]);
      mod.GlobalWorkerOptions.workerSrc = worker.default;
      return mod;
    })().catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

export function PdfViewer({
  load,
  onReachEnd,
  className,
}: {
  /** Загрузчик байтов (через API с правами/сессией). */
  load: () => Promise<Blob>;
  onReachEnd?: () => void;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const reachedRef = useRef(false);
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  useEffect(() => {
    let cancelled = false;
    let doc: PdfDocProxy | null = null;
    reachedRef.current = false;
    setState('loading');
    (async () => {
      try {
        const [pdfjs, blob] = await Promise.all([loadPdfJs(), load()]);
        if (cancelled) return;
        doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        const host = pagesRef.current;
        if (!host || cancelled) return;
        host.innerHTML = '';
        const width = Math.min(host.clientWidth || 800, 900);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let i = 1; i <= doc.numPages; i += 1) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const scale = (width / base.width) * dpr;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          canvas.style.height = `${viewport.height / dpr}px`;
          canvas.className = 'mx-auto block max-w-full rounded-sm bg-white shadow-sm ring-1 ring-border';
          host.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setState('ready');
      } catch (err) {
        console.error('pdf render failed', err);
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy();
    };
    // load — новая функция на каждый рендер у вызывающих; перезагружаем по ключу-компоненту.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== 'ready' || !endRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !reachedRef.current) {
          reachedRef.current = true;
          onReachEndRef.current?.();
        }
      },
      { root: scrollRef.current, threshold: 0.1 },
    );
    obs.observe(endRef.current);
    return () => obs.disconnect();
  }, [state]);

  return (
    <div ref={scrollRef} className={cn('overflow-auto rounded-md bg-muted/40 p-2 sm:p-3', className)}>
      {state === 'loading' && (
        <div className="flex h-48 items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем документ…
        </div>
      )}
      {state === 'error' && (
        <div className="flex h-48 items-center justify-center px-4 text-center text-[12.5px] text-muted-foreground">
          Не удалось показать документ. Проверьте соединение и откройте его ещё раз.
        </div>
      )}
      <div ref={pagesRef} className="space-y-3" />
      <div ref={endRef} className="h-2" aria-hidden />
    </div>
  );
}
