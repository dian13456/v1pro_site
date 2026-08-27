import { decompressFrames, parseGIF } from "gifuct-js";

const DEFAULT_GIF_FRAME_DELAY_MS = 100;
const MAX_GFM1_FRAME_DELAY_MS = 0xffff;

function normalizeGifFrameDelay(value: number): number {
  const delay = Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_GIF_FRAME_DELAY_MS;
  return Math.max(1, Math.min(MAX_GFM1_FRAME_DELAY_MS, delay));
}

/**
 * Read timing from the original GIF container instead of FFprobe output.
 * Some FFmpeg WebAssembly builds omit per-frame duration fields, which made
 * the old fallback turn valid 50 ms frames into 100 ms frames.
 */
export async function readGifFrameDelays(source: Blob): Promise<number[]> {
  const parsed = parseGIF(await source.arrayBuffer());
  return decompressFrames(parsed, false).map((frame) => normalizeGifFrameDelay(frame.delay));
}
