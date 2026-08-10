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
  onFrame?: (channel: 0 | 1, pcm: ArrayBuffer) => void;
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

export class ScreeningCapture {
  private micStream: MediaStream | null = null;
  private tabStream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private levelTimer: number | null = null;
  private tabSilentMs = 0;
  private tabSilenceFlag = false;
  private analysers: { mic?: AnalyserNode; tab?: AnalyserNode } = {};

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

  /** 1. Микрофон рекрутера. */
  async requestMic(): Promise<void> {
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  }

  /**
   * 2. Звук вкладки Телемоста. Возвращает false, если пользователь выбрал
   * источник без аудио (не поставил галку «Поделиться звуком вкладки»).
   */
  async requestTab(): Promise<boolean> {
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
    audio[0].addEventListener('ended', () => {
      this.tabStream = null;
      this.cb.onEnded?.();
    });
    return true;
  }

  /** 3. Запись: микс двух дорожек → MediaRecorder (audio/webm;opus). */
  async start(): Promise<void> {
    if (!this.micStream || !this.tabStream) throw new Error('capture_not_ready');
    this.ctx = new AudioContext();
    const dest = this.ctx.createMediaStreamDestination();

    const micSrc = this.ctx.createMediaStreamSource(this.micStream);
    const tabSrc = this.ctx.createMediaStreamSource(this.tabStream);
    micSrc.connect(dest);
    tabSrc.connect(dest);
    // ВАЖНО: к ctx.destination НЕ подключаем — иначе звук вкладки пойдёт в
    // колонки вторым потоком (эхо).

    // PCM-стрим для realtime-транскрипции: по worklet-у на канал.
    if (this.cb.onFrame) {
      const blobUrl = URL.createObjectURL(
        new Blob([PCM_WORKLET], { type: 'application/javascript' }),
      );
      await this.ctx.audioWorklet.addModule(blobUrl);
      const attach = (src: MediaStreamAudioSourceNode, channel: 0 | 1) => {
        const node = new AudioWorkletNode(this.ctx as AudioContext, 'pcm-worklet');
        node.port.onmessage = (e: MessageEvent<ArrayBuffer>) =>
          this.cb.onFrame?.(channel, e.data);
        src.connect(node);
        // worklet не соединяем с destination — он только «слушает».
      };
      attach(micSrc, 0);
      attach(tabSrc, 1);
    }

    this.analysers.mic = this.ctx.createAnalyser();
    this.analysers.tab = this.ctx.createAnalyser();
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

    this.tabSilentMs = 0;
    this.tabSilenceFlag = false;
    this.levelTimer = window.setInterval(() => this.pollLevels(), 200);
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

    this.tabSilentMs = tab > 0.005 ? 0 : this.tabSilentMs + 200;
    const silent = this.tabSilentMs > 15_000;
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
      blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () =>
          resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
        recorder.stop();
      });
    } else if (this.chunks.length) {
      blob = new Blob(this.chunks, { type: 'audio/webm' });
    }
    this.recorder = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.tabStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.tabStream = null;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    return blob;
  }
}
