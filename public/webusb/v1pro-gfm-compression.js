/**
 * Browser-side persistent GFM compression for an already-built GFM1 payload.
 *
 * The byte layouts and fitting rules mirror Shared_GUI/tools/usb_send_gif.py:
 * - GFM2 tiled frame-to-frame deltas;
 * - optional GFM2 anti-tearing wipe stages (enabled by default);
 * - persistent, independently-decodable 4 KiB raw-LZ4 blocks in GFM3;
 * - duration-preserving measured-byte fitting down to 20 fps, followed by the
 *   minimum measured 20 fps speed-up only when the floor still does not fit.
 */
import { lz4CompressBlock } from "./v1pro-transport-codec.js?v=1.2.36";

const COMMON_HEADER_BYTES = 56;
const GFM1_VERSION = 1;
const GFM2_VERSION = 2;
const GFM3_VERSION = 3;
const GFM2_INDEX_BYTES = 12;
const GFM3_INDEX_BYTES = 16;
const REGION_HEADER_BYTES = 8;
const KEYFRAME_FLAG = 0x01;
const TILE_WIDTH = 16;
const TILE_HEIGHT = 8;
const MAX_REGIONS = 32;
const KEYFRAME_INTERVAL = 300;
const DELTA_THRESHOLD = 0.7;
const ANTITEAR_CHANGE_THRESHOLD = 0.95;
const ANTITEAR_DONOR_WINDOW = 4;
const BLOCK_RAW_BYTES = 4096;
const BLOCK_HEADER_BYTES = 5;
const BLOCK_METHOD_RAW = 0;
const BLOCK_METHOD_LZ4 = 1;
const ANIM_MIN_FRAME_MS = 1;
const DEFAULT_FRAME_MS = 100;
const DEFAULT_MAX_FPS = 45;
const DEFAULT_FIT_MIN_FPS = 20;
const DEFAULT_MAX_SPEED = 10;
const ANIM_FLASH_MAX_BYTES = 0x02000000 - 0x1000;

const ASCII = new TextEncoder();
const MAGIC_GFM1 = ASCII.encode("GFM1");
const MAGIC_GFM2 = ASCII.encode("GFM2");
const MAGIC_GFM3 = ASCII.encode("GFM3");
const RESERVED_GFM2 = Uint8Array.from([
  0x49, 0x58, 0x31, 0x32,
  GFM2_INDEX_BYTES, TILE_WIDTH, TILE_HEIGHT, MAX_REGIONS,
]);
const RESERVED_GFM3 = Uint8Array.from([
  0x4c, 0x5a, 0x34, 0x50,
  GFM3_INDEX_BYTES, BLOCK_HEADER_BYTES, 12, MAX_REGIONS,
]);

function toUint8Array(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError("GFM1 input must be an ArrayBuffer or Uint8Array");
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function matchesMagic(bytes, magic) {
  return magic.every((value, index) => bytes[index] === value);
}

function readMagic(bytes) {
  if (matchesMagic(bytes, MAGIC_GFM1)) return "GFM1";
  if (matchesMagic(bytes, MAGIC_GFM2)) return "GFM2";
  if (matchesMagic(bytes, MAGIC_GFM3)) return "GFM3";
  return "";
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function sumNumbers(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function normalizeDelay(value) {
  let delay = Math.trunc(Number(value));
  if (!Number.isFinite(delay) || delay === 0) delay = DEFAULT_FRAME_MS;
  return Math.max(ANIM_MIN_FRAME_MS, Math.min(0xffff, delay));
}

function parsePrebuiltGfm1(input) {
  const bytes = toUint8Array(input);
  if (bytes.length < COMMON_HEADER_BYTES || !matchesMagic(bytes, MAGIC_GFM1)) {
    throw new Error("只支持预构建 GFM1 输入。");
  }
  const view = dataView(bytes);
  const version = view.getUint16(4, true);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const frameCount = view.getUint16(10, true);
  const declaredPixelBytes = view.getUint32(12, true);
  if (version !== GFM1_VERSION) throw new Error(`不支持的 GFM1 版本：${version}`);
  if (width <= 0 || height <= 0 || frameCount <= 0) {
    throw new Error("GFM1 屏幕尺寸或帧数无效。");
  }
  const frameBytes = width * height * 2;
  const expectedPixelBytes = frameCount * frameBytes;
  const pixelBase = COMMON_HEADER_BYTES + frameCount * 2;
  const expectedLength = pixelBase + expectedPixelBytes;
  if (
    !Number.isSafeInteger(expectedPixelBytes) ||
    declaredPixelBytes !== expectedPixelBytes ||
    bytes.length !== expectedLength
  ) {
    throw new Error(
      `GFM1 长度无效：${bytes.length}，期望 ${expectedLength}。`,
    );
  }

  const delays = [];
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    delays.push(normalizeDelay(view.getUint16(COMMON_HEADER_BYTES + index * 2, true)));
    const start = pixelBase + index * frameBytes;
    frames.push(bytes.subarray(start, start + frameBytes));
  }
  return { width, height, frameBytes, frames, delays };
}

function effectiveFps(value) {
  const fps = Math.trunc(Number(value));
  if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_MAX_FPS;
  return Math.max(1, Math.min(45, fps));
}

function materialFrameDelayPattern(frameCount, requestedFps) {
  const count = Math.max(0, Math.trunc(frameCount));
  if (count === 0) return [];
  const fps = effectiveFps(requestedFps);
  const pattern = [];
  let previousMs = 0;
  for (let index = 1; index <= count; index += 1) {
    const elapsedMs = Math.floor((index * 1000 + fps - 1) / fps);
    pattern.push(Math.max(1, elapsedMs - previousMs));
    previousMs = elapsedMs;
  }
  return pattern;
}

function materialMinFrameDelay(requestedFps) {
  const fps = effectiveFps(requestedFps);
  return Math.floor((1000 + fps - 1) / fps);
}

function clampMaterialDelays(delays, requestedFps) {
  const minimums = materialFrameDelayPattern(delays.length, requestedFps);
  return delays.map((delay, index) => Math.max(minimums[index], normalizeDelay(delay)));
}

function writeCommonHeader(out, magic, version, width, height, frameCount, dataBytes) {
  if (frameCount <= 0 || frameCount > 0xffff) {
    throw new Error(`GFM 帧数超出 uint16：${frameCount}`);
  }
  out.set(magic, 0);
  const view = dataView(out);
  view.setUint16(4, version, true);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint16(10, frameCount, true);
  view.setUint32(12, dataBytes, true);
}

function buildGfm1Legacy(frames, delays, width, height) {
  if (frames.length === 0 || frames.length !== delays.length) {
    throw new Error("GFM1 帧与延时数量不一致。");
  }
  const frameBytes = width * height * 2;
  const pixelBytes = frames.length * frameBytes;
  const out = new Uint8Array(COMMON_HEADER_BYTES + frames.length * 2 + pixelBytes);
  writeCommonHeader(
    out,
    MAGIC_GFM1,
    GFM1_VERSION,
    width,
    height,
    frames.length,
    pixelBytes,
  );
  const view = dataView(out);
  let pixelOffset = COMMON_HEADER_BYTES + frames.length * 2;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame.length !== frameBytes) throw new Error("GFM1 RGB565 帧大小错误。");
    view.setUint16(COMMON_HEADER_BYTES + index * 2, normalizeDelay(delays[index]), true);
    out.set(frame, pixelOffset);
    pixelOffset += frameBytes;
  }
  return out;
}

function rangesEqual(left, right, start, length) {
  const end = start + length;
  for (let index = start; index < end; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function dirtyRects(previous, current, width, height) {
  const rowBytes = width * 2;
  const active = new Map();
  const rects = [];

  for (let y = 0; y < height; y += TILE_HEIGHT) {
    const tileHeight = Math.min(TILE_HEIGHT, height - y);
    const dirty = [];
    for (let x = 0; x < width; x += TILE_WIDTH) {
      const tileWidth = Math.min(TILE_WIDTH, width - x);
      const span = tileWidth * 2;
      let changed = false;
      for (let line = 0; line < tileHeight; line += 1) {
        const offset = (y + line) * rowBytes + x * 2;
        if (!rangesEqual(previous, current, offset, span)) {
          changed = true;
          break;
        }
      }
      dirty.push(changed);
    }

    const runs = [];
    let tileX = 0;
    while (tileX < dirty.length) {
      if (!dirty[tileX]) {
        tileX += 1;
        continue;
      }
      const start = tileX;
      while (tileX + 1 < dirty.length && dirty[tileX + 1]) tileX += 1;
      runs.push([start, tileX + 1]);
      tileX += 1;
    }

    const currentKeys = new Set(runs.map(([start, end]) => `${start}:${end}`));
    for (const [key, rect] of active) {
      if (!currentKeys.has(key)) {
        rects.push(rect);
        active.delete(key);
      }
    }
    for (const [start, end] of runs) {
      const key = `${start}:${end}`;
      const rect = active.get(key);
      if (rect) {
        rect[3] += tileHeight;
      } else {
        const x0 = start * TILE_WIDTH;
        const x1 = Math.min(width, end * TILE_WIDTH);
        active.set(key, [x0, y, x1 - x0, tileHeight]);
      }
    }
  }

  rects.push(...active.values());
  rects.sort((left, right) => left[1] - right[1] || left[0] - right[0]);
  return rects;
}

function lexicographicallyLess(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

function mergeDirtyRects(rects, maxRegions = MAX_REGIONS) {
  const limit = Math.max(1, Math.trunc(maxRegions));
  const merged = rects.map((rect) => rect.map((value) => Math.trunc(value)));
  while (merged.length > limit) {
    let best = null;
    for (let leftIndex = 0; leftIndex < merged.length - 1; leftIndex += 1) {
      const [ax, ay, aw, ah] = merged[leftIndex];
      const areaA = aw * ah;
      for (let rightIndex = leftIndex + 1; rightIndex < merged.length; rightIndex += 1) {
        const [bx, by, bw, bh] = merged[rightIndex];
        const x0 = Math.min(ax, bx);
        const y0 = Math.min(ay, by);
        const x1 = Math.max(ax + aw, bx + bw);
        const y1 = Math.max(ay + ah, by + bh);
        const bbox = [x0, y0, x1 - x0, y1 - y0];
        const bboxArea = bbox[2] * bbox[3];
        const byteCost = 2 * (bboxArea - areaA - bw * bh) - REGION_HEADER_BYTES;
        const score = [byteCost, bboxArea, y0, x0, leftIndex, rightIndex];
        if (!best || lexicographicallyLess(score, best.score)) {
          best = { score, leftIndex, rightIndex, bbox };
        }
      }
    }
    if (!best) break;
    merged[best.leftIndex] = best.bbox;
    merged.splice(best.rightIndex, 1);
  }
  merged.sort(
    (left, right) =>
      left[1] - right[1] ||
      left[0] - right[0] ||
      left[3] - right[3] ||
      left[2] - right[2],
  );
  return merged;
}

function copyRegionPixels(frame, width, rect, destination, destinationOffset) {
  const [x, y, regionWidth, regionHeight] = rect;
  const rowBytes = width * 2;
  const span = regionWidth * 2;
  let target = destinationOffset;
  for (let line = 0; line < regionHeight; line += 1) {
    const source = (y + line) * rowBytes + x * 2;
    destination.set(frame.subarray(source, source + span), target);
    target += span;
  }
  return target;
}

function isHardCut(previous, current, threshold = ANTITEAR_CHANGE_THRESHOLD) {
  if (previous.length !== current.length || previous.length === 0 || previous.length % 2) {
    return false;
  }
  let allSame = true;
  let unchanged = 0;
  const totalPixels = previous.length / 2;
  const maxUnchanged = Math.trunc(totalPixels * Math.max(0, 1 - threshold));
  for (let offset = 0; offset < previous.length; offset += 2) {
    if (previous[offset] === current[offset] && previous[offset + 1] === current[offset + 1]) {
      unchanged += 1;
      if (unchanged > maxUnchanged) return false;
    } else {
      allSame = false;
    }
  }
  return !allSame;
}

function halfWipeFrame(previous, current, width, height) {
  const splitY = Math.min(
    height,
    Math.floor((Math.floor(height / 2) + TILE_HEIGHT - 1) / TILE_HEIGHT) * TILE_HEIGHT,
  );
  const split = splitY * width * 2;
  const out = new Uint8Array(previous.length);
  out.set(current.subarray(0, split), 0);
  out.set(previous.subarray(split), split);
  return out;
}

function prepareAntitearSequence(frames, delays, width, height, requestedFps) {
  if (frames.length !== delays.length) throw new Error("防撕裂帧与延时数量不一致。");
  if (frames.length === 0) {
    return {
      frames: [], delays: [], sourceIndices: [], checkpointEligible: [], inserted: 0,
    };
  }

  const floorMs = Math.max(ANIM_MIN_FRAME_MS, materialMinFrameDelay(requestedFps));
  const normalizedDelays = delays.map((delay) => Math.max(floorMs, normalizeDelay(delay)));
  const outFrames = [frames[0]];
  const outDelays = [normalizedDelays[0]];
  const sourceIndices = [0];
  const checkpointEligible = [true];
  const originalFlags = [true];
  let inserted = 0;

  const borrowFromPriorSourceFrames = (amount) => {
    let remaining = Math.trunc(amount);
    const plan = [];
    let originalsSeen = 0;
    for (let pos = outDelays.length - 1; pos >= 0; pos -= 1) {
      if (!originalFlags[pos]) continue;
      originalsSeen += 1;
      const available = Math.max(0, outDelays[pos] - floorMs);
      const take = Math.min(available, remaining);
      if (take) {
        plan.push([pos, take]);
        remaining -= take;
        if (remaining <= 0) break;
      }
      if (originalsSeen >= ANTITEAR_DONOR_WINDOW) break;
    }
    if (remaining > 0) return false;
    for (const [pos, take] of plan) outDelays[pos] -= take;
    return true;
  };

  for (let sourceIndex = 1; sourceIndex < frames.length; sourceIndex += 1) {
    const previous = frames[sourceIndex - 1];
    const current = frames[sourceIndex];
    let delay = normalizedDelays[sourceIndex];
    let transformed = false;
    if (isHardCut(previous, current)) {
      if (borrowFromPriorSourceFrames(floorMs)) {
        outFrames.push(halfWipeFrame(previous, current, width, height));
        outDelays.push(floorMs);
        sourceIndices.push(sourceIndex);
        checkpointEligible.push(false);
        originalFlags.push(false);
        transformed = true;
      } else if (delay >= floorMs * 2) {
        outFrames.push(halfWipeFrame(previous, current, width, height));
        outDelays.push(floorMs);
        sourceIndices.push(sourceIndex);
        checkpointEligible.push(false);
        originalFlags.push(false);
        delay -= floorMs;
        transformed = true;
      }
    }
    outFrames.push(current);
    outDelays.push(delay);
    sourceIndices.push(sourceIndex);
    checkpointEligible.push(!transformed);
    originalFlags.push(true);
    if (transformed) inserted += 1;
  }

  if (
    frames.length >= 2 &&
    isHardCut(frames[frames.length - 1], frames[0]) &&
    borrowFromPriorSourceFrames(floorMs)
  ) {
    outFrames.push(halfWipeFrame(frames[frames.length - 1], frames[0], width, height));
    outDelays.push(floorMs);
    sourceIndices.push(0);
    checkpointEligible.push(false);
    originalFlags.push(false);
    inserted += 1;
  }

  if (outFrames.length > 0xffff) throw new Error("防撕裂后的帧数超过 65535。");
  if (sumNumbers(outDelays) !== sumNumbers(normalizedDelays)) {
    throw new Error("防撕裂处理改变了素材总时长。");
  }
  return {
    frames: outFrames,
    delays: outDelays,
    sourceIndices,
    checkpointEligible,
    inserted,
  };
}

function buildGfm2(frames, delays, width, height, metadata = {}) {
  const frameBytes = width * height * 2;
  if (frames.length === 0 || frames.length !== delays.length || frames.length > 0xffff) {
    throw new Error("GFM2 帧数或延时无效。");
  }
  if (frames.some((frame) => frame.length !== frameBytes)) {
    throw new Error("GFM2 RGB565 帧大小错误。");
  }
  const sourceIndices = metadata.sourceIndices ?? null;
  const checkpointEligible = metadata.checkpointEligible ?? null;
  if (sourceIndices && sourceIndices.length !== frames.length) {
    throw new Error("GFM2 源帧索引数量错误。");
  }
  if (checkpointEligible && checkpointEligible.length !== frames.length) {
    throw new Error("GFM2 关键帧元数据数量错误。");
  }

  const entries = [];
  const chunks = [];
  let dataOffset = 0;
  let previous = null;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const sourceIndex = sourceIndices ? sourceIndices[index] : index;
    const canCheckpoint = checkpointEligible ? checkpointEligible[index] : true;
    const periodicKey = canCheckpoint && sourceIndex > 0 && sourceIndex % KEYFRAME_INTERVAL === 0;
    let forceKey = previous === null || periodicKey;
    let flags = 0;
    let regionCount = 0;
    let chunk = null;

    if (!forceKey) {
      let rects = dirtyRects(previous, frame, width, height);
      if (rects.length > MAX_REGIONS) rects = mergeDirtyRects(rects, MAX_REGIONS);
      const deltaSize = rects.reduce(
        (sum, rect) => sum + REGION_HEADER_BYTES + rect[2] * rect[3] * 2,
        0,
      );
      if (deltaSize < Math.trunc(frameBytes * DELTA_THRESHOLD)) {
        chunk = new Uint8Array(deltaSize);
        const chunkView = dataView(chunk);
        let offset = 0;
        for (const rect of rects) {
          chunkView.setUint16(offset, rect[0], true);
          chunkView.setUint16(offset + 2, rect[1], true);
          chunkView.setUint16(offset + 4, rect[2], true);
          chunkView.setUint16(offset + 6, rect[3], true);
          offset = copyRegionPixels(frame, width, rect, chunk, offset + REGION_HEADER_BYTES);
        }
        regionCount = rects.length;
      } else {
        forceKey = true;
      }
    }

    if (forceKey) {
      flags = KEYFRAME_FLAG;
      chunk = frame;
      regionCount = 0;
    }
    entries.push({
      dataOffset,
      dataLength: chunk.length,
      delay: normalizeDelay(delays[index]),
      flags,
      regionCount,
    });
    chunks.push(chunk);
    dataOffset += chunk.length;
    previous = frame;
  }

  const out = new Uint8Array(
    COMMON_HEADER_BYTES + frames.length * GFM2_INDEX_BYTES + dataOffset,
  );
  writeCommonHeader(out, MAGIC_GFM2, GFM2_VERSION, width, height, frames.length, dataOffset);
  out.set(RESERVED_GFM2, 16);
  const view = dataView(out);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const offset = COMMON_HEADER_BYTES + index * GFM2_INDEX_BYTES;
    view.setUint32(offset, entry.dataOffset, true);
    view.setUint32(offset + 4, entry.dataLength, true);
    view.setUint16(offset + 8, entry.delay, true);
    out[offset + 10] = entry.flags;
    out[offset + 11] = entry.regionCount;
  }
  let outputOffset = COMMON_HEADER_BYTES + frames.length * GFM2_INDEX_BYTES;
  for (const chunk of chunks) {
    out.set(chunk, outputOffset);
    outputOffset += chunk.length;
  }
  return out;
}

function encodeGfm3Blocks(raw) {
  if (raw.length === 0 || raw.length % 2) {
    throw new Error("GFM3 块输入必须是非空偶数字节 RGB565。");
  }
  const parts = [];
  for (let offset = 0; offset < raw.length; offset += BLOCK_RAW_BYTES) {
    const source = raw.subarray(offset, Math.min(raw.length, offset + BLOCK_RAW_BYTES));
    const packed = lz4CompressBlock(source);
    const useLz4 = packed.length < source.length;
    const stored = useLz4 ? packed : source;
    const block = new Uint8Array(BLOCK_HEADER_BYTES + stored.length);
    const view = dataView(block);
    block[0] = useLz4 ? BLOCK_METHOD_LZ4 : BLOCK_METHOD_RAW;
    view.setUint16(1, source.length, true);
    view.setUint16(3, stored.length, true);
    block.set(stored, BLOCK_HEADER_BYTES);
    parts.push(block);
  }
  return concatBytes(parts);
}

function convertGfm2ToGfm3(gfm2) {
  if (gfm2.length < COMMON_HEADER_BYTES || !matchesMagic(gfm2, MAGIC_GFM2)) {
    throw new Error("GFM3 转换需要 GFM2 输入。");
  }
  const sourceView = dataView(gfm2);
  const version = sourceView.getUint16(4, true);
  const width = sourceView.getUint16(6, true);
  const height = sourceView.getUint16(8, true);
  const frameCount = sourceView.getUint16(10, true);
  const dataBytes = sourceView.getUint32(12, true);
  if (version !== GFM2_VERSION || !width || !height || !frameCount) {
    throw new Error("GFM2 版本、尺寸或帧数无效。");
  }
  const dataBase = COMMON_HEADER_BYTES + frameCount * GFM2_INDEX_BYTES;
  if (dataBase + dataBytes !== gfm2.length) throw new Error("GFM2 数据长度无效。");

  const frameBytes = width * height * 2;
  const entries = [];
  const chunks = [];
  let outputOffset = 0;
  let expectedInputOffset = 0;
  let havePrevious = false;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const entryOffset = COMMON_HEADER_BYTES + frameIndex * GFM2_INDEX_BYTES;
    const dataOffset = sourceView.getUint32(entryOffset, true);
    const dataLength = sourceView.getUint32(entryOffset + 4, true);
    const delay = sourceView.getUint16(entryOffset + 8, true);
    const flags = gfm2[entryOffset + 10];
    const regionCount = gfm2[entryOffset + 11];
    if (dataOffset !== expectedInputOffset || dataOffset + dataLength > dataBytes) {
      throw new Error("GFM2 帧索引越界或不连续。");
    }
    let position = dataBase + dataOffset;
    const sourceEnd = position + dataLength;
    let rawPixelLength = 0;
    let chunk;

    if (flags === KEYFRAME_FLAG) {
      if (regionCount !== 0 || dataLength !== frameBytes) {
        throw new Error("GFM2 关键帧无效。");
      }
      chunk = encodeGfm3Blocks(gfm2.subarray(position, sourceEnd));
      rawPixelLength = frameBytes;
      havePrevious = true;
    } else if (flags === 0) {
      if (!havePrevious || regionCount > MAX_REGIONS) {
        throw new Error("GFM2 delta 依赖无效。");
      }
      const parts = [];
      for (let regionIndex = 0; regionIndex < regionCount; regionIndex += 1) {
        if (position + REGION_HEADER_BYTES > sourceEnd) {
          throw new Error("GFM2 区域头被截断。");
        }
        const x = sourceView.getUint16(position, true);
        const y = sourceView.getUint16(position + 2, true);
        const regionWidth = sourceView.getUint16(position + 4, true);
        const regionHeight = sourceView.getUint16(position + 6, true);
        const geometry = gfm2.slice(position, position + REGION_HEADER_BYTES);
        position += REGION_HEADER_BYTES;
        if (
          !regionWidth ||
          !regionHeight ||
          x + regionWidth > width ||
          y + regionHeight > height
        ) {
          throw new Error("GFM2 区域尺寸无效。");
        }
        const regionBytes = regionWidth * regionHeight * 2;
        if (position + regionBytes > sourceEnd) throw new Error("GFM2 区域像素被截断。");
        if (rawPixelLength > frameBytes - regionBytes) {
          throw new Error("GFM2 delta 原始像素超过一帧。");
        }
        parts.push(geometry, encodeGfm3Blocks(gfm2.subarray(position, position + regionBytes)));
        rawPixelLength += regionBytes;
        position += regionBytes;
      }
      if (position !== sourceEnd) throw new Error("GFM2 delta 数据长度不一致。");
      chunk = concatBytes(parts);
      if (regionCount === 0 && (chunk.length || rawPixelLength || dataLength)) {
        throw new Error("GFM2 空 delta 无效。");
      }
    } else {
      throw new Error(`GFM2 帧 flags 无效：${flags}`);
    }

    entries.push({
      outputOffset,
      storedLength: chunk.length,
      rawPixelLength,
      delay: normalizeDelay(delay),
      flags,
      regionCount,
    });
    chunks.push(chunk);
    outputOffset += chunk.length;
    expectedInputOffset += dataLength;
  }
  if (expectedInputOffset !== dataBytes) throw new Error("GFM2 存在未引用数据。");

  const out = new Uint8Array(
    COMMON_HEADER_BYTES + frameCount * GFM3_INDEX_BYTES + outputOffset,
  );
  writeCommonHeader(out, MAGIC_GFM3, GFM3_VERSION, width, height, frameCount, outputOffset);
  out.set(RESERVED_GFM3, 16);
  const view = dataView(out);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const offset = COMMON_HEADER_BYTES + index * GFM3_INDEX_BYTES;
    view.setUint32(offset, entry.outputOffset, true);
    view.setUint32(offset + 4, entry.storedLength, true);
    view.setUint32(offset + 8, entry.rawPixelLength, true);
    view.setUint16(offset + 12, entry.delay, true);
    out[offset + 14] = entry.flags;
    out[offset + 15] = entry.regionCount;
  }
  let target = COMMON_HEADER_BYTES + frameCount * GFM3_INDEX_BYTES;
  for (const chunk of chunks) {
    out.set(chunk, target);
    target += chunk.length;
  }
  return out;
}

function gfm2GeometrySupported(width, height) {
  return width === 320 && (height === 170 || height === 240);
}

function buildSmallestFormat(frames, delays, config) {
  const effectiveDelays = clampMaterialDelays(delays, config.maxFps);
  const legacy = buildGfm1Legacy(frames, effectiveDelays, config.width, config.height);
  if (
    !config.gfm2Enabled ||
    !gfm2GeometrySupported(config.width, config.height) ||
    frames.length < 2
  ) {
    return legacy;
  }

  let gfm2Frames = frames;
  let gfm2Delays = effectiveDelays;
  let metadata = {};
  let inserted = 0;
  if (config.antiTearing) {
    const prepared = prepareAntitearSequence(
      frames,
      effectiveDelays,
      config.width,
      config.height,
      config.maxFps,
    );
    gfm2Frames = prepared.frames;
    gfm2Delays = prepared.delays;
    metadata = {
      sourceIndices: prepared.sourceIndices,
      checkpointEligible: prepared.checkpointEligible,
    };
    inserted = prepared.inserted;
  }

  let differential = buildGfm2(
    gfm2Frames,
    gfm2Delays,
    config.width,
    config.height,
    metadata,
  );
  if (config.gfm3Enabled) {
    const persistent = convertGfm2ToGfm3(differential);
    if (persistent.length < differential.length) differential = persistent;
  }
  return inserted > 0 || differential.length < legacy.length ? differential : legacy;
}

function downsampleFramesToCount(frames, delays, keepCount) {
  const count = frames.length;
  if (keepCount >= count) return { frames, delays };
  if (keepCount <= 0) throw new Error("Flash 太小，无法保留任何帧。");
  const outputFrames = [];
  const outputDelays = [];
  for (let index = 0; index < keepCount; index += 1) {
    const start = Math.floor((index * count) / keepCount);
    let end = Math.floor(((index + 1) * count) / keepCount);
    if (end <= start) end = Math.min(count, start + 1);
    outputFrames.push(frames[start]);
    let delay = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      delay += delays[sourceIndex];
    }
    outputDelays.push(Math.max(1, Math.min(0xffff, Math.trunc(delay))));
  }
  return { frames: outputFrames, delays: outputDelays };
}

function readContainerDelays(bytes) {
  const magic = readMagic(bytes);
  const view = dataView(bytes);
  const count = view.getUint16(10, true);
  const delays = [];
  let stride;
  let delayOffset;
  if (magic === "GFM1") {
    stride = 2;
    delayOffset = COMMON_HEADER_BYTES;
  } else if (magic === "GFM2") {
    stride = GFM2_INDEX_BYTES;
    delayOffset = COMMON_HEADER_BYTES + 8;
  } else if (magic === "GFM3") {
    stride = GFM3_INDEX_BYTES;
    delayOffset = COMMON_HEADER_BYTES + 12;
  } else {
    throw new Error("生成了未知 GFM 格式。");
  }
  for (let index = 0; index < count; index += 1) {
    delays.push(normalizeDelay(view.getUint16(delayOffset + index * stride, true)));
  }
  return delays;
}

function finalizeResult(encoded, speed, mode, selectedFrameCount, maxBytes) {
  if (encoded.length > maxBytes) {
    throw new Error(`最终 GFM ${encoded.length} 字节超过 Flash 上限 ${maxBytes}。`);
  }
  const view = dataView(encoded);
  const magic = readMagic(encoded);
  const frameCount = view.getUint16(10, true);
  const delays = readContainerDelays(encoded);
  const durationMs = Math.max(1, sumNumbers(delays));
  // Anti-tearing can insert intermediate wipe frames without changing the
  // source cadence. Report the selected source-frame FPS, as the GUI does,
  // rather than inflating it by the inserted container frames.
  const fps = (selectedFrameCount * 1000) / durationMs;
  const modeNote = {
    original: "无需容量降帧",
    duration: "保持时长自动降帧",
    accelerated: `${speed.toFixed(3)}x 自动加速`,
  }[mode];
  const inserted = frameCount - selectedFrameCount;
  const insertedNote = inserted > 0 ? ` · 防撕裂增加 ${inserted} 帧` : "";
  return {
    bytes: encoded,
    magic,
    frameCount,
    sourceFrameCount: selectedFrameCount,
    fps,
    speed,
    note:
      `${magic} · ${frameCount} 帧 · ${encoded.length}/${maxBytes} 字节 · ` +
      `${modeNote}${insertedNote}`,
  };
}

function readBooleanOption(options, longName, shortName, defaultValue) {
  if (options[longName] !== undefined) return Boolean(options[longName]);
  if (shortName && options[shortName] !== undefined) return Boolean(options[shortName]);
  return defaultValue;
}

/**
 * Optimize a strict prebuilt GFM1 payload for persistent storage.
 *
 * @param {ArrayBuffer|ArrayBufferView} input complete GFM1 bytes
 * @param {{
 *   maxBytes?: number,
 *   maxPayloadBytes?: number,
 *   maxFps?: number,
 *   fitMinFps?: number,
 *   maxSpeed?: number,
 *   autoSpeed?: boolean,
 *   gfm2Enabled?: boolean,
 *   gfm3Enabled?: boolean,
 *   gfm2?: boolean,
 *   gfm3?: boolean,
 *   antiTearing?: boolean,
 *   antitear?: boolean,
 * }} [options]
 * @returns {{
 *   bytes: Uint8Array,
 *   magic: "GFM1"|"GFM2"|"GFM3",
 *   frameCount: number,
 *   sourceFrameCount: number,
 *   fps: number,
 *   speed: number,
 *   note: string,
 * }}
 */
export function optimizePrebuiltGfm1(input, options = {}) {
  const parsed = parsePrebuiltGfm1(input);
  const requestedMaxBytes = options.maxBytes ?? options.maxPayloadBytes ?? ANIM_FLASH_MAX_BYTES;
  let maxBytes = Math.trunc(Number(requestedMaxBytes));
  if (!Number.isFinite(maxBytes)) maxBytes = ANIM_FLASH_MAX_BYTES;
  maxBytes = Math.min(ANIM_FLASH_MAX_BYTES, Math.max(COMMON_HEADER_BYTES, maxBytes));

  const fitMinFpsValue = Number(options.fitMinFps ?? DEFAULT_FIT_MIN_FPS);
  const fitMinFps = Number.isFinite(fitMinFpsValue)
    ? Math.max(0.1, fitMinFpsValue)
    : DEFAULT_FIT_MIN_FPS;
  const maxSpeedValue = Number(options.maxSpeed ?? DEFAULT_MAX_SPEED);
  const maxSpeed = Number.isFinite(maxSpeedValue)
    ? Math.max(1, maxSpeedValue)
    : DEFAULT_MAX_SPEED;
  const gfm2Enabled = readBooleanOption(options, "gfm2Enabled", "gfm2", true);
  const config = {
    width: parsed.width,
    height: parsed.height,
    maxFps: effectiveFps(options.maxFps ?? DEFAULT_MAX_FPS),
    gfm2Enabled,
    gfm3Enabled:
      gfm2Enabled && readBooleanOption(options, "gfm3Enabled", "gfm3", true),
    antiTearing: readBooleanOption(options, "antiTearing", "antitear", true),
  };
  const autoSpeed = options.autoSpeed !== false;
  const frames = parsed.frames;
  const delays = parsed.delays;
  const totalMs = Math.max(1, sumNumbers(delays));
  const maxLegacyFrames = Math.floor(
    (maxBytes - COMMON_HEADER_BYTES) / (parsed.frameBytes + 2),
  );
  if (maxLegacyFrames <= 0) throw new Error("Flash 上限过小，无法容纳一帧 GFM。");

  const full = buildSmallestFormat(frames, delays, config);
  if (full.length <= maxBytes) {
    return finalizeResult(full, 1, "original", frames.length, maxBytes);
  }

  const minKeep = Math.max(
    1,
    Math.min(frames.length, Math.ceil((totalMs * fitMinFps) / 1000)),
  );
  const measuredPath =
    config.gfm2Enabled && gfm2GeometrySupported(parsed.width, parsed.height) && frames.length >= 2;

  if (measuredPath) {
    const cache = new Map();
    const candidate = (count) => {
      const safeCount = Math.max(1, Math.min(Math.trunc(count), frames.length));
      if (cache.has(safeCount)) return cache.get(safeCount);
      const sampled = downsampleFramesToCount(frames, delays, safeCount);
      const value = {
        ...sampled,
        encoded: buildSmallestFormat(sampled.frames, sampled.delays, config),
      };
      cache.set(safeCount, value);
      return value;
    };

    const minimum = candidate(minKeep);
    if (minimum.encoded.length > maxBytes) {
      if (!autoSpeed) {
        throw new Error(
          `Flash 空间不足：${fitMinFps}fps 候选需要 ${minimum.encoded.length} 字节，` +
            `上限 ${maxBytes} 字节。`,
        );
      }
      const targetFps = Math.max(1, Math.ceil(fitMinFps));
      const acceleratedCache = new Map();
      const acceleratedCandidate = (count) => {
        const safeCount = Math.max(1, Math.min(Math.trunc(count), minKeep - 1));
        if (acceleratedCache.has(safeCount)) return acceleratedCache.get(safeCount);
        const sampled = downsampleFramesToCount(frames, delays, safeCount);
        const acceleratedDelays = materialFrameDelayPattern(safeCount, targetFps);
        const value = {
          frames: sampled.frames,
          delays: acceleratedDelays,
          encoded: buildSmallestFormat(sampled.frames, acceleratedDelays, config),
        };
        acceleratedCache.set(safeCount, value);
        return value;
      };

      let low = 1;
      let high = minKeep - 1;
      let bestCount = 0;
      let best = null;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const value = acceleratedCandidate(mid);
        if (value.encoded.length <= maxBytes) {
          bestCount = mid;
          best = value;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      for (
        let count = bestCount + 1;
        count <= Math.min(minKeep - 1, bestCount + 8);
        count += 1
      ) {
        const value = acceleratedCandidate(count);
        if (value.encoded.length <= maxBytes && count > bestCount) {
          bestCount = count;
          best = value;
        }
      }
      if (!best || bestCount <= 0) {
        throw new Error(
          `Flash 空间不足：${fitMinFps}fps 候选需要 ${minimum.encoded.length} 字节，` +
            `上限 ${maxBytes} 字节。`,
        );
      }
      const acceleratedMs = Math.max(1, sumNumbers(best.delays));
      const speed = totalMs / acceleratedMs;
      if (speed > maxSpeed + 1e-6) {
        throw new Error(
          `适配需要 ${speed.toFixed(2)}x，超过自动加速上限 ${maxSpeed.toFixed(2)}x。`,
        );
      }
      return finalizeResult(
        best.encoded,
        speed,
        "accelerated",
        bestCount,
        maxBytes,
      );
    }

    let low = minKeep;
    let high = frames.length - 1;
    let bestCount = minKeep;
    let best = minimum;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const value = candidate(mid);
      if (value.encoded.length <= maxBytes) {
        bestCount = mid;
        best = value;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    for (
      let count = bestCount + 1;
      count <= Math.min(frames.length, bestCount + 8);
      count += 1
    ) {
      const value = candidate(count);
      if (value.encoded.length <= maxBytes && count > bestCount) {
        bestCount = count;
        best = value;
      }
    }
    return finalizeResult(best.encoded, 1, "duration", bestCount, maxBytes);
  }

  if (frames.length <= maxLegacyFrames) {
    return finalizeResult(full, 1, "original", frames.length, maxBytes);
  }
  if (maxLegacyFrames >= minKeep) {
    const sampled = downsampleFramesToCount(frames, delays, maxLegacyFrames);
    const encoded = buildSmallestFormat(sampled.frames, sampled.delays, config);
    return finalizeResult(encoded, 1, "duration", sampled.frames.length, maxBytes);
  }
  if (!autoSpeed) {
    throw new Error(
      `Flash 空间不足：保持 ${fitMinFps}fps 需要 ${minKeep} 帧，` +
        `当前最多 ${maxLegacyFrames} 帧。`,
    );
  }
  const keepCount = Math.max(1, Math.min(maxLegacyFrames, minKeep - 1));
  const sampled = downsampleFramesToCount(frames, delays, keepCount);
  const targetFps = Math.max(1, Math.ceil(fitMinFps));
  const acceleratedDelays = materialFrameDelayPattern(keepCount, targetFps);
  const speed = totalMs / Math.max(1, sumNumbers(acceleratedDelays));
  if (speed > maxSpeed + 1e-6) {
    throw new Error(
      `适配需要 ${speed.toFixed(2)}x，超过自动加速上限 ${maxSpeed.toFixed(2)}x。`,
    );
  }
  const encoded = buildSmallestFormat(sampled.frames, acceleratedDelays, config);
  return finalizeResult(encoded, speed, "accelerated", keepCount, maxBytes);
}
