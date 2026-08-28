export const MUSIC_SPECTRUM_BANDS = 32;
export const MUSIC_SPECTRUM_MAX_HEIGHT = 140;

export type MusicSpectrumSource = "local" | "system" | "microphone";

export type MusicSpectrumStopReason = "audio-ended" | "capture-ended";

export interface MusicSpectrumStartOptions {
  source: MusicSpectrumSource;
  audioElement?: HTMLAudioElement | null;
  sensitivity?: number;
  smoothing?: number;
  frameRate?: number;
  onFrame: (heights: readonly number[], levels: readonly number[]) => void;
  onEnded?: (reason: MusicSpectrumStopReason) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function spectrumLevelsToHeights(levels: readonly number[]): number[] {
  if (levels.length !== MUSIC_SPECTRUM_BANDS) {
    throw new Error(`音乐频谱需要 ${MUSIC_SPECTRUM_BANDS} 个频段`);
  }
  return levels.map((value) => {
    const level = clamp(Number(value) || 0, 0, 1);
    if (level <= 0.01) return 0;
    const height = Math.round((level ** 0.72) * MUSIC_SPECTRUM_MAX_HEIGHT / 4) * 4;
    return clamp(height, 4, MUSIC_SPECTRUM_MAX_HEIGHT);
  });
}

export class BrowserMusicSpectrumAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private localElement: HTMLAudioElement | null = null;
  private localSource: MediaElementAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private timer: number | null = null;
  private active = false;
  private sensitivity = 1;
  private smoothing = 0.62;
  private previousLevels = new Array<number>(MUSIC_SPECTRUM_BANDS).fill(0);
  private localEndedHandler: (() => void) | null = null;
  private captureEndedHandler: (() => void) | null = null;
  private onEnded: ((reason: MusicSpectrumStopReason) => void) | null = null;

  get running(): boolean {
    return this.active;
  }

  setSensitivity(value: number): void {
    this.sensitivity = clamp(Number(value) || 1, 0.5, 2.5);
  }

  setSmoothing(value: number): void {
    this.smoothing = clamp(Number(value) || 0, 0, 0.95);
    if (this.analyser) {
      this.analyser.smoothingTimeConstant = 0.15 + this.smoothing * 0.75;
    }
  }

  private ensureAudioGraph(): { context: AudioContext; analyser: AnalyserNode } {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: "interactive" });
    }
    if (!this.analyser) {
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.minDecibels = -72;
      this.analyser.maxDecibels = -12;
    }
    this.setSmoothing(this.smoothing);
    return { context: this.context, analyser: this.analyser };
  }

  private disconnectCurrentSource(pauseLocal: boolean): void {
    if (this.localEndedHandler && this.localElement) {
      this.localElement.removeEventListener("ended", this.localEndedHandler);
    }
    this.localEndedHandler = null;
    if (pauseLocal) this.localElement?.pause();
    try {
      this.localSource?.disconnect();
    } catch {
      // The source may already be disconnected.
    }

    if (this.captureEndedHandler && this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener("ended", this.captureEndedHandler);
      }
    }
    this.captureEndedHandler = null;
    try {
      this.streamSource?.disconnect();
    } catch {
      // The source may already be disconnected.
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.streamSource = null;
    try {
      this.analyser?.disconnect();
    } catch {
      // The analyser may already be disconnected.
    }
  }

  stop(pauseLocal = true): void {
    this.active = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.disconnectCurrentSource(pauseLocal);
    this.previousLevels.fill(0);
    this.onEnded = null;
  }

  async dispose(): Promise<void> {
    this.stop(true);
    const context = this.context;
    this.context = null;
    this.analyser = null;
    this.localElement = null;
    this.localSource = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }

  private handleNaturalEnd(reason: MusicSpectrumStopReason): void {
    if (!this.active) return;
    const callback = this.onEnded;
    this.stop(reason !== "audio-ended");
    callback?.(reason);
  }

  private async connectLocalAudio(
    context: AudioContext,
    analyser: AnalyserNode,
    audio: HTMLAudioElement,
  ): Promise<void> {
    if (this.localSource && this.localElement !== audio) {
      throw new Error("本地播放器已变更，请刷新页面后重试");
    }
    if (!this.localSource) {
      this.localElement = audio;
      this.localSource = context.createMediaElementSource(audio);
    }
    this.localSource.connect(analyser);
    analyser.connect(context.destination);
    this.localEndedHandler = () => this.handleNaturalEnd("audio-ended");
    audio.addEventListener("ended", this.localEndedHandler, { once: true });
    if (audio.ended) audio.currentTime = 0;
    await audio.play();
  }

  private async captureStream(source: Exclude<MusicSpectrumSource, "local">): Promise<MediaStream> {
    if (!navigator.mediaDevices) {
      throw new Error("当前浏览器不支持音频采集，请使用最新版 Edge 或 Chrome");
    }
    if (source === "microphone") {
      return navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
        video: false,
      });
    }
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error("当前浏览器不支持系统音频共享");
    }
    const options = {
      video: true,
      audio: true,
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude",
    } as DisplayMediaStreamOptions;
    const stream = await navigator.mediaDevices.getDisplayMedia(options);
    if (stream.getAudioTracks().length === 0) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error("没有获取到系统声音，请重新选择并勾选“共享系统音频”");
    }
    return stream;
  }

  private sample(onFrame: MusicSpectrumStartOptions["onFrame"]): void {
    const analyser = this.analyser;
    const context = this.context;
    if (!this.active || !analyser || !context) return;
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(frequencyData);
    const resolution = context.sampleRate / analyser.fftSize;
    const maxHz = Math.min(16000, context.sampleRate * 0.48);
    const minHz = 55;
    const levels = new Array<number>(MUSIC_SPECTRUM_BANDS).fill(0);
    for (let band = 0; band < MUSIC_SPECTRUM_BANDS; band += 1) {
      const lowHz = minHz * ((maxHz / minHz) ** (band / MUSIC_SPECTRUM_BANDS));
      const highHz = minHz * ((maxHz / minHz) ** ((band + 1) / MUSIC_SPECTRUM_BANDS));
      const start = clamp(Math.floor(lowHz / resolution), 0, frequencyData.length - 1);
      const end = clamp(Math.ceil(highHz / resolution), start + 1, frequencyData.length);
      let peak = 0;
      for (let index = start; index < end; index += 1) peak = Math.max(peak, frequencyData[index]);
      const target = clamp((peak / 255) * this.sensitivity, 0, 1);
      const previous = this.previousLevels[band];
      const attack = 0.72 - this.smoothing * 0.2;
      const release = 0.34 - this.smoothing * 0.23;
      levels[band] = previous + (target - previous) * (target > previous ? attack : release);
    }
    this.previousLevels = levels;
    onFrame(spectrumLevelsToHeights(levels), levels);
  }

  async start(options: MusicSpectrumStartOptions): Promise<void> {
    this.stop(false);
    this.setSensitivity(options.sensitivity ?? 1);
    this.setSmoothing(options.smoothing ?? 0.62);
    this.onEnded = options.onEnded ?? null;
    const { context, analyser } = this.ensureAudioGraph();
    await context.resume();

    try {
      if (options.source === "local") {
        if (!options.audioElement?.src) {
          throw new Error("请先选择本地音乐文件");
        }
        await this.connectLocalAudio(context, analyser, options.audioElement);
      } else {
        this.stream = await this.captureStream(options.source);
        this.streamSource = context.createMediaStreamSource(this.stream);
        this.streamSource.connect(analyser);
        this.captureEndedHandler = () => this.handleNaturalEnd("capture-ended");
        for (const track of this.stream.getTracks()) {
          track.addEventListener("ended", this.captureEndedHandler, { once: true });
        }
      }
      this.active = true;
      const frameRate = clamp(Math.round(options.frameRate ?? 30), 15, 60);
      this.timer = window.setInterval(
        () => this.sample(options.onFrame),
        Math.max(16, Math.round(1000 / frameRate)),
      );
      this.sample(options.onFrame);
    } catch (error) {
      this.stop(false);
      throw error;
    }
  }
}
