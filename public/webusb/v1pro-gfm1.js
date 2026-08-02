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
} from "./v1pro-constants.js?v=1.0.7";

/**
 * @param {number} n
 * @param {number[]} delaysMs
 * @param {Uint8Array[]} framePayloads
 */
export function buildGfm1Blob(framePayloads, delaysMs) {
  const n = framePayloads.length;
  if (n <= 0) throw new Error("没有可打包的帧。");
  if (delaysMs.length !== n) throw new Error("帧间隔与帧数不一致。");

  for (const f of framePayloads) {
    if (f.length !== FRAME_PIXEL_BYTES) {
      throw new Error(`帧像素大小错误：${f.length}，期望 ${FRAME_PIXEL_BYTES}`);
    }
  }

  const pixelBytes = n * FRAME_PIXEL_BYTES;
  // 56-byte AnimHeader (<4sHHHHI40s), then N×uint16 delays (same as usb_send_gif.py).
  const header = new ArrayBuffer(56);
  const view = new DataView(header);
  const u8 = new Uint8Array(header);
  u8[0] = 0x47; // G
  u8[1] = 0x46; // F
  u8[2] = 0x4d; // M
  u8[3] = 0x31; // 1
  view.setUint16(4, ANIM_VERSION, true);
  view.setUint16(6, LCD_W, true);
  view.setUint16(8, LCD_H, true);
  view.setUint16(10, n, true);
  view.setUint32(12, pixelBytes, true);
  // bytes 16..55 already 0

  const delayBlock = new ArrayBuffer(n * 2);
  const delayView = new DataView(delayBlock);
  for (let i = 0; i < n; i++) {
    let d = Math.round(delaysMs[i]);
    if (!Number.isFinite(d) || d <= 0) d = DEFAULT_FRAME_MS;
    if (d < ANIM_MIN_FRAME_MS) d = ANIM_MIN_FRAME_MS;
    if (d > 0xffff) d = 0xffff;
    delayView.setUint16(i * 2, d, true);
  }

  const out = new Uint8Array(56 + n * 2 + pixelBytes);
  out.set(u8, 0);
  out.set(new Uint8Array(delayBlock), 56);
  let off = 56 + n * 2;
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
  const canvas = document.createElement("canvas");
  canvas.width = LCD_W;
  canvas.height = LCD_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 不可用。");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, LCD_W, LCD_H);

  const scale = Math.min(LCD_W / srcW, LCD_H / srcH);
  const dw = Math.max(1, Math.round(srcW * scale));
  const dh = Math.max(1, Math.round(srcH * scale));
  const dx = Math.floor((LCD_W - dw) / 2);
  const dy = Math.floor((LCD_H - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, srcW, srcH, dx, dy, dw, dh);
  return ctx.getImageData(0, 0, LCD_W, LCD_H);
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

/**
 * @param {Blob} blob
 * @returns {Promise<{ frames: Uint8Array[], delaysMs: number[], note?: string }>}
 */
export async function decodeBlobToFrames(blob, opts = {}) {
  const maxFrames = opts.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
  const type = (blob.type || "").toLowerCase();
  const name = (opts.fileName || "").toLowerCase();
  const isGif = type === "image/gif" || name.endsWith(".gif");

  if (isGif) {
    try {
      return await decodeGifWithGifuct(blob, maxFrames);
    } catch (err) {
      console.warn("[V1PRO] gifuct GIF failed:", err);
    }
    if (typeof ImageDecoder !== "undefined") {
      try {
        return await decodeGifWithImageDecoder(blob, maxFrames);
      } catch (err) {
        console.warn("[V1PRO] ImageDecoder GIF failed:", err);
      }
    }
  } else {
    const bitmap = await createImageBitmap(blob);
    try {
      const imageData = fitToLcdImageData(bitmap, bitmap.width, bitmap.height);
      const frame = rgbaToRgb565(imageData);
      return {
        frames: [frame],
        delaysMs: [DEFAULT_FRAME_MS],
      };
    } finally {
      bitmap.close?.();
    }
  }

  const bitmap = await createImageBitmap(blob);
  try {
    const imageData = fitToLcdImageData(bitmap, bitmap.width, bitmap.height);
    const frame = rgbaToRgb565(imageData);
    return {
      frames: [frame],
      delaysMs: [DEFAULT_FRAME_MS],
      note: "GIF 多帧解码失败，已使用首帧。",
    };
  } finally {
    bitmap.close?.();
  }
}

/**
 * @param {Blob} blob
 * @param {number} maxFrames
 */
async function decodeGifWithGifuct(blob, maxFrames) {
  const gifuct = await import("./gifuct-bundle.js?v=1.0.7");
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

  const canvas = document.createElement("canvas");
  canvas.width = gifW;
  canvas.height = gifH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 不可用。");

  const patchCanvas = document.createElement("canvas");
  const patchCtx = patchCanvas.getContext("2d");
  if (!patchCtx) throw new Error("Canvas 不可用。");

  /** @type {Uint8Array[]} */
  const frames = [];
  /** @type {number[]} */
  const delaysMs = [];

  for (let i = 0; i < frameCount; i++) {
    const frame = rawFrames[i];
    patchCanvas.width = frame.dims.width;
    patchCanvas.height = frame.dims.height;
    const patchData = patchCtx.createImageData(frame.dims.width, frame.dims.height);
    patchData.data.set(frame.patch);
    patchCtx.putImageData(patchData, 0, 0);
    ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

    const imageData = fitToLcdImageData(canvas, gifW, gifH);
    frames.push(rgbaToRgb565(imageData));

    let ms = frame.delay || DEFAULT_FRAME_MS;
    if (!Number.isFinite(ms) || ms <= 0) ms = DEFAULT_FRAME_MS;
    if (ms < ANIM_MIN_FRAME_MS) ms = ANIM_MIN_FRAME_MS;
    delaysMs.push(ms);

    if (frame.disposalType === 2) {
      ctx.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }
  }

  let note = `GIF ${frameCount} 帧 · gifuct`;
  if (rawFrames.length > maxFrames) {
    note = `GIF 共 ${rawFrames.length} 帧，已截取前 ${maxFrames} 帧 · gifuct`;
  }
  return { frames, delaysMs, note };
}

/**
 * @param {Blob} blob
 * @param {number} maxFrames
 */
async function decodeGifWithImageDecoder(blob, maxFrames) {
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

    /** @type {Uint8Array[]} */
    const frames = [];
    /** @type {number[]} */
    const delaysMs = [];

    for (let i = 0; i < frameCount; i++) {
      const result = await decoder.decode({ frameIndex: i });
      const bitmap = result.image;
      try {
        const imageData = fitToLcdImageData(bitmap, bitmap.displayWidth, bitmap.displayHeight);
        frames.push(rgbaToRgb565(imageData));
        let ms = DEFAULT_FRAME_MS;
        if (typeof bitmap.duration === "number" && bitmap.duration > 0) {
          ms = Math.max(ANIM_MIN_FRAME_MS, Math.round(bitmap.duration / 1000));
        }
        delaysMs.push(ms);
      } finally {
        bitmap.close?.();
      }
    }

    let note;
    if (totalInFile > maxFrames) {
      note = `GIF 共 ${totalInFile} 帧，已截取前 ${maxFrames} 帧。`;
    } else if (totalInFile > 1) {
      note = `GIF ${totalInFile} 帧 · ImageDecoder`;
    }
    return { frames, delaysMs, note };
  } finally {
    decoder.close?.();
  }
}

/**
 * @param {Blob} blob
 * @param {{ maxFrames?: number, fileName?: string }} [opts]
 * @returns {Promise<{ gfm1: Uint8Array, frameCount: number, note?: string }>}
 */
export async function encodeBlobToGfm1(blob, opts = {}) {
  const { frames, delaysMs, note } = await decodeBlobToFrames(blob, opts);
  const gfm1 = buildGfm1Blob(frames, delaysMs);
  return { gfm1, frameCount: frames.length, note };
}
