/**
 * Захват звука скрининга: микрофон рекрутера + звук вкладки Телемоста.
 *
 * Этап 1 — локальная запись (MediaRecorder на смикшированном потоке) → S3.
 * Этап 2 — параллельно AudioWorklet ресемплирует каждую дорожку в PCM16
 * mono 16 кГц и отдаёт фреймы (~100 мс) через onPcmFrame для WS → STT.
 *
 * Ограничения:
 * - только Chromium (Chrome / Яндекс Браузер / Edge);
 * - Телемост во вкладке, не в desktop-приложении;
 * - в диалоге выбора — галка «Поделиться звуком вкладки».
 */

const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600; // 100 мс при 16 кГц

const WORKLET_CODE = `
class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.acc = [];
    this.accLen = 0;
    this.chunk = ${CHUNK_SAMPLES};
    this.target = ${TARGET_RATE};
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || !input[0].length) return true;
    const ch = input[0];
    const ratio = sampleRate / this.target;
    const outLen = Math.floor(ch.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) out[i] = ch[Math.floor(i * ratio)];
    if (out.length) { this.acc.push(Float32Array.from(out)); this.accLen += out.length; }
    while (this.accLen >= this.chunk) {
      const flat = new Float32Array(this.accLen);
      let o = 0;
      for (const a of this.acc) { flat.set(a, o); o += a.length; }
      const piece = flat.subarray(0, this.chunk);
      const rest = flat.subarray(this.chunk);
      const pcm = new Int16Array(piece.length);
      let level = 0;
      for (let i = 0; i < piece.length; i++) {
        const s = Math.max(-1, Math.min(1, piece[i]));
        pcm[i] = s * 0x7fff;
        level = Math.max(level, Math.abs(s));
      }
      this.port.postMessage({ pcm: pcm.buffer, level }, [pcm.buffer]);
      this.acc = [Float32Array.from(rest)];
      this.accLen = rest.length;
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

export interface CaptureLevels {
  /** 0..1 — мгновенный пик уровня. */
  mic: number;
  tab: number;
}

export type PcmChannel = 0 | 1;

export interface CaptureCallbacks {
  onLevels?: (levels: CaptureLevels) => void;
  /** Вкладка молчит > 15 сек при активной записи — вероятно, забыли галку звука. */
  onTabSilence?: (silent: boolean) => void;
  onEnded?: () => void;
  /** PCM16LE фрейм (~100 мс) с тегом канала для WS. */
  onPcmFrame?: (channel: PcmChannel, pcm: ArrayBuffer) => void;
}

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
  private worklets: AudioWorkletNode[] = [];
  private workletReady = false;
  private levelsFromWorklet = { mic: 0, tab: 0 };

  constructor(private cb: CaptureCallbacks = {}) {}

  static isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getDisplayMedia &&
      typeof MediaRecorder !== 'undefined' &&
      typeof AudioWorkletNode !== 'undefined'
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
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false },
      ...({ selfBrowserSurface: 'exclude', systemAudio: 'exclude' } as object),
    });
    const audio = stream.getAudioTracks();
    if (!audio.length) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    stream.getVideoTracks().forEach((t) => t.stop());
    this.tabStream = new MediaStream(audio);
    audio[0].addEventListener('ended', () => {
      this.tabStream = null;
      this.cb.onEnded?.();
    });
    return true;
  }

  private async ensureWorklet(ctx: AudioContext): Promise<void> {
    if (this.workletReady) return;
    const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      await ctx.audioWorklet.addModule(url);
      this.workletReady = true;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private attachWorklet(
    ctx: AudioContext,
    stream: MediaStream,
    channel: PcmChannel,
  ): AudioWorkletNode {
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'pcm-worklet');
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      const { pcm, level } = e.data;
      if (channel === 0) this.levelsFromWorklet.mic = level;
      else this.levelsFromWorklet.tab = level;
      this.cb.onPcmFrame?.(channel, pcm);
    };
    src.connect(node);
    // Не в destination — иначе эхо вкладки в колонки.
    this.worklets.push(node);
    return node;
  }

  /** 3. Запись: микс → MediaRecorder + PCM-стрим по каналам для STT. */
  async start(): Promise<void> {
    if (!this.micStream || !this.tabStream) throw new Error('capture_not_ready');
    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    await this.ensureWorklet(this.ctx);
    this.attachWorklet(this.ctx, this.micStream, 0);
    this.attachWorklet(this.ctx, this.tabStream, 1);

    const dest = this.ctx.createMediaStreamDestination();
    const micSrc = this.ctx.createMediaStreamSource(this.micStream);
    const tabSrc = this.ctx.createMediaStreamSource(this.tabStream);
    micSrc.connect(dest);
    tabSrc.connect(dest);

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
    this.recorder.start(5_000);

    this.tabSilentMs = 0;
    this.tabSilenceFlag = false;
    this.levelTimer = window.setInterval(() => this.pollLevels(), 200);
  }

  private peak(analyser: AnalyserNode): number {
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let max = 0;
    for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]!));
    return max;
  }

  private pollLevels(): void {
    const mic = this.analysers.mic
      ? this.peak(this.analysers.mic)
      : this.levelsFromWorklet.mic;
    const tab = this.analysers.tab
      ? this.peak(this.analysers.tab)
      : this.levelsFromWorklet.tab;
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
    for (const n of this.worklets) {
      try {
        n.port.onmessage = null;
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.worklets = [];

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
    this.workletReady = false;
    return blob;
  }
}
