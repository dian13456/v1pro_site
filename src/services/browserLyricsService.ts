export let LYRICS_PANEL_WIDTH = 320;
export let LYRICS_PANEL_HEIGHT = 170;

export function configureLyricsPanelGeometry(width: number, height: number): void {
  const nextWidth = Math.trunc(Number(width));
  const nextHeight = Math.trunc(Number(height));
  if (!(nextWidth >= 100 && nextWidth <= 1024 && nextHeight >= 100 && nextHeight <= 1024)) {
    throw new Error(`无效歌词画面尺寸：${width}x${height}`);
  }
  LYRICS_PANEL_WIDTH = nextWidth;
  LYRICS_PANEL_HEIGHT = nextHeight;
}

export interface BrowserLrcLine {
  timeMs: number;
  text: string;
  durationMs: number;
}

export interface BrowserLrcDocument {
  lines: BrowserLrcLine[];
  title: string;
  artist: string;
  album: string;
  offsetMs: number;
  source: "local" | "online";
}

export interface OnlineLyricsMatch {
  title: string;
  artist: string;
  album: string;
  duration: number;
  lrc: string;
}

export interface LyricsRenderState {
  index: number;
  current: string;
  progress: number;
}

const TAG_RE = /\[([^\]]+)]/g;
const TIME_RE = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/;

function parseTimeToken(token: string): number | null {
  const match = TIME_RE.exec(token.trim());
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const fraction = match[4] || "0";
  const milliseconds = fraction.length === 1
    ? Number(fraction) * 100
    : fraction.length === 2
      ? Number(fraction) * 10
      : Number(fraction.slice(0, 3).padEnd(3, "0"));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds;
}

export function parseLrcText(
  text: string,
  source: BrowserLrcDocument["source"] = "local",
): BrowserLrcDocument {
  const entries: BrowserLrcLine[] = [];
  let title = "";
  let artist = "";
  let album = "";
  let offsetMs = 0;

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const tags = Array.from(line.matchAll(TAG_RE), (match) => match[1]);
    if (!tags.length) continue;
    const payload = line.replace(TAG_RE, "").trim();
    const times: number[] = [];
    let durationMs = 0;
    for (const tag of tags) {
      const separator = tag.indexOf(":");
      const key = (separator >= 0 ? tag.slice(0, separator) : tag).trim().toLowerCase();
      const value = separator >= 0 ? tag.slice(separator + 1).trim() : "";
      if (key === "ti") title = value;
      else if (key === "ar") artist = value;
      else if (key === "al") album = value;
      else if (key === "offset") offsetMs = Number.isFinite(Number(value)) ? Number(value) : offsetMs;
      else if (key === "dur" || key === "duration") durationMs = Math.max(0, Math.round(Number(value) || 0));
      else {
        const parsed = parseTimeToken(tag);
        if (parsed !== null) times.push(parsed);
      }
    }
    if (!payload || !times.length) continue;
    for (const timeMs of times) entries.push({ timeMs, text: payload, durationMs });
  }

  entries.sort((a, b) => a.timeMs - b.timeMs);
  const lines: BrowserLrcLine[] = [];
  for (const entry of entries) {
    const previous = lines[lines.length - 1];
    if (previous?.timeMs === entry.timeMs) continue;
    lines.push(entry);
  }
  if (!lines.length) throw new Error("歌词文件中没有可用的时间轴，请选择标准 LRC 文件。");
  return { lines, title, artist, album, offsetMs, source };
}

export async function readLrcFile(file: File): Promise<BrowserLrcDocument> {
  const bytes = await file.arrayBuffer();
  let text = "";
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      text = new TextDecoder("gb18030").decode(bytes);
    } catch {
      text = new TextDecoder().decode(bytes);
    }
  }
  return parseLrcText(text, "local");
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function matchScore(match: OnlineLyricsMatch, query: string, duration?: number): number {
  const wanted = normalized(query);
  const title = normalized(match.title);
  const artist = normalized(match.artist);
  let score = title === wanted ? 100 : title.includes(wanted) || wanted.includes(title) ? 78 : 45;
  if (wanted && artist && wanted.includes(artist)) score += 8;
  if (duration && match.duration) {
    const delta = Math.abs(duration - match.duration);
    score += delta <= 2 ? 24 : delta <= 8 ? 12 : Math.max(-20, 6 - delta / 3);
  }
  return score;
}

export async function searchOnlineLyrics(
  query: string,
  options: { artist?: string; duration?: number } = {},
): Promise<OnlineLyricsMatch> {
  const keyword = [query.trim(), options.artist?.trim()].filter(Boolean).join(" ");
  if (!keyword) throw new Error("请输入歌曲名称后再查词。");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12000);
  try {
    const params = new URLSearchParams({ q: keyword });
    const response = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: { "Lrclib-Client": "Jadot-V1PRO-Web/1.0 (https://www.jadot.cn/)" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.status === 429) throw new Error("在线歌词查询过于频繁，请稍后再试或选择本地 LRC。");
    if (!response.ok) throw new Error(`在线歌词服务暂时不可用（HTTP ${response.status}）。`);
    const payload = await response.json() as Array<Record<string, unknown>>;
    const candidates = payload
      .map((item): OnlineLyricsMatch => ({
        title: String(item.trackName || item.name || ""),
        artist: String(item.artistName || ""),
        album: String(item.albumName || ""),
        duration: Math.max(0, Number(item.duration) || 0),
        lrc: String(item.syncedLyrics || "").trim(),
      }))
      .filter((item) => /\[\d{1,2}:\d{2}/.test(item.lrc))
      .sort((a, b) => matchScore(b, keyword, options.duration) - matchScore(a, keyword, options.duration));
    const best = candidates[0];
    if (!best) throw new Error("没有查到带时间轴的歌词，请选择本地 LRC 或打开本地软件。");
    return best;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("在线歌词查询超时，请稍后重试或选择本地 LRC。");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function wrapText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines = 2): string[] {
  const source = value.trim() || " ";
  const lines: string[] = [];
  let current = "";
  for (const char of source) {
    const trial = current + char;
    if (!current || ctx.measureText(trial).width <= maxWidth) current = trial;
    else {
      lines.push(current);
      current = char;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  const used = lines.join("").length;
  if (lines.length && used < source.length) {
    let last = lines[lines.length - 1] || "";
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function lyricStateAt(document: BrowserLrcDocument, positionSeconds: number): LyricsRenderState {
  const positionMs = Math.max(0, positionSeconds * 1000 + document.offsetMs);
  let low = 0;
  let high = document.lines.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (document.lines[middle].timeMs <= positionMs) {
      index = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (index < 0) return { index: -1, current: "等待音乐开始", progress: 0 };
  const line = document.lines[index];
  const fallbackEnd = document.lines[index + 1]?.timeMs ?? line.timeMs + 4500;
  const end = line.durationMs > 0 ? line.timeMs + line.durationMs : fallbackEnd;
  const progress = Math.max(0, Math.min(1, (positionMs - line.timeMs) / Math.max(300, end - line.timeMs)));
  return { index, current: line.text, progress };
}

export function renderAppleLyricsCanvas(
  canvas: HTMLCanvasElement,
  document: BrowserLrcDocument,
  positionSeconds: number,
  durationSeconds: number,
): LyricsRenderState {
  canvas.width = LYRICS_PANEL_WIDTH;
  canvas.height = LYRICS_PANEL_HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 不可用。");
  const state = lyricStateAt(document, positionSeconds);
  const index = state.index;
  const previous = index > 0 ? document.lines[index - 1].text : "";
  const current = index >= 0 ? document.lines[index].text : "等待音乐开始";
  const next = document.lines[index + 1]?.text || (index < 0 ? document.lines[0]?.text : "") || "";

  const bg = ctx.createLinearGradient(0, 0, LYRICS_PANEL_WIDTH, LYRICS_PANEL_HEIGHT);
  bg.addColorStop(0, "#10131c");
  bg.addColorStop(0.48, "#1a1730");
  bg.addColorStop(1, "#071d2a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, LYRICS_PANEL_WIDTH, LYRICS_PANEL_HEIGHT);
  const contentOffsetY = Math.max(0, Math.floor((LYRICS_PANEL_HEIGHT - 170) / 2));
  ctx.save();
  ctx.translate(0, contentOffsetY);
  const glow = ctx.createRadialGradient(254, 22, 0, 254, 22, 155);
  glow.addColorStop(0, "rgba(118,92,255,.38)");
  glow.addColorStop(0.5, "rgba(38,184,224,.12)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, LYRICS_PANEL_WIDTH, LYRICS_PANEL_HEIGHT);

  ctx.textBaseline = "top";
  ctx.font = '600 11px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "rgba(222,230,246,.46)";
  const heading = [document.title, document.artist].filter(Boolean).join(" · ") || "V1PRO LYRICS";
  ctx.fillText(heading.slice(0, 34), 14, 10, 250);
  ctx.fillStyle = "rgba(255,255,255,.72)";
  ctx.textAlign = "right";
  ctx.fillText(formatClock(positionSeconds), 304, 10);
  ctx.textAlign = "left";

  ctx.font = '600 13px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "rgba(225,230,240,.32)";
  if (previous) ctx.fillText(previous, 15, 34, 290);

  ctx.font = '800 25px "PingFang SC", "Microsoft YaHei", sans-serif';
  const rows = wrapText(ctx, current, 290, 2);
  const widths = rows.map((row) => Math.max(1, ctx.measureText(row).width));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  let consumed = 0;
  rows.forEach((row, rowIndex) => {
    const y = 57 + rowIndex * 31;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.55)";
    ctx.shadowBlur = 5;
    ctx.fillStyle = "rgba(232,235,243,.64)";
    ctx.fillText(row, 14, y);
    ctx.restore();
    const rowProgress = Math.max(0, Math.min(1, (state.progress * totalWidth - consumed) / widths[rowIndex]));
    if (rowProgress > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(12, y - 3, widths[rowIndex] * rowProgress + 5, 35);
      ctx.clip();
      const fill = ctx.createLinearGradient(14, y, 304, y);
      fill.addColorStop(0, "#ffffff");
      fill.addColorStop(0.5, "#b6dcff");
      fill.addColorStop(1, "#75d9ff");
      ctx.fillStyle = fill;
      ctx.shadowColor = "rgba(96,207,255,.42)";
      ctx.shadowBlur = 7;
      ctx.fillText(row, 14, y);
      ctx.restore();
    }
    consumed += widths[rowIndex];
  });

  ctx.font = '600 13px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "rgba(220,228,242,.42)";
  const nextY = rows.length > 1 ? 123 : 101;
  if (next) ctx.fillText(next, 15, nextY, 290);

  const duration = Math.max(durationSeconds || 0, positionSeconds || 0, 1);
  const trackProgress = Math.max(0, Math.min(1, positionSeconds / duration));
  ctx.fillStyle = "rgba(255,255,255,.12)";
  ctx.fillRect(14, 156, 292, 3);
  const trackFill = ctx.createLinearGradient(14, 0, 306, 0);
  trackFill.addColorStop(0, "#8b7cff");
  trackFill.addColorStop(1, "#63d7ff");
  ctx.fillStyle = trackFill;
  ctx.fillRect(14, 156, 292 * trackProgress, 3);
  ctx.restore();
  return state;
}

export function canvasToRgb565(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width !== LYRICS_PANEL_WIDTH || canvas.height !== LYRICS_PANEL_HEIGHT) {
    throw new Error("歌词画面尺寸不正确。");
  }
  const rgba = ctx.getImageData(0, 0, LYRICS_PANEL_WIDTH, LYRICS_PANEL_HEIGHT).data;
  const output = new Uint8Array(LYRICS_PANEL_WIDTH * LYRICS_PANEL_HEIGHT * 2);
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 2) {
    const r = rgba[source];
    const g = rgba[source + 1];
    const b = rgba[source + 2];
    output[target] = (r & 0xf8) | (g >> 5);
    output[target + 1] = ((g & 0x1c) << 3) | (b >> 3);
  }
  return output;
}
