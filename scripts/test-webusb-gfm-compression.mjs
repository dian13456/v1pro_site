import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { optimizePrebuiltGfm1 } from "../public/webusb/v1pro-gfm-compression.js";

const WIDTH = 320;
const HEIGHT = 170;
const FRAME_BYTES = WIDTH * HEIGHT * 2;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function magic(bytes) {
  return new TextDecoder().decode(bytes.subarray(0, 4));
}

function buildGfm1(frames, delays, width = WIDTH, height = HEIGHT) {
  assert.equal(frames.length, delays.length);
  const frameBytes = width * height * 2;
  const out = new Uint8Array(56 + frames.length * 2 + frames.length * frameBytes);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode("GFM1"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, width, true);
  view.setUint16(8, height, true);
  view.setUint16(10, frames.length, true);
  view.setUint32(12, frames.length * frameBytes, true);
  let offset = 56 + frames.length * 2;
  for (let index = 0; index < frames.length; index += 1) {
    assert.equal(frames[index].length, frameBytes);
    view.setUint16(56 + index * 2, delays[index], true);
    out.set(frames[index], offset);
    offset += frameBytes;
  }
  return out;
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function readExtendedLength(data, state, base) {
  let length = base;
  if (base !== 15) return length;
  while (true) {
    assert.ok(state.offset < data.length, "truncated LZ4 length");
    const extra = data[state.offset];
    state.offset += 1;
    length += extra;
    if (extra !== 255) return length;
  }
}

function decodeLz4Block(data, expectedSize) {
  const state = { offset: 0 };
  const out = [];
  while (state.offset < data.length) {
    const token = data[state.offset];
    state.offset += 1;
    const literalLength = readExtendedLength(data, state, token >>> 4);
    const literalEnd = state.offset + literalLength;
    assert.ok(literalEnd <= data.length, "LZ4 literal exceeds input");
    while (state.offset < literalEnd) {
      out.push(data[state.offset]);
      state.offset += 1;
    }
    if (state.offset === data.length) break;
    assert.ok(state.offset + 2 <= data.length, "truncated LZ4 offset");
    const distance = data[state.offset] | (data[state.offset + 1] << 8);
    state.offset += 2;
    assert.ok(distance > 0 && distance <= out.length, "invalid LZ4 distance");
    const matchLength = readExtendedLength(data, state, token & 0x0f) + 4;
    for (let index = 0; index < matchLength; index += 1) {
      out.push(out[out.length - distance]);
    }
  }
  assert.equal(out.length, expectedSize);
  return Uint8Array.from(out);
}

function decodeGfm3Blocks(blob, state, end, expectedSize) {
  const parts = [];
  let produced = 0;
  while (produced < expectedSize) {
    assert.ok(state.offset + 5 <= end, "truncated GFM3 block header");
    const view = new DataView(blob.buffer, blob.byteOffset + state.offset, 5);
    const method = blob[state.offset];
    const rawLength = view.getUint16(1, true);
    const storedLength = view.getUint16(3, true);
    state.offset += 5;
    assert.ok(rawLength > 0 && rawLength <= 4096 && rawLength % 2 === 0);
    assert.ok(state.offset + storedLength <= end);
    const stored = blob.subarray(state.offset, state.offset + storedLength);
    state.offset += storedLength;
    if (method === 0) {
      assert.equal(storedLength, rawLength);
      parts.push(stored);
    } else {
      assert.equal(method, 1);
      assert.ok(storedLength < rawLength);
      parts.push(decodeLz4Block(stored, rawLength));
    }
    produced += rawLength;
    assert.ok(produced <= expectedSize);
  }
  return concat(parts);
}

function applyRegion(frame, pixels, width, x, y, regionWidth, regionHeight) {
  const span = regionWidth * 2;
  let source = 0;
  for (let line = 0; line < regionHeight; line += 1) {
    const target = (y + line) * width * 2 + x * 2;
    frame.set(pixels.subarray(source, source + span), target);
    source += span;
  }
}

function decodeGfm(blob) {
  const format = magic(blob);
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const count = view.getUint16(10, true);
  const frameBytes = width * height * 2;
  const frames = [];
  const delays = [];

  if (format === "GFM1") {
    let offset = 56 + count * 2;
    for (let index = 0; index < count; index += 1) {
      delays.push(view.getUint16(56 + index * 2, true));
      frames.push(blob.slice(offset, offset + frameBytes));
      offset += frameBytes;
    }
    assert.equal(offset, blob.length);
    return { width, height, frames, delays };
  }

  const stride = format === "GFM2" ? 12 : 16;
  const dataBase = 56 + count * stride;
  let expectedDataOffset = 0;
  let previous = null;
  for (let index = 0; index < count; index += 1) {
    const entry = 56 + index * stride;
    const dataOffset = view.getUint32(entry, true);
    const storedLength = view.getUint32(entry + 4, true);
    const rawPixelLength = format === "GFM3" ? view.getUint32(entry + 8, true) : null;
    const delay = view.getUint16(entry + (format === "GFM3" ? 12 : 8), true);
    const flags = blob[entry + (format === "GFM3" ? 14 : 10)];
    const regionCount = blob[entry + (format === "GFM3" ? 15 : 11)];
    assert.equal(dataOffset, expectedDataOffset);
    const start = dataBase + dataOffset;
    const end = start + storedLength;
    assert.ok(end <= blob.length);
    let frame;

    if (flags === 1) {
      assert.equal(regionCount, 0);
      if (format === "GFM2") {
        assert.equal(storedLength, frameBytes);
        frame = blob.slice(start, end);
      } else {
        assert.equal(rawPixelLength, frameBytes);
        const state = { offset: start };
        frame = decodeGfm3Blocks(blob, state, end, frameBytes);
        assert.equal(state.offset, end);
      }
    } else {
      assert.equal(flags, 0);
      assert.ok(previous);
      frame = previous.slice();
      let offset = start;
      let decodedPixels = 0;
      for (let region = 0; region < regionCount; region += 1) {
        const x = view.getUint16(offset, true);
        const y = view.getUint16(offset + 2, true);
        const regionWidth = view.getUint16(offset + 4, true);
        const regionHeight = view.getUint16(offset + 6, true);
        offset += 8;
        const needed = regionWidth * regionHeight * 2;
        let pixels;
        if (format === "GFM2") {
          pixels = blob.subarray(offset, offset + needed);
          offset += needed;
        } else {
          const state = { offset };
          pixels = decodeGfm3Blocks(blob, state, end, needed);
          offset = state.offset;
        }
        applyRegion(frame, pixels, width, x, y, regionWidth, regionHeight);
        decodedPixels += needed;
      }
      assert.equal(offset, end);
      if (format === "GFM3") assert.equal(decodedPixels, rawPixelLength);
    }
    frames.push(frame);
    delays.push(delay);
    previous = frame;
    expectedDataOffset += storedLength;
  }
  assert.equal(dataBase + expectedDataOffset, blob.length);
  return { width, height, frames, delays };
}

function xorshiftBytes(length, seed) {
  let state = seed >>> 0;
  return Uint8Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  });
}

function assertFramesEqual(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < expected.length; index += 1) {
    assert.deepEqual(actual[index], expected[index], `frame ${index}`);
  }
}

const black = new Uint8Array(FRAME_BYTES);
const localChange = black.slice();
for (let line = 0; line < 8; line += 1) {
  const start = ((24 + line) * WIDTH + 32) * 2;
  for (let offset = start; offset < start + 32; offset += 2) {
    localChange[offset] = 0xf8;
    localChange[offset + 1] = 0x00;
  }
}
const localizedFrames = [black, localChange, localChange];
const localizedInput = buildGfm1(localizedFrames, [25, 50, 75]);

// Exact GFM2 byte vector generated by Shared_GUI/tools/usb_send_gif.py.
const gfm2 = optimizePrebuiltGfm1(localizedInput, {
  gfm3Enabled: false,
  antiTearing: false,
  maxFps: 40,
});
assert.equal(gfm2.magic, "GFM2");
assert.equal(gfm2.speed, 1);
assert.equal(gfm2.frameCount, 3);
assert.equal(gfm2.bytes.length, 109156);
assert.equal(
  sha256(gfm2.bytes),
  "2adef9d5fdca7a1509bfb8e14c210a2a9d124345f3ac446afcc4a81986e0bc28",
  "GFM2 output must stay byte-identical to the Python reference",
);
assert.deepEqual(Array.from(gfm2.bytes.subarray(16, 24)), [
  0x49, 0x58, 0x31, 0x32, 12, 16, 8, 32,
]);
assertFramesEqual(decodeGfm(gfm2.bytes).frames, localizedFrames);
assert.deepEqual(decodeGfm(gfm2.bytes).delays, [25, 50, 75]);

const gfm3 = optimizePrebuiltGfm1(localizedInput, {
  antiTearing: false,
  maxFps: 40,
});
assert.equal(gfm3.magic, "GFM3");
assert.ok(gfm3.bytes.length < gfm2.bytes.length);
assert.deepEqual(Array.from(gfm3.bytes.subarray(16, 24)), [
  0x4c, 0x5a, 0x34, 0x50, 16, 5, 12, 32,
]);
assertFramesEqual(decodeGfm(gfm3.bytes).frames, localizedFrames);
assert.deepEqual(decodeGfm(gfm3.bytes).delays, [25, 50, 75]);

// Incompressible key data keeps GFM2 when persistent LZ4 adds framing bytes.
const randomFirst = xorshiftBytes(FRAME_BYTES, 0x12345678);
const randomLocal = randomFirst.slice();
randomLocal.set(xorshiftBytes(32, 0x87654321), 0);
const noGfm3Gain = optimizePrebuiltGfm1(
  buildGfm1([randomFirst, randomLocal], [50, 50]),
  { antiTearing: false },
);
assert.equal(noGfm3Gain.magic, "GFM2");

// Two incompressible full-screen keys are smaller in legacy GFM1.
const randomSecond = xorshiftBytes(FRAME_BYTES, 0x0badc0de);
const legacyFallback = optimizePrebuiltGfm1(
  buildGfm1([randomFirst, randomSecond], [50, 50]),
  { antiTearing: false },
);
assert.equal(legacyFallback.magic, "GFM1");
assertFramesEqual(decodeGfm(legacyFallback.bytes).frames, [randomFirst, randomSecond]);

// Anti-tearing is enabled by default and covers both the hard cut and loop seam.
const white = new Uint8Array(FRAME_BYTES).fill(0xff);
const antitear = optimizePrebuiltGfm1(buildGfm1([black, white], [50, 50]), {
  gfm3Enabled: false,
  maxFps: 40,
});
assert.equal(antitear.magic, "GFM2");
assert.equal(antitear.frameCount, 4);
assert.equal(antitear.bytes.length, 274048);
assert.equal(
  sha256(antitear.bytes),
  "c8233e374404675e1bde35308dffd0d82f230af95a531de15bd1a8e60e1611d7",
  "anti-tearing GFM2 must stay byte-identical to the Python reference",
);
const decodedAntitear = decodeGfm(antitear.bytes);
assert.deepEqual(decodedAntitear.delays, [25, 25, 25, 25]);
assert.equal(decodedAntitear.delays.reduce((sum, delay) => sum + delay, 0), 100);
assert.deepEqual(decodedAntitear.frames[0], black);
assert.deepEqual(decodedAntitear.frames[2], white);
const split = 88 * WIDTH * 2;
assert.deepEqual(decodedAntitear.frames[1].subarray(0, split), white.subarray(0, split));
assert.deepEqual(decodedAntitear.frames[1].subarray(split), black.subarray(split));
assert.deepEqual(decodedAntitear.frames[3].subarray(0, split), black.subarray(0, split));
assert.deepEqual(decodedAntitear.frames[3].subarray(split), white.subarray(split));

// Same measured-byte vectors as Python test_gfm2_delta.py.
const indexedFrames = Array.from(
  { length: 10 },
  (_, index) => new Uint8Array(FRAME_BYTES).fill(index),
);
const sixFrameBudget = 56 + 6 * (FRAME_BYTES + 2);
const durationFit = optimizePrebuiltGfm1(
  buildGfm1(indexedFrames, new Array(10).fill(25)),
  {
    gfm3Enabled: false,
    antiTearing: false,
    maxFps: 45,
    fitMinFps: 20,
    maxBytes: sixFrameBudget,
  },
);
assert.equal(durationFit.magic, "GFM1");
assert.equal(durationFit.frameCount, 6);
assert.equal(durationFit.bytes.length, sixFrameBudget);
assert.equal(durationFit.speed, 1);
assert.equal(durationFit.fps, 24);
assert.equal(decodeGfm(durationFit.bytes).delays.reduce((sum, delay) => sum + delay, 0), 250);
assert.match(durationFit.note, /保持时长自动降帧/);

const autoSpeed = optimizePrebuiltGfm1(
  buildGfm1(indexedFrames, new Array(10).fill(50)),
  {
    gfm3Enabled: false,
    antiTearing: false,
    maxFps: 45,
    fitMinFps: 20,
    maxBytes: sixFrameBudget,
  },
);
assert.equal(autoSpeed.magic, "GFM1");
assert.equal(autoSpeed.frameCount, 6);
assert.equal(autoSpeed.bytes.length, sixFrameBudget);
assert.ok(Math.abs(autoSpeed.speed - 5 / 3) < 1e-12);
assert.equal(autoSpeed.fps, 20);
assert.deepEqual(decodeGfm(autoSpeed.bytes).delays, new Array(6).fill(50));
assert.match(autoSpeed.note, /自动加速/);

// Legacy compatible mode keeps the 25fps floor before applying its speed-up
// fallback when the frame budget is smaller than the 25fps candidate.
const legacyCompatible25 = optimizePrebuiltGfm1(
  buildGfm1(indexedFrames, new Array(10).fill(25)),
  {
    gfm3Enabled: false,
    antiTearing: false,
    maxFps: 25,
    fitMinFps: 25,
    maxBytes: sixFrameBudget,
  },
);
assert.equal(legacyCompatible25.fps, 25);
assert.equal(legacyCompatible25.frameCount, 6);

assert.throws(
  () =>
    optimizePrebuiltGfm1(buildGfm1(indexedFrames, new Array(10).fill(50)), {
      gfm3Enabled: false,
      antiTearing: false,
      maxBytes: sixFrameBudget,
      maxSpeed: 1.5,
    }),
  /超过自动加速上限/,
);

assert.throws(() => optimizePrebuiltGfm1(new Uint8Array(56)), /只支持预构建 GFM1/);
assert.throws(
  () => optimizePrebuiltGfm1(concat([localizedInput, Uint8Array.of(0)])),
  /长度无效/,
);

console.log("WebUSB GFM2/GFM3 compression and measured fitting tests passed.");
