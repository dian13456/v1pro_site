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
  FRAME_PIXEL_BYTES,
  LCD_H,
  LCD_W,
} from "./v1pro-constants.js?v=1.0.9";

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

function ensureSharedCanvases() {
  if (!lcdCanvas) {
    lcdCanvas = document.createElement("canvas");
    lcdCanvas.width = LCD_W;
    lcdCanvas.height = LCD_H;
    lcdCtx = lcdCanvas.getContext("2d", { willReadFrequently: true, alpha: false });
    if (!lcdCtx) throw new Error("Canvas 不可用。");
    lcdCtx.imageSmoothingEnabled = true;
    lcdCtx.imageSmoothingQuality = "low";
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
 * @param {CanvasImageSource} source
 * @param {number} srcW
 * @param {number} srcH
 * @returns {Uint8Array}
 */
export function sourceToRgb565(source, srcW, srcH) {
  const data = fitToLcdImageData(source, srcW, srcH).data;
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

/**
 * @param {Blob} blob
 * @param {{ maxFrames?: number, fileName?: string, onFrameEncoded?: (index: number, total: number) => void }} [opts]
 * @returns {Promise<{
 *   frameCount: number,
 *   totalBytes: number,
 *   note?: string,
 *   payloadChunks: () => AsyncGenerator<Uint8Array, void, void>,
 * }>}
 */
export async function planGfm1Encode(blob, opts = {}) {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
  const type = (blob.type || "").toLowerCase();
  const name = (opts.fileName || "").toLowerCase();
  const isGif = type === "image/gif" || name.endsWith(".gif");
  const onFrameEncoded =
    typeof opts.onFrameEncoded === "function" ? opts.onFrameEncoded : null;

  if (!isGif) {
    const bitmap = await createImageBitmap(blob);
    const frameCount = 1;
    const totalBytes = gfm1TotalBytes(frameCount);
    const headerBlock = buildGfm1HeaderBlock(frameCount, [DEFAULT_FRAME_MS]);
    return {
      frameCount,
      totalBytes,
      payloadChunks: async function* () {
        try {
          yield headerBlock;
          const rgb = sourceToRgb565(bitmap, bitmap.width, bitmap.height);
          onFrameEncoded?.(1, 1);
          yield rgb;
        } finally {
          bitmap.close?.();
        }
      },
    };
  }

  try {
    return await planGifWithGifuct(blob, maxFrames, onFrameEncoded);
  } catch (err) {
    console.warn("[V1PRO] gifuct GIF failed:", err);
  }

  if (typeof ImageDecoder !== "undefined") {
    try {
      return await planGifWithImageDecoder(blob, maxFrames, onFrameEncoded);
    } catch (err) {
      console.warn("[V1PRO] ImageDecoder GIF failed:", err);
    }
  }

  const bitmap = await createImageBitmap(blob);
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
        const rgb = sourceToRgb565(bitmap, bitmap.width, bitmap.height);
        onFrameEncoded?.(1, 1);
        yield rgb;
      } finally {
        bitmap.close?.();
      }
    },
  };
}

/**
 * @param {Blob} blob
 * @param {number} maxFrames
 * @param {(index: number, total: number) => void | null} onFrameEncoded
 */
async function planGifWithGifuct(blob, maxFrames, onFrameEncoded) {
  const gifuct = await import("./gifuct-bundle.js?v=1.0.9");
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
        const rgb = sourceToRgb565(gifCanvas, gifW, gifH);
        onFrameEncoded?.(i + 1, frameCount);
        yield rgb;
        if (frame.disposalType === 2) {
          gCtx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
        }
        if (i > 0 && i % 4 === 0) {
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
async function planGifWithImageDecoder(blob, maxFrames, onFrameEncoded) {
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
            const rgb = sourceToRgb565(bitmap, bitmap.displayWidth, bitmap.displayHeight);
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
