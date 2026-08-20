/**
 * Browser-side GFM1 encoder (320×170 RGB565 LE).
 * Aligns with tools/usb_send_gif.py header layout.
 */
import {
  ANIM_FLASH_MAX_BYTES,
  ANIM_MIN_FRAME_MS,
  ANIM_VERSION,
  DEFAULT_FRAME_MS,
  DEFAULT_MAX_GIF_FRAMES,
  DEFAULT_MAX_VIDEO_SEC,
  DEFAULT_VIDEO_FPS,
  MAX_VIDEO_FPS,
  MIN_VIDEO_FPS,
  MAX_VIDEO_SPEED,
  FRAME_PIXEL_BYTES,
  LCD_H,
  LCD_W,
} from "./v1pro-constants.js?v=1.2.28";

/** @type {HTMLCanvasElement|null} */
let lcdCanvas = null;
/** @type {CanvasRenderingContext2D|null} */
let lcdCtx = null;
/** @type {HTMLCanvasElement|null} */
let gifCanvas = null;
/** @type {CanvasRenderingContext2D|null} */
let gifCtx = null;
/** @type {HTMLCanvasElement|null} */
let patchCanvas = null;
/** @type {CanvasRenderingContext2D|null} */
let patchCtx = null;
/** @type {HTMLCanvasElement|null} */
let transformCanvas = null;
/** @type {CanvasRenderingContext2D|null} */
let transformCtx = null;

function ensureSharedCanvases() {
  if (!lcdCanvas) {
    lcdCanvas = document.createElement("canvas");
    lcdCanvas.width = LCD_W;
    lcdCanvas.height = LCD_H;
    lcdCtx = lcdCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
    if (!lcdCtx) throw new Error("Canvas 不可用。");
    lcdCtx.imageSmoothingEnabled = true;
    lcdCtx.imageSmoothingQuality = "high";
  }
  return lcdCtx;
}

function ensureGifCanvases(gifW, gifH) {
  ensureSharedCanvases();
  if (!gifCanvas || gifCanvas.width !== gifW || gifCanvas.height !== gifH) {
    gifCanvas = document.createElement("canvas");
    gifCanvas.width = gifW;
    gifCanvas.height = gifH;
    gifCtx = gifCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
    if (!gifCtx) throw new Error("Canvas 不可用。");
    patchCanvas = document.createElement("canvas");
    patchCtx = patchCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
    if (!patchCtx) throw new Error("Canvas 不可用。");
  }
  return { gifCtx, patchCanvas, patchCtx };
}

/**
 * @param {number} frameCount
 */
export function gfm1TotalBytes(frameCount) {
  return 56 + frameCount * 2 + frameCount * FRAME_PIXEL_BYTES;
}

/**
 * @param {number} frameCount
 * @param {number[]} delaysMs
 */
export function buildGfm1HeaderBlock(frameCount, delaysMs) {
  if (frameCount <= 0) throw new Error("没有可打包的帧。");
  if (delaysMs.length !== frameCount) throw new Error("帧间隔与帧数不一致。");

  const pixelBytes = frameCount * FRAME_PIXEL_BYTES;
  const header = new ArrayBuffer(56);
  const view = new DataView(header);
  const u8 = new Uint8Array(header);
  u8[0] = 0x47;
  u8[1] = 0x46;
  u8[2] = 0x4d;
  u8[3] = 0x31;
  view.setUint16(4, ANIM_VERSION, true);
  view.setUint16(6, LCD_W, true);
  view.setUint16(8, LCD_H, true);
  view.setUint16(10, frameCount, true);
  view.setUint32(12, pixelBytes, true);

  const delayBlock = new ArrayBuffer(frameCount * 2);
  const delayView = new DataView(delayBlock);
  for (let i = 0; i < frameCount; i++) {
    let d = Math.round(delaysMs[i]);
    if (!Number.isFinite(d) || d <= 0) d = DEFAULT_FRAME_MS;
    if (d < ANIM_MIN_FRAME_MS) d = ANIM_MIN_FRAME_MS;
    if (d > 0xffff) d = 0xffff;
    delayView.setUint16(i * 2, d, true);
  }

  const out = new Uint8Array(56 + frameCount * 2);
  out.set(u8, 0);
  out.set(new Uint8Array(delayBlock), 56);
  return out;
}

/**
 * @param {number} n
 * @param {number[]} delaysMs
 * @param {Uint8Array[]} framePayloads
 */
export function buildGfm1Blob(framePayloads, delaysMs) {
  const n = framePayloads.length;
  for (const f of framePayloads) {
    if (f.length !== FRAME_PIXEL_BYTES) {
      throw new Error(`帧像素大小错误：${f.length}，期望 ${FRAME_PIXEL_BYTES}`);
    }
  }

  const headerBlock = buildGfm1HeaderBlock(n, delaysMs);
  const out = new Uint8Array(headerBlock.length + n * FRAME_PIXEL_BYTES);
  out.set(headerBlock, 0);
  let off = headerBlock.length;
  for (const f of framePayloads) {
    out.set(f, off);
    off += FRAME_PIXEL_BYTES;
  }

  if (out.length > ANIM_FLASH_MAX_BYTES) {
    throw new Error(`GFM1 过大：${out.length} 字节超过 Flash 上限。`);
  }
  return out;
}

/**
 * Fit image into LCD with contain + black letterbox (PC tool "pad").
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 * @returns {ImageData}
 */
export function fitToLcdImageData(source, srcW, srcH) {
  const ctx = ensureSharedCanvases();
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, LCD_W, LCD_H);

  const scale = Math.min(LCD_W / srcW, LCD_H / srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));
  const dx = Math.floor((LCD_W - dw) / 2);
  const dy = Math.floor((LCD_H - dh) / 2);
  ctx.drawImage(source, 0, 0, srcW, srcH, dx, dy, dw, dh);
  return ctx.getImageData(0, 0, LCD_W, LCD_H);
}

/**
 * Stretch a frame to the full LCD dimensions (PC tool "fill").
 * This intentionally fills every screen pixel without letterboxing.
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 * @returns {ImageData}
 */
export function fillLcdImageData(source, srcW, srcH) {
  const ctx = ensureSharedCanvases();
  ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, LCD_W, LCD_H);
  return ctx.getImageData(0, 0, LCD_W, LCD_H);
}

/**
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 * @returns {Uint8Array}
 */
export function sourceToRgb565(
  source,
  srcW,
  srcH,
  fitMode = "contain",
  rotationDeg = 0,
  colorProfile = "normal",
) {
  let renderSource = source;
  let renderW = srcW;
  let renderH = srcH;
  const rotation = ((Number(rotationDeg) % 360) + 360) % 360;
  if (rotation === 90 || rotation === 180 || rotation === 270) {
    const swap = rotation === 90 || rotation === 270;
    renderW = swap ? srcH : srcW;
    renderH = swap ? srcW : srcH;
    if (!transformCanvas) transformCanvas = document.createElement("canvas");
    transformCanvas.width = renderW;
    transformCanvas.height = renderH;
    transformCtx = transformCanvas.getContext("2d", { alpha: false });
    if (!transformCtx) throw new Error("Canvas 不可用。");
    transformCtx.save();
    transformCtx.fillStyle = "#000000";
    transformCtx.fillRect(0, 0, renderW, renderH);
    transformCtx.translate(renderW / 2, renderH / 2);
    transformCtx.rotate((rotation * Math.PI) / 180);
    transformCtx.drawImage(source, 0, 0, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH);
    transformCtx.restore();
    renderSource = transformCanvas;
  }
  const data = (fitMode === "fill"
    ? fillLcdImageData(renderSource, renderW, renderH)
    : fitToLcdImageData(renderSource, renderW, renderH)).data;
  const profiles = {
    // Keep these values in sync with browserFfmpegVideoService.colorFilters.
    // Moderate gains avoid crushed highlights after RGB565 quantisation.
    normal: {
      saturation: 1.08, contrast: 1.05, brightness: 0.002, gamma: 1.01,
      red: 1, green: 1, blue: 1,
    },
    vivid: {
      saturation: 1.18, contrast: 1.07, brightness: 0.003, gamma: 1.012,
      red: 1.005, green: 1, blue: 0.995,
    },
    professional: {
      saturation: 1.04, contrast: 1.05, brightness: 0.002, gamma: 1.01,
      red: 1.01, green: 1, blue: 0.99,
    },
  };
  const profile = profiles[colorProfile] || profiles.normal;
  const out = new Uint8Array(FRAME_PIXEL_BYTES);
  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const adjustChannel = (value, gain) => {
      const saturated = luma + (value - luma) * profile.saturation;
      const contrasted = (saturated - 128) * profile.contrast + 128 + profile.brightness * 255;
      const normalized = Math.max(0, Math.min(1, contrasted / 255));
      return Math.max(0, Math.min(255, 255 * Math.pow(normalized, 1 / profile.gamma) * gain));
    };
    r = adjustChannel(r, profile.red);
    g = adjustChannel(g, profile.green);
    b = adjustChannel(b, profile.blue);
    out[o++] = (r & 0xf8) | (g >> 5);
    out[o++] = ((g & 0x1c) << 3) | (b >> 3);
  }
  return out;
}

/**
 * RGBA ImageData → RGB565 bytes (match usb_send_gif `_rgb24_to_rgb565_trunc_be`).
 * @param {ImageData} imageData
 * @returns {Uint8Array}
 */
export function rgbaToRgb565(imageData) {
  const { data, width, height } = imageData;
  if (width !== LCD_W || height !== LCD_H) {
    throw new Error(`分辨率错误：${width}x${height}`);
  }
  const out = new Uint8Array(FRAME_PIXEL_BYTES);
  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    out[o++] = (r & 0xf8) | (g >> 5);
    out[o++] = ((g & 0x1c) << 3) | (b >> 3);
  }
  return out;
}

function normalizeDelayMs(value) {
  let ms = value || DEFAULT_FRAME_MS;
  if (!Number.isFinite(ms) || ms <= 0) ms = DEFAULT_FRAME_MS;
  if (ms < ANIM_MIN_FRAME_MS) ms = ANIM_MIN_FRAME_MS;
  return ms;
}

function isVideoBlob(type, name) {
  const lowerType = (type || "").toLowerCase();
  if (lowerType.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v)$/i.test(name || "");
}

function indexOfBytes(haystack, needle) {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function includesAscii(bytes, text) {
  const needle = new TextEncoder().encode(text);
  return indexOfBytes(bytes, needle) >= 0;
}

/**
 * @param {Blob} blob
 */
async function probeVideoBrowserCompatibility(blob) {
  const chunk = await blob.slice(0, Math.min(blob.size, 512 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(chunk);

  if (includesAscii(bytes, "hvc1") || includesAscii(bytes, "hev1") || includesAscii(bytes, "hvt1")) {
    return {
      compatible: false,
      reason: "检测到 HEVC/H.265，浏览器无法解码。请使用 H.264 8-bit MP4。",
    };
  }
  if (includesAscii(bytes, "av01") || includesAscii(bytes, "dav1")) {
    return {
      compatible: false,
      reason: "检测到 AV1，浏览器可能无法解码。请使用 H.264 8-bit MP4。",
    };
  }
  const marker = new TextEncoder().encode("avcC");
  const avcIndex = indexOfBytes(bytes, marker);
  if (avcIndex >= 0 && avcIndex + 8 < bytes.length && bytes[avcIndex + 8] === 110) {
    return {
      compatible: false,
      reason: "检测到 H.264 10-bit，请转换为 8-bit H.264 MP4。",
    };
  }
  return { compatible: true };
}

/**
 * @param {HTMLVideoElement} video
 * @param {number} time
 */
function seekVideoTo(video, time) {
  const alreadyAtTime = Math.abs(video.currentTime - time) < 0.02;
  if (alreadyAtTime && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("视频抽帧超时，请尝试更短或更小的 MP4。"));
    }, 12000);
    const onFrameReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("视频抽帧失败，请使用 H.264 8-bit MP4。"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onFrameReady);
      video.removeEventListener("loadeddata", onFrameReady);
      video.removeEventListener("error", onError);
    };
    if (alreadyAtTime) {
      video.addEventListener("loadeddata", onFrameReady);
    } else {
      video.addEventListener("seeked", onFrameReady);
    }
    video.addEventListener("error", onError);
    if (!alreadyAtTime) {
      video.currentTime = time;
    }
  });
}

/**
 * Plan a complete-video conversion. First lower fps from 30 to 20, then apply
 * up to 5x playback speed. Never truncate the source video.
 * @param {number} duration source seconds
 * @param {number} maxFrames device frame budget
 * @param {{ maxVideoFps?: number, minVideoFps?: number, maxVideoSpeed?: number }} [opts]
 */
export function planVideoSampleSchedule(duration, maxFrames, opts = {}) {
  const maxVideoFps = opts.maxVideoFps ?? MAX_VIDEO_FPS;
  const minVideoFps = opts.minVideoFps ?? Math.min(MIN_VIDEO_FPS, maxVideoFps);
  const maxVideoSpeed = opts.maxVideoSpeed ?? MAX_VIDEO_SPEED;
  const safeDuration = Math.max(0.001, duration);
  const budget = Math.max(1, maxFrames);

  for (let fps = maxVideoFps; fps >= minVideoFps; fps -= 1) {
    const framesNeeded = Math.max(1, Math.ceil(safeDuration * fps));
    if (framesNeeded <= budget) {
      return {
        frameCount: framesNeeded,
        fps,
        speed: 1,
        sourceSpan: safeDuration,
      };
    }
  }

  const requiredSpeed = (safeDuration * minVideoFps) / budget;
  if (requiredSpeed > maxVideoSpeed) {
    const minimumFrames = Math.ceil((safeDuration * minVideoFps) / maxVideoSpeed);
    throw new Error(
      `设备空间不足：完整视频降至 ${minVideoFps}fps、${maxVideoSpeed} 倍速后仍需 ` +
        `${minimumFrames} 帧，当前设备最多容纳 ${budget} 帧。`,
    );
  }

  return {
    frameCount: budget,
    fps: minVideoFps,
    speed: Math.max(1, requiredSpeed),
    sourceSpan: safeDuration,
  };
}

/**
 * Read only video metadata from a CORS-enabled URL and predict GFM1 size.
 * Browsers normally use range requests here instead of downloading the file.
 */
export async function predictVideoTransferFromUrl(url, maxFrames, opts = {}) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.crossOrigin = "anonymous";
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("读取视频时长超时，无法预测设备空间。"));
      }, 15000);
      const cleanupListeners = () => {
        clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
      };
      video.onloadedmetadata = () => {
        cleanupListeners();
        resolve();
      };
      video.onerror = () => {
        cleanupListeners();
        reject(new Error("无法读取视频元数据，请确认视频格式与 COS 跨域配置。"));
      };
      video.src = url;
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) {
      throw new Error("视频时长无效，无法预测设备空间。");
    }
    const schedule = planVideoSampleSchedule(duration, maxFrames, opts);
    return {
      ...schedule,
      duration,
      totalBytes: gfm1TotalBytes(schedule.frameCount),
      note: formatVideoPlanNote(schedule, duration),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

function formatVideoPlanNote(schedule, duration) {
  const parts = [`${schedule.frameCount} 帧`, `${schedule.fps}fps`];
  if (schedule.speed > 1.01) {
    parts.push(`${schedule.speed.toFixed(1)}x 倍速`);
  }
  if (duration > 0.05) {
    parts.push(`${duration.toFixed(1)}s`);
  }
  return parts.join(" · ");
}

/**
 * @param {Blob} blob
 * @param {{ maxFrames?: number, maxVideoFps?: number, maxVideoSpeed?: number, maxPayloadBytes?: number, onFrameEncoded?: (index: number, total: number) => void }} opts
 */
async function planVideoWithSeek(blob, opts) {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
  const maxVideoFps = opts.maxVideoFps ?? MAX_VIDEO_FPS;
  const minVideoFps = opts.minVideoFps ?? Math.min(MIN_VIDEO_FPS, maxVideoFps);
  const maxVideoSpeed = opts.maxVideoSpeed ?? MAX_VIDEO_SPEED;
  const maxPayloadBytes = opts.maxPayloadBytes ?? ANIM_FLASH_MAX_BYTES;
  const fitMode = opts.fitMode === "fill" ? "fill" : "contain";
  const rotationDeg = opts.rotationDeg ?? 0;
  const colorProfile = opts.colorProfile ?? "normal";
  const onFrameEncoded =
    typeof opts.onFrameEncoded === "function" ? opts.onFrameEncoded : null;

  const probe = await probeVideoBrowserCompatibility(blob);
  if (!probe.compatible) {
    throw new Error(probe.reason || "视频格式不受支持。");
  }

  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  let handedOff = false;
  const cleanup = () => {
    URL.revokeObjectURL(objectUrl);
    video.removeAttribute("src");
    video.load();
  };

  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("无法读取视频，请使用 H.264 8-bit MP4。"));
      video.src = objectUrl;
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration <= 0) {
      throw new Error("视频时长无效。");
    }
    // loadedmetadata does not guarantee that the first decoded frame exists.
    // Wait for frame 0 before handing the video to the payload generator,
    // otherwise drawing it to canvas can produce a black first frame.
    await seekVideoTo(video, 0);

    const schedule = planVideoSampleSchedule(duration, maxFrames, {
      maxVideoFps,
      minVideoFps,
      maxVideoSpeed,
    });
    const { frameCount, fps, sourceSpan } = schedule;
    const delayMs = normalizeDelayMs(Math.round(1000 / fps));
    const delaysMs = Array.from({ length: frameCount }, () => delayMs);
    const times = [];
    for (let i = 0; i < frameCount; i += 1) {
      times.push(frameCount === 1 ? 0 : (i / (frameCount - 1)) * Math.max(0, sourceSpan - 0.05));
    }

    const totalBytes = gfm1TotalBytes(frameCount);
    if (totalBytes > maxPayloadBytes) {
      throw new Error("视频编码后超过设备 Flash 上限，请缩短视频或降低画质。");
    }
    const headerBlock = buildGfm1HeaderBlock(frameCount, delaysMs);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw <= 0 || vh <= 0) {
      throw new Error("无法读取视频画面尺寸。");
    }

    const note = formatVideoPlanNote(schedule, duration);
    handedOff = true;

    return {
      frameCount,
      fps,
      totalBytes,
      note,
      payloadChunks: async function* () {
        try {
          yield headerBlock;
          for (let i = 0; i < frameCount; i += 1) {
            await seekVideoTo(video, times[i]);
            const rgb = sourceToRgb565(video, vw, vh, fitMode, rotationDeg, colorProfile);
            onFrameEncoded?.(i + 1, frameCount);
            yield rgb;
          }
        } finally {
          cleanup();
        }
      },
    };
  } finally {
    if (!handedOff) cleanup();
  }
}

/**
 * @param {Blob} blob
 * @param {{ maxFrames?: number, fileName?: string, onFrameEncoded?: (index: number, total: number) => void }} [opts]
 * @returns {Promise<{
 *   frameCount: number,
 *   fps?: number,
 *   totalBytes: number,
 *   note?: string,
 *   payloadChunks: () => AsyncGenerator<Uint8Array, void, void>,
 * }>}
 */
export async function planGfm1Encode(blob, opts = {}) {
  let maxFrames = opts.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
  if (opts.maxPayloadBytes) {
    const framesByBytes = Math.max(
      1,
      Math.floor((opts.maxPayloadBytes - 56) / (2 + FRAME_PIXEL_BYTES)),
    );
    maxFrames = Math.min(maxFrames, framesByBytes);
  }
  const type = (blob.type || "").toLowerCase();
  const name = (opts.fileName || "").toLowerCase();
  const explicitMediaType = (opts.mediaType || "").toLowerCase();
  const isGif =
    explicitMediaType === "gif" || type === "image/gif" || name.endsWith(".gif");
  const isVideo =
    explicitMediaType === "video" || isVideoBlob(type, name);
  const fitMode = opts.fitMode ?? (isGif ? "contain" : "fill");
  const onFrameEncoded =
    typeof opts.onFrameEncoded === "function" ? opts.onFrameEncoded : null;

  if (isVideo) {
    return planVideoWithSeek(blob, {
      maxFrames,
      maxVideoFps: opts.maxVideoFps,
      minVideoFps: opts.minVideoFps,
      maxVideoSpeed: opts.maxVideoSpeed,
      maxPayloadBytes: opts.maxPayloadBytes,
      fitMode,
      rotationDeg: opts.rotationDeg,
      colorProfile: opts.colorProfile,
      onFrameEncoded,
    });
  }

  if (!isGif) {
    const bitmap = await decodeStillImageBitmap(blob);
    const frameCount = 1;
    const totalBytes = gfm1TotalBytes(frameCount);
    const headerBlock = buildGfm1HeaderBlock(frameCount, [DEFAULT_FRAME_MS]);
    return {
      frameCount,
      totalBytes,
      payloadChunks: async function* () {
        try {
          yield headerBlock;
          const rgb = sourceToRgb565(
            bitmap,
            bitmap.width,
            bitmap.height,
            fitMode,
            opts.rotationDeg,
            opts.colorProfile,
          );
          onFrameEncoded?.(1, 1);
          yield rgb;
        } finally {
          bitmap.close?.();
        }
      },
    };
  }

  try {
    return await planGifWithGifuct(
      blob,
      maxFrames,
      onFrameEncoded,
      fitMode,
      opts.rotationDeg,
      opts.colorProfile,
    );
  } catch (err) {
    console.warn("[V1PRO] gifuct GIF failed:", err);
  }

  if (typeof ImageDecoder !== "undefined") {
    try {
      return await planGifWithImageDecoder(
        blob,
        maxFrames,
        onFrameEncoded,
        fitMode,
        opts.rotationDeg,
        opts.colorProfile,
      );
    } catch (err) {
      console.warn("[V1PRO] ImageDecoder GIF failed:", err);
    }
  }

  const bitmap = await decodeStillImageBitmap(blob);
  const frameCount = 1;
  const totalBytes = gfm1TotalBytes(frameCount);
  const headerBlock = buildGfm1HeaderBlock(frameCount, [DEFAULT_FRAME_MS]);
  return {
    frameCount,
    totalBytes,
    note: "GIF 多帧解码失败，已使用首帧。",
    payloadChunks: async function* () {
      try {
        yield headerBlock;
        const rgb = sourceToRgb565(
          bitmap,
          bitmap.width,
          bitmap.height,
          fitMode,
          opts.rotationDeg,
          opts.colorProfile,
        );
        onFrameEncoded?.(1, 1);
        yield rgb;
      } finally {
        bitmap.close?.();
      }
    },
  };
}

/**
 * Decode a still image blob to ImageBitmap with a clearer failure message.
 * @param {Blob} blob
 * @returns {Promise<ImageBitmap>}
 */
async function decodeStillImageBitmap(blob) {
  const sizeLabel = Number.isFinite(blob?.size) ? `${blob.size} 字节` : "未知大小";
  const typeLabel = (blob?.type || "").trim() || "未知类型";
  try {
    return await createImageBitmap(blob);
  } catch (directErr) {
    // Some COS responses omit/mislabel Content-Type; retry via HTMLImageElement.
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = await loadHtmlImage(objectUrl);
      try {
        return await createImageBitmap(image);
      } finally {
        // keep image eligible for GC
      }
    } catch {
      const detail =
        directErr instanceof Error && directErr.message
          ? directErr.message
          : "unknown decode error";
      throw new Error(`图片无法解码（${typeLabel}，${sizeLabel}）：${detail}`);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

/**
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("HTMLImageElement decode failed"));
    image.src = url;
  });
}

/**
 * @param {Blob} blob
 * @param {number} maxFrames
 * @param {(index: number, total: number) => void | null} onFrameEncoded
 */
async function planGifWithGifuct(blob, maxFrames, onFrameEncoded, fitMode, rotationDeg, colorProfile) {
  const gifuct = await import("./gifuct-bundle.js?v=1.2.26");
  const parseGIF = gifuct.parseGIF || gifuct.default?.parseGIF;
  const decompressFrames = gifuct.decompressFrames || gifuct.default?.decompressFrames;
  if (typeof parseGIF !== "function" || typeof decompressFrames !== "function") {
    throw new Error("gifuct 模块不可用");
  }

  const buffer = await blob.arrayBuffer();
  const parsed = parseGIF(buffer);
  const rawFrames = decompressFrames(parsed, true);
  if (!rawFrames.length) {
    throw new Error("GIF 无有效帧");
  }

  const gifW = parsed.lsd.width;
  const gifH = parsed.lsd.height;
  const frameCount = Math.min(rawFrames.length, maxFrames);
  const totalBytes = gfm1TotalBytes(frameCount);
  const delaysMs = [];
  for (let i = 0; i < frameCount; i++) {
    delaysMs.push(normalizeDelayMs(rawFrames[i].delay));
  }
  const headerBlock = buildGfm1HeaderBlock(frameCount, delaysMs);
  const { gifCtx: gCtx, patchCanvas: pCanvas, patchCtx: pCtx } = ensureGifCanvases(
    gifW,
    gifH
  );

  let note = `GIF ${frameCount} 帧 · gifuct`;
  if (rawFrames.length > maxFrames) {
    note = `GIF 共 ${rawFrames.length} 帧，已截取前 ${maxFrames} 帧 · gifuct`;
  }

  return {
    frameCount,
    totalBytes,
    note,
    payloadChunks: async function* () {
      yield headerBlock;
      for (let i = 0; i < frameCount; i++) {
        const frame = rawFrames[i];
        pCanvas.width = frame.dims.width;
        pCanvas.height = frame.dims.height;
        const patchData = pCtx.createImageData(frame.dims.width, frame.dims.height);
        patchData.data.set(frame.patch);
        pCtx.putImageData(patchData, 0, 0);
        gCtx.drawImage(pCanvas, frame.dims.left, frame.dims.top);
        const rgb = sourceToRgb565(gifCanvas, gifW, gifH, fitMode, rotationDeg, colorProfile);
        onFrameEncoded?.(i + 1, frameCount);
        yield rgb;
        if (frame.disposalType === 2) {
          gCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
        }
        if (i > 0 && i % 8 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    },
  };
}

/**
 * @param {Blob} blob
 * @param {number} maxFrames
 * @param {(index: number, total: number) => void | null} onFrameEncoded
 */
async function planGifWithImageDecoder(blob, maxFrames, onFrameEncoded, fitMode, rotationDeg, colorProfile) {
  const buffer = await blob.arrayBuffer();
  const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });

  try {
    await decoder.tracks.ready;
    if (!decoder.complete) {
      await decoder.completed;
    }

    const track = decoder.tracks.selectedTrack || decoder.tracks[0];
    if (!track) {
      throw new Error("GIF 无可用轨道");
    }

    let frameCount = Math.max(1, track.frameCount || 1);
    const totalInFile = frameCount;
    if (frameCount > maxFrames) {
      frameCount = maxFrames;
    }

    /** @type {{ bitmap: VideoFrame, ms: number }[]} */
    const decoded = [];
    for (let i = 0; i < frameCount; i++) {
      const result = await decoder.decode({ frameIndex: i });
      const bitmap = result.image;
      let ms = DEFAULT_FRAME_MS;
      if (typeof bitmap.duration === "number" && bitmap.duration > 0) {
        ms = Math.max(ANIM_MIN_FRAME_MS, Math.round(bitmap.duration / 1000));
      }
      decoded.push({ bitmap, ms });
    }

    const delaysMs = decoded.map((item) => item.ms);
    const totalBytes = gfm1TotalBytes(frameCount);
    const headerBlock = buildGfm1HeaderBlock(frameCount, delaysMs);

    let note;
    if (totalInFile > maxFrames) {
      note = `GIF 共 ${totalInFile} 帧，已截取前 ${maxFrames} 帧。`;
    } else if (totalInFile > 1) {
      note = `GIF ${totalInFile} 帧 · ImageDecoder`;
    }

    return {
      frameCount,
      totalBytes,
      note,
      payloadChunks: async function* () {
        yield headerBlock;
        for (let i = 0; i < frameCount; i++) {
          const { bitmap } = decoded[i];
          try {
            const rgb = sourceToRgb565(
              bitmap,
              bitmap.displayWidth,
              bitmap.displayHeight,
              fitMode,
              rotationDeg,
              colorProfile,
            );
            onFrameEncoded?.(i + 1, frameCount);
            yield rgb;
          } finally {
            bitmap.close?.();
          }
        }
      },
    };
  } finally {
    decoder.close?.();
  }
}

/**
 * @param {Blob} blob
 * @returns {Promise<{ frames: Uint8Array[], delaysMs: number[], note?: string }>}
 */
export async function decodeBlobToFrames(blob, opts = {}) {
  const parts = [];
  const plan = await planGfm1Encode(blob, opts);
  for await (const chunk of plan.payloadChunks()) {
    parts.push(chunk);
  }
  const gfm1 = concatUint8Arrays(parts);
  const frameCount = plan.frameCount;
  const headerBytes = 56 + frameCount * 2;
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const start = headerBytes + i * FRAME_PIXEL_BYTES;
    frames.push(gfm1.subarray(start, start + FRAME_PIXEL_BYTES));
  }
  const delaysMs = [];
  const delayView = new DataView(gfm1.buffer, gfm1.byteOffset + 56, frameCount * 2);
  for (let i = 0; i < frameCount; i++) {
    delaysMs.push(delayView.getUint16(i * 2, true));
  }
  return { frames, delaysMs, note: plan.note };
}

/**
 * @param {Uint8Array[]} parts
 */
function concatUint8Arrays(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * @param {Blob} blob
 * @param {{ maxFrames?: number, fileName?: string }} [opts]
 * @returns {Promise<{ gfm1: Uint8Array, frameCount: number, note?: string }>}
 */
export async function encodeBlobToGfm1(blob, opts = {}) {
  const plan = await planGfm1Encode(blob, opts);
  const parts = [];
  for await (const chunk of plan.payloadChunks()) {
    parts.push(chunk);
  }
  const gfm1 = concatUint8Arrays(parts);
  if (gfm1.length > ANIM_FLASH_MAX_BYTES) {
    throw new Error(`GFM1 过大：${gfm1.length} 字节超过 Flash 上限。`);
  }
  return { gfm1, frameCount: plan.frameCount, note: plan.note };
}
