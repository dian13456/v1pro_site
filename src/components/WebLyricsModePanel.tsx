import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  canvasToRgb565,
  parseLrcText,
  readLrcFile,
  renderAppleLyricsCanvas,
  searchOnlineLyrics,
  type BrowserLrcDocument,
} from "../services/browserLyricsService";
import type { V1ProWebTransferClient } from "../types/v1proWebTransfer";

interface WebLyricsModePanelProps {
  disabled: boolean;
  hasSelectedDevice: boolean;
  acquireClient: () => Promise<V1ProWebTransferClient>;
  releaseClient: (client: V1ProWebTransferClient) => Promise<void>;
  onModeStateChange: (active: boolean, starting: boolean) => void;
  stopHandlerRef: MutableRefObject<(message?: string) => Promise<void>>;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/claimInterface|claim interface|Unable to claim|LIBUSB_ERROR_BUSY/i.test(message)) {
    return "USB 接口被本地软件占用，请关闭本地软件后重试！";
  }
  return message;
}

function cleanSongName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
}

export function WebLyricsModePanel({
  disabled,
  hasSelectedDevice,
  acquireClient,
  releaseClient,
  onModeStateChange,
  stopHandlerRef,
}: WebLyricsModePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef("");
  const activeRef = useRef(false);
  const startingRef = useRef(false);
  const stoppingRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const clientRef = useRef<V1ProWebTransferClient | null>(null);
  const sendBusyRef = useRef(false);
  const sendPromiseRef = useRef<Promise<void> | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const lastPositionRef = useRef(-1);
  const lastLineIndexRef = useRef(-2);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [lrcFile, setLrcFile] = useState<File | null>(null);
  const [document, setDocument] = useState<BrowserLrcDocument | null>(null);
  const [songName, setSongName] = useState("");
  const [artist, setArtist] = useState("");
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("选择本地音乐和 LRC，或输入歌名在线查词。");
  const [currentLyric, setCurrentLyric] = useState("等待歌词");

  const notifyModeState = useCallback((nextActive: boolean, nextStarting: boolean) => {
    activeRef.current = nextActive;
    startingRef.current = nextStarting;
    if (mountedRef.current) {
      setActive(nextActive);
      setStarting(nextStarting);
      onModeStateChange(nextActive, nextStarting);
    }
  }, [onModeStateChange]);

  const drawCurrentFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !document) return null;
    const state = renderAppleLyricsCanvas(
      canvas,
      document,
      audio?.currentTime || 0,
      audio?.duration && Number.isFinite(audio.duration) ? audio.duration : 0,
    );
    if (state.index !== lastLineIndexRef.current) {
      lastLineIndexRef.current = state.index;
      if (mountedRef.current) setCurrentLyric(state.current);
    }
    return state;
  }, [document]);

  const stopLyricsMode = useCallback(async (
    stopMessage = "歌词模式已停止，USB 已释放。",
  ) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    generationRef.current += 1;
    notifyModeState(false, false);
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    audioRef.current?.pause();
    const client = clientRef.current;
    clientRef.current = null;
    let detail = "";
    try {
      await sendPromiseRef.current?.catch(() => undefined);
      sendPromiseRef.current = null;
      sendBusyRef.current = false;
      await client?.stopLiveMode();
    } catch (error) {
      detail = errorMessage(error);
    } finally {
      if (client) await releaseClient(client);
      stoppingRef.current = false;
      if (mountedRef.current) {
        setMessage(detail ? `${stopMessage}（退出命令：${detail}）` : stopMessage);
      }
    }
  }, [notifyModeState, releaseClient]);

  useEffect(() => {
    stopHandlerRef.current = stopLyricsMode;
  }, [stopHandlerRef, stopLyricsMode]);

  useEffect(() => {
    drawCurrentFrame();
  }, [drawCurrentFrame]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => audio?.pause();
  }, [audioUrl]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeRef.current = false;
      startingRef.current = false;
      generationRef.current += 1;
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      const client = clientRef.current;
      clientRef.current = null;
      void (async () => {
        await sendPromiseRef.current?.catch(() => undefined);
        try { await client?.stopLiveMode(); } catch { /* USB close is final cleanup. */ }
        if (client) await releaseClient(client);
      })();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, [releaseClient]);

  const submitFrame = useCallback(() => {
    if (!activeRef.current || sendBusyRef.current) return;
    const canvas = canvasRef.current;
    const client = clientRef.current;
    if (!canvas || !client?.connected) return;
    sendBusyRef.current = true;
    let pixels: Uint8Array;
    try {
      pixels = canvasToRgb565(canvas);
    } catch (error) {
      sendBusyRef.current = false;
      setMessage(errorMessage(error));
      return;
    }
    const pending = client.sendLiveFrame(pixels);
    sendPromiseRef.current = pending;
    void pending
      .catch((error) => {
        if (mountedRef.current) setMessage(`歌词画面发送失败：${errorMessage(error)}`);
        void stopHandlerRef.current("歌词模式因 USB 通信失败而停止，句柄已释放。");
      })
      .finally(() => {
        if (sendPromiseRef.current === pending) sendPromiseRef.current = null;
        sendBusyRef.current = false;
      });
  }, [stopHandlerRef]);

  const runFrameLoop = useCallback((now: number) => {
    if (!activeRef.current) return;
    const audio = audioRef.current;
    const position = audio?.currentTime || 0;
    const changed = Math.abs(position - lastPositionRef.current) >= 0.025;
    if (changed && now - lastFrameAtRef.current >= 100) {
      lastFrameAtRef.current = now;
      lastPositionRef.current = position;
      drawCurrentFrame();
      submitFrame();
    }
    animationRef.current = requestAnimationFrame(runFrameLoop);
  }, [drawCurrentFrame, submitFrame]);

  const handleAudioFile = (file: File | null) => {
    if (activeRef.current || startingRef.current) return;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
    setAudioFile(file);
    setAudioUrl("");
    if (!file) return;
    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    setAudioUrl(url);
    const inferred = cleanSongName(file.name);
    setSongName((value) => value || inferred);
    setMessage(`已选择音乐：${file.name}`);
  };

  const handleLrcFile = async (file: File | null) => {
    if (activeRef.current || startingRef.current) return;
    setLrcFile(file);
    if (!file) return;
    try {
      const parsed = await readLrcFile(file);
      setDocument(parsed);
      if (parsed.title) setSongName(parsed.title);
      if (parsed.artist) setArtist(parsed.artist);
      setMessage(`本地歌词已载入 · ${parsed.lines.length} 行`);
    } catch (error) {
      setDocument(null);
      setMessage(errorMessage(error));
    }
  };

  const handleSearch = async () => {
    if (searching || activeRef.current || startingRef.current) return;
    setSearching(true);
    setMessage("正在在线查找带时间轴的歌词…");
    try {
      const audio = audioRef.current;
      const match = await searchOnlineLyrics(songName, {
        artist,
        duration: audio?.duration && Number.isFinite(audio.duration) ? audio.duration : undefined,
      });
      const parsed = parseLrcText(match.lrc, "online");
      parsed.title = match.title;
      parsed.artist = match.artist;
      parsed.album = match.album;
      setDocument(parsed);
      setSongName(match.title);
      setArtist(match.artist);
      setLrcFile(null);
      setMessage(`已匹配：${match.title}${match.artist ? ` · ${match.artist}` : ""} · ${parsed.lines.length} 行`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setSearching(false);
    }
  };

  const handleStart = async () => {
    if (disabled || activeRef.current || startingRef.current) return;
    if (!hasSelectedDevice) {
      setMessage("请先从设备列表选择对应 SN 的 V1PRO。");
      return;
    }
    if (!audioFile || !audioRef.current) {
      setMessage("请先选择一首本地音乐。");
      return;
    }
    if (!document) {
      setMessage("请先选择本地 LRC，或输入歌名点击在线查词。");
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    notifyModeState(false, true);
    setMessage("正在连接设备并准备歌词画面…");
    const audio = audioRef.current;
    audio.pause();
    try {
      drawCurrentFrame();
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("歌词预览画布未就绪。");
      const client = await acquireClient();
      clientRef.current = client;
      if (generationRef.current !== generation) throw new Error("歌词模式启动已取消。");
      await client.startLiveFrame(canvasToRgb565(canvas));
      if (generationRef.current !== generation) throw new Error("歌词模式启动已取消。");
      await audio.play();
      notifyModeState(true, false);
      lastFrameAtRef.current = 0;
      lastPositionRef.current = -1;
      setMessage("歌词模式运行中 · 320×170 · Apple 风格");
      animationRef.current = requestAnimationFrame(runFrameLoop);
    } catch (error) {
      audio.pause();
      const client = clientRef.current;
      clientRef.current = null;
      try { await client?.stopLiveMode(); } catch { /* disconnect below */ }
      if (client) await releaseClient(client);
      notifyModeState(false, false);
      if (generationRef.current === generation) setMessage(errorMessage(error));
    }
  };

  const controlsDisabled = active || starting;

  return (
    <section className="rounded-[18px] border border-[#e6e9f2] bg-white p-5 shadow-[0_8px_24px_rgba(43,50,69,.04)] sm:p-6 lg:col-span-2">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#eeeaff] text-sm font-extrabold text-[#746cf2]">4</span>
        <div>
          <h2 className="text-[17px] font-extrabold">网页歌词模式</h2>
          <p className="mt-1 text-xs text-[#8a93a8]">网页播放本地歌曲，Canvas 渲染 320×170 苹果风格歌词并实时发送到设备</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-[16px] border border-[#e2defe] bg-gradient-to-b from-[#fbfaff] to-[#f6f8ff] p-4">
          <div className="grid grid-cols-2 gap-2">
            <label className="cursor-pointer rounded-[11px] border border-dashed border-[#b9afea] bg-white px-3 py-3 text-center transition hover:border-[#746cf2]">
              <span className="block text-[11.5px] font-extrabold text-[#6357c8]">{audioFile ? "更换本地音乐" : "选择本地音乐"}</span>
              <span className="mt-1 block truncate text-[9.5px] text-[#9299aa]">{audioFile?.name || "MP3 / FLAC / WAV"}</span>
              <input type="file" accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg" disabled={controlsDisabled} className="sr-only" onChange={(event) => handleAudioFile(event.target.files?.[0] ?? null)} />
            </label>
            <label className="cursor-pointer rounded-[11px] border border-dashed border-[#b9afea] bg-white px-3 py-3 text-center transition hover:border-[#746cf2]">
              <span className="block text-[11.5px] font-extrabold text-[#6357c8]">{lrcFile ? "更换 LRC" : "选择本地 LRC"}</span>
              <span className="mt-1 block truncate text-[9.5px] text-[#9299aa]">{lrcFile?.name || "可选，也可在线查词"}</span>
              <input type="file" accept=".lrc,text/plain" disabled={controlsDisabled} className="sr-only" onChange={(event) => void handleLrcFile(event.target.files?.[0] ?? null)} />
            </label>
          </div>

          {audioUrl ? (
            <audio
              ref={audioRef}
              src={audioUrl}
              controls
              preload="metadata"
              className="mt-3 h-9 w-full"
              onLoadedMetadata={drawCurrentFrame}
              onTimeUpdate={() => { if (!activeRef.current) drawCurrentFrame(); }}
              onSeeked={() => { drawCurrentFrame(); if (activeRef.current) submitFrame(); }}
              onEnded={() => void stopHandlerRef.current("歌曲播放完成，歌词模式已停止并释放 USB。")}
            />
          ) : null}

          <div className="mt-4 rounded-[12px] border border-[#e3e6ef] bg-white p-3">
            <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#9299aa]">在线查词</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input value={songName} disabled={controlsDisabled || searching} onChange={(event) => setSongName(event.target.value)} placeholder="歌曲名称" className="h-9 min-w-0 rounded-[9px] border border-[#dfe3ed] px-3 text-[11.5px] outline-none focus:border-[#746cf2]" />
              <input value={artist} disabled={controlsDisabled || searching} onChange={(event) => setArtist(event.target.value)} placeholder="歌手（可选）" className="h-9 min-w-0 rounded-[9px] border border-[#dfe3ed] px-3 text-[11.5px] outline-none focus:border-[#746cf2]" />
            </div>
            <button type="button" disabled={controlsDisabled || searching || !songName.trim()} onClick={() => void handleSearch()} className="mt-2 h-9 w-full rounded-[9px] bg-[#746cf2] text-[11.5px] font-bold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40">
              {searching ? "正在查词…" : "按歌名在线查词"}
            </button>
          </div>

          <div className="mt-3 rounded-[11px] border border-[#ffe0aa] bg-[#fff9ec] px-3 py-2.5 text-[10.5px] leading-5 text-[#9a6a17]">
            如果需要本地音乐歌词，请打开本地软件；本页适合手动选择歌曲和 LRC 后播放。
          </div>
        </div>

        <div className="overflow-hidden rounded-[18px] border border-[#d9dcef] bg-[#111521] p-3 shadow-[0_12px_30px_rgba(29,31,58,.16)] sm:p-4">
          <div className="mx-auto max-w-[640px]">
            <div className="flex items-center justify-between gap-3 px-1 pb-3 text-white">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#8fdbff]">V1PRO Lyrics Live</p>
                <p className="mt-1 max-w-[430px] truncate text-[12px] font-bold text-white/90">{currentLyric}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-[10.5px] font-bold ${active ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-200" : "border-white/15 bg-white/[.05] text-white/60"}`}>
                {starting ? "启动中" : active ? "运行中" : "待机"}
              </span>
            </div>
            <canvas ref={canvasRef} width={320} height={170} className="block aspect-[320/170] w-full rounded-[14px] bg-[#10131c] shadow-inner" />
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className={`min-h-[1.25rem] text-[10.5px] leading-5 ${/失败|错误|不可用|超时|没有查到/.test(message) ? "text-rose-300" : "text-white/65"}`}>{message}</p>
              <div className="flex shrink-0 gap-2">
                <button type="button" disabled={disabled || !hasSelectedDevice || active || starting || searching} onClick={() => void handleStart()} className="rounded-full bg-gradient-to-r from-[#8b72ff] to-[#40c9f2] px-5 py-2.5 text-[12px] font-bold text-white shadow-[0_5px_18px_rgba(91,132,255,.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35">
                  {starting ? "正在启动…" : "播放到设备"}
                </button>
                <button type="button" disabled={!active && !starting} onClick={() => void stopLyricsMode()} className="rounded-full border border-white/20 bg-white/[.07] px-5 py-2.5 text-[12px] font-bold text-white transition hover:bg-white/[.13] disabled:cursor-not-allowed disabled:opacity-30">
                  停止并释放
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
