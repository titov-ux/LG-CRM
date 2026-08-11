/**
 * Захват звука скрининга: микрофон рекрутера + звук вкладки Телемоста.
 *
 * Этап 1 — только локальная запись (MediaRecorder на смикшированном потоке)
 * с последующей выгрузкой в S3. На Этапе 2 сюда добавится AudioWorklet с
 * PCM16-стримом по WebSocket (см. spikes/screening/capture_prototype.html).
 *
 * Ограничения (задокументированы в плане):
 * - только Chromium-браузеры (Chrome / Яндекс Браузер / Edge);
 * - Телемост должен быть открыт во ВКЛАДКЕ того же браузера, не в приложении;
 * - в диалоге выбора нужно выбрать вкладку и включить «Поделиться звуком вкладки».
 */

/** Канал PCM-стрима: 0 = рекрутер/микрофон, 1 = кандидат/звук вкладки. */
export type PcmChannel = 0 | 1;

export interface CaptureLevels {
  /** 0..1 — мгновенный пик уровня. */
  mic: number;
  tab: number;
}

export interface CaptureCallbacks {
  onLevels?: (levels: CaptureLevels) => void;
  /** Вкладка молчит > 15 сек при активной записи — вероятно, забыли галку звука. */
  onTabSilence?: (silent: boolean) => void;
  onEnded?: () => void;
  /**
   * PCM16LE 16 кГц фрейм (~100 мс) для realtime-транскрипции (Этап 2).
   * channel: 0 = рекрутер/микрофон, 1 = кандидат/вкладка. Если колбэк не
   * задан — worklet-ы не создаются, работает только локальная запись.
   */
  onFrame?: (channel: PcmChannel, pcm: ArrayBuffer) => void;
}

/**
 * Человеческое сообщение по ошибке getUserMedia / getDisplayMedia.
 * `null` — пользователь просто закрыл диалог выбора (ругаться не надо).
 */
export function describeCaptureError(e: unknown): string | null {
  const err = e as { name?: string; message?: string } | null;
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'AbortError') return null;
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Устройство не найдено — проверьте микрофон в настройках системы';
  }
  if (name === 'NotReadableError') {
    return 'Устройство занято другим приложением — закройте его и попробуйте снова';
  }
  if (name === 'NotSupportedError') {
    return 'Браузер не поддерживает захват звука вкладки — откройте CRM в Chrome';
  }
  return err?.message ? `Не удалось начать захват: ${err.message}` : 'Не удалось начать захват';
}

/** Причина, по которой захват недоступен в этом браузере (или null, если всё ок). */
export function captureSupportIssue(): string | null {
  if (ScreeningCapture.isSupported()) return null;
  return 'Захват звука вкладки работает только в Chromium-браузерах (Chrome, Яндекс Браузер, Edge). Откройте раздел в одном из них.';
}

/**
 * AudioWorklet-даунсемплер: любые sampleRate → 16 кГц mono PCM16, чанки
 * ~100 мс. Инлайн-код через blob-URL (важно: НЕ работает с file://, только
 * http(s) — проверено на спайке Этапа 0).
 */
const PCM_WORKLET = `
class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = [];
    this.accLen = 0;
    this.chunk = 1600; // 100 мс @ 16кГц
    this.pos = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];
    const out = [];
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = ch[i], b = ch[Math.min(i + 1, ch.length - 1)];
      out.push(a + (b - a) * frac);
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    if (out.length) { this.acc.push(Float32Array.from(out)); this.accLen += out.length; }
    while (this.accLen >= this.chunk) {
      const flat = new Float32Array(this.accLen);
      let o = 0;
      for (const a of this.acc) { flat.set(a, o); o += a.length; }
      const piece = flat.subarray(0, this.chunk);
      const rest = flat.subarray(this.chunk);
      const pcm = new Int16Array(piece.length);
      for (let i = 0; i < piece.length; i++) {
        const s = Math.max(-1, Math.min(1, piece[i]));
        pcm[i] = s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this.acc = [Float32Array.from(rest)];
      this.accLen = rest.length;
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

/** Порог «вкладка молчит» и таймаут ожидания финального блоба MediaRecorder. */
const TAB_SILENCE_MS = 15_000;
const RECORDER_STOP_TIMEOUT_MS = 10_000;

export class ScreeningCapture {
  private micStream: MediaStream | null = null;
  private tabStream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private levelTimer: number | null = null;
  /** Момент последнего звука со вкладки (Date.now()); null — ещё не считаем. */
  private tabLastSoundAt: number | null = null;
  private tabSilenceFlag = false;
  private analysers: { mic?: AnalyserNode; tab?: AnalyserNode } = {};
  private tabTrack: MediaStreamTrack | null = null;
  private onTabEnded: (() => void) | null = null;
  private workletUrl: string | null = null;
  /** Узлы аудиографа — нужны, чтобы пересобрать канал вкладки на ходу. */
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sources: { mic?: MediaStreamAudioSourceNode; tab?: MediaStreamAudioSourceNode } = {};
  private worklets: { mic?: AudioWorkletNode; tab?: AudioWorkletNode } = {};
  /** Модуль pcm-worklet уже добавлен в текущий AudioContext. */
  private workletReady = false;

  constructor(private cb: CaptureCallbacks = {}) {}

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getDisplayMedia &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  get hasMic(): boolean {
    return !!this.micStream;
  }

  get hasTab(): boolean {
    return !!this.tabStream;
  }

  get isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** 1. Микрофон рекрутера. Повторный вызов освобождает предыдущий стрим. */
  async requestMic(): Promise<void> {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  }

  /**
   * 2. Звук вкладки Телемоста. Возвращает false, если пользователь выбрал
   * источник без аудио (не поставил галку «Поделиться звуком вкладки»).
   */
  async requestTab(): Promise<boolean> {
    // Повторный выбор вкладки: гасим прошлые дорожки, иначе Chrome оставляет
    // висеть «плашку шаринга» от предыдущего источника.
    this.detachTabEnded();
    this.tabStream?.getTracks().forEach((t) => t.stop());
    this.tabStream = null;
    // video:true обязателен — иначе Chrome не покажет пикер вкладок.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false },
      // Подсказки Chromium: сразу вкладки, свою скрыть, системный звук не предлагать.
      // (нестандартные поля — приводим через as)
      ...({ selfBrowserSurface: 'exclude', systemAudio: 'exclude' } as object),
    });
    const audio = stream.getAudioTracks();
    if (!audio.length) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    // Видео на Этапе 1 не нужно — останавливаем, остаётся только звук.
    stream.getVideoTracks().forEach((t) => t.stop());
    this.tabStream = new MediaStream(audio);
    // Пользователь может остановить шаринг из «плашки» Chrome.
    this.tabTrack = audio[0];
    this.onTabEnded = () => {
      // Снимаем слушатель и гасим дорожки: иначе Chrome держит «плашку
      // шаринга», а MediaStream остаётся висеть до перезагрузки страницы.
      this.detachTabEnded();
      this.tabStream?.getTracks().forEach((t) => t.stop());
      this.tabStream = null;
      this.cb.onEnded?.();
    };
    this.tabTrack.addEventListener('ended', this.onTabEnded);
    // Выбор вкладки заново посреди записи: граф уже построен на старом
    // источнике, поэтому пересобираем канал 1 — иначе в запись и в STT идёт
    // только микрофон, а UI показывает «вкладка подключена».
    if (this.ctx) this.replaceTab(this.tabStream);
    return true;
  }

  private detachTabEnded(): void {
    if (this.tabTrack && this.onTabEnded) {
      this.tabTrack.removeEventListener('ended', this.onTabEnded);
    }
    this.tabTrack = null;
    this.onTabEnded = null;
  }

  /** 3. Запись: микс двух дорожек → MediaRecorder (audio/webm;opus). */
  async start(): Promise<void> {
    if (!this.micStream || !this.tabStream) throw new Error('capture_not_ready');
    // Идемпотентность: если прошлый запуск упал на полпути (или запись уже
    // идёт), второй AudioContext поверх первого дал бы дублирование PCM и
    // утечку. Дорожки не трогаем — их разрешение переиспользуем.
    if (this.ctx) await this.disposeGraph();
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      // Chrome стартует контекст в состоянии suspended, если вкладка не в фокусе
      // (а во время интервью вкладка скрининга как раз фоновая).
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => undefined);
      }
      const dest = ctx.createMediaStreamDestination();
      this.dest = dest;

      const micSrc = ctx.createMediaStreamSource(this.micStream);
      const tabSrc = ctx.createMediaStreamSource(this.tabStream);
      this.sources.mic = micSrc;
      this.sources.tab = tabSrc;
      micSrc.connect(dest);
      tabSrc.connect(dest);
      // ВАЖНО: к ctx.destination НЕ подключаем — иначе звук вкладки пойдёт в
      // колонки вторым потоком (эхо).

      // PCM-стрим для realtime-транскрипции: по worklet-у на канал.
      if (this.cb.onFrame) {
        const blobUrl = URL.createObjectURL(
          new Blob([PCM_WORKLET], { type: 'application/javascript' }),
        );
        this.workletUrl = blobUrl;
        try {
          await ctx.audioWorklet.addModule(blobUrl);
          this.workletReady = true;
        } finally {
          // Модуль уже скомпилирован — держать blob в памяти незачем.
          URL.revokeObjectURL(blobUrl);
          this.workletUrl = null;
        }
        this.worklets.mic = this.attachWorklet(micSrc, 0);
        this.worklets.tab = this.attachWorklet(tabSrc, 1);
      }

      this.analysers.mic = ctx.createAnalyser();
      this.analysers.tab = ctx.createAnalyser();
      this.analysers.mic.fftSize = 512;
      this.analysers.tab.fftSize = 512;
      micSrc.connect(this.analysers.mic);
      tabSrc.connect(this.analysers.tab);

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      this.chunks = [];
      this.recorder = new MediaRecorder(dest.stream, {
        mimeType: mime,
        audioBitsPerSecond: 64_000,
      });
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      this.recorder.start(5_000); // чанк каждые 5с — запись переживает краш вкладки

      this.tabLastSoundAt = Date.now();
      this.tabSilenceFlag = false;
      this.levelTimer = window.setInterval(() => this.pollLevels(), 200);
    } catch (e) {
      // Полусобранный граф оставлять нельзя — следующий start() начнёт с нуля.
      await this.disposeGraph();
      throw e;
    }
  }

  /** worklet только «слушает» источник и шлёт PCM16 наверх — в граф не выводится. */
  private attachWorklet(src: MediaStreamAudioSourceNode, channel: PcmChannel): AudioWorkletNode {
    const node = new AudioWorkletNode(this.ctx as AudioContext, 'pcm-worklet');
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => this.cb.onFrame?.(channel, e.data);
    src.connect(node);
    return node;
  }

  /**
   * Пересборка канала 1 (звук вкладки) в уже работающем графе: старые узлы
   * снимаем, новый источник подключаем к dest / analyser / worklet.
   */
  private replaceTab(stream: MediaStream): void {
    const ctx = this.ctx;
    if (!ctx || !this.dest) return;
    this.disconnectTab();
    const src = ctx.createMediaStreamSource(stream);
    this.sources.tab = src;
    src.connect(this.dest);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    this.analysers.tab = analyser;
    src.connect(analyser);
    if (this.cb.onFrame && this.workletReady) {
      this.worklets.tab = this.attachWorklet(src, 1);
    }
    // Источник новый — счётчик тишины начинаем заново.
    this.tabLastSoundAt = Date.now();
    if (this.tabSilenceFlag) {
      this.tabSilenceFlag = false;
      this.cb.onTabSilence?.(false);
    }
  }

  /** Снять узлы канала 1 со старого источника. */
  private disconnectTab(): void {
    const worklet = this.worklets.tab;
    if (worklet) {
      worklet.port.onmessage = null;
      try {
        worklet.disconnect();
      } catch {
        /* ignore */
      }
      this.worklets.tab = undefined;
    }
    try {
      this.sources.tab?.disconnect();
      this.analysers.tab?.disconnect();
    } catch {
      /* ignore */
    }
    this.sources.tab = undefined;
    this.analysers.tab = undefined;
  }

  /**
   * Снос аудиографа (узлы, рекордер, таймер, AudioContext) БЕЗ освобождения
   * дорожек: разрешение на микрофон/вкладку переиспользуется повторным start().
   */
  private async disposeGraph(): Promise<void> {
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    this.disconnectTab();
    const micWorklet = this.worklets.mic;
    if (micWorklet) {
      micWorklet.port.onmessage = null;
      try {
        micWorklet.disconnect();
      } catch {
        /* ignore */
      }
      this.worklets.mic = undefined;
    }
    try {
      this.sources.mic?.disconnect();
      this.analysers.mic?.disconnect();
    } catch {
      /* ignore */
    }
    this.sources.mic = undefined;
    this.analysers.mic = undefined;
    this.dest = null;
    this.workletReady = false;
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    const ctx = this.ctx;
    this.ctx = null;
    await ctx?.close().catch(() => undefined);
  }

  private peak(analyser: AnalyserNode): number {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let max = 0;
    for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
    return max;
  }

  private pollLevels(): void {
    if (!this.analysers.mic || !this.analysers.tab) return;
    const mic = this.peak(this.analysers.mic);
    const tab = this.peak(this.analysers.tab);
    this.cb.onLevels?.({ mic, tab });

    // ВАЖНО: считаем по реальному времени, а не по числу тиков — вкладка
    // скрининга фоновая, и браузер троттлит setInterval до ~1 раза в секунду.
    const now = Date.now();
    if (tab > 0.005 || this.tabLastSoundAt === null) this.tabLastSoundAt = now;
    const silent = now - this.tabLastSoundAt > TAB_SILENCE_MS;
    if (silent !== this.tabSilenceFlag) {
      this.tabSilenceFlag = silent;
      this.cb.onTabSilence?.(silent);
    }
  }

  /** 4. Стоп: возвращает готовый Blob записи (audio/webm). */
  async stop(): Promise<Blob | null> {
    if (this.levelTimer !== null) {
      clearInterval(this.levelTimer);
      this.levelTimer = null;
    }
    const recorder = this.recorder;
    let blob: Blob | null = null;
    if (recorder && recorder.state !== 'inactive') {
      // onstop может не прийти вовсе (баг браузера, отвал дорожки) — тогда
      // отдаём то, что уже накопили в chunks, но не подвешиваем UI навсегда.
      blob = await new Promise<Blob | null>((resolve) => {
        let settled = false;
        const collect = () =>
          new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        const done = (value: Blob | null) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(value);
        };
        const timer = window.setTimeout(
          () => done(this.chunks.length ? collect() : null),
          RECORDER_STOP_TIMEOUT_MS,
        );
        recorder.onstop = () => done(collect());
        recorder.onerror = () => done(this.chunks.length ? collect() : null);
        try {
          recorder.stop();
        } catch {
          done(this.chunks.length ? collect() : null);
        }
      });
    } else if (this.chunks.length) {
      blob = new Blob(this.chunks, { type: 'audio/webm' });
    }
    this.recorder = null;
    this.detachTabEnded();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.tabStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.tabStream = null;
    await this.disposeGraph();
    return blob;
  }
}
