import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  lz4CompressBlock,
  prepareTransportPayload,
  TRANSPORT_BLOCK_METHOD_LZ4,
  TRANSPORT_BLOCK_METHOD_RAW,
} from "../public/webusb/v1pro-transport-codec.js";

globalThis.window = {
  addEventListener() {},
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
};

const {
  buildCompressedStartPreamble,
  parseJedecReply,
  parseFirmwareInfoReply,
  sendGfm1PayloadStream,
} = await import("../public/webusb/v1pro-usb.js");

const compressedCapacity = parseJedecReply(
  "JED,EF4017,64,8,7,77,320,170,GFM2,LZ4P,LZ4L,HW=V1P",
);
assert.ok(compressedCapacity);
assert.equal(compressedCapacity.maxPayloadBytes, 8 * 1024 * 1024 - 0x1000);
assert.equal(compressedCapacity.persistentCompression, true);
assert.equal(compressedCapacity.liveLz4, true);
assert.equal(compressedCapacity.hardwareVariant, "V1P");
assert.equal(compressedCapacity.materialMaxFps, 45);

const legacyCapacity = parseJedecReply("JED,EF4018,128,16,15,154,320,170");
assert.ok(legacyCapacity);
assert.equal(legacyCapacity.maxPayloadBytes, 16 * 1024 * 1024 - 0x1000);
assert.equal(legacyCapacity.persistentCompression, false);

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
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
    assert.ok(literalEnd <= data.length, "literal exceeds input");
    while (state.offset < literalEnd) {
      out.push(data[state.offset]);
      state.offset += 1;
    }
    if (state.offset === data.length) break;
    assert.ok(state.offset + 2 <= data.length, "truncated match distance");
    const distance = data[state.offset] | (data[state.offset + 1] << 8);
    state.offset += 2;
    assert.ok(distance > 0 && distance <= out.length, "invalid match distance");
    const matchLength = readExtendedLength(data, state, token & 0x0f) + 4;
    for (let i = 0; i < matchLength; i += 1) out.push(out[out.length - distance]);
  }
  assert.equal(out.length, expectedSize);
  return Uint8Array.from(out);
}

function decodeTransport(wire, expectedSize) {
  const out = [];
  let offset = 0;
  while (offset < wire.length) {
    assert.ok(offset + 5 <= wire.length, "truncated transport header");
    const view = new DataView(wire.buffer, wire.byteOffset + offset, 5);
    const method = wire[offset];
    const rawLength = view.getUint16(1, true);
    const storedLength = view.getUint16(3, true);
    offset += 5;
    const stored = wire.subarray(offset, offset + storedLength);
    assert.equal(stored.length, storedLength);
    offset += storedLength;
    if (method === TRANSPORT_BLOCK_METHOD_RAW) {
      assert.equal(storedLength, rawLength);
      out.push(stored);
    } else {
      assert.equal(method, TRANSPORT_BLOCK_METHOD_LZ4);
      out.push(decodeLz4Block(stored, rawLength));
    }
  }
  const decoded = concat(out);
  assert.equal(decoded.length, expectedSize);
  return decoded;
}

function makeReferencePayload() {
  const parts = [
    Uint8Array.from({ length: 256 * 8 }, (_, index) => index & 0xff),
    new TextEncoder().encode("V1PRO".repeat(600)),
    new Uint8Array(997),
  ];
  return concat(parts);
}

async function* unevenChunks(payload) {
  const sizes = [13, 4091, 7, 1703, 819, 2403];
  let offset = 0;
  let index = 0;
  while (offset < payload.length) {
    const end = Math.min(payload.length, offset + sizes[index % sizes.length]);
    yield payload.subarray(offset, end);
    offset = end;
    index += 1;
  }
}

const reference = makeReferencePayload();
const firstBlock = reference.subarray(0, 4096);
const firstPacked = lz4CompressBlock(firstBlock);
assert.equal(firstPacked.length, 284);
assert.equal(
  sha256(firstPacked),
  "3f2b298f9a8ee43b3311ea9f27576a0be6b74368fddbcfd66329d2c1ee9e1e95",
  "browser encoder must remain byte-compatible with the Python reference",
);
assert.deepEqual(decodeLz4Block(firstPacked, firstBlock.length), firstBlock);

const prepared = await prepareTransportPayload(unevenChunks(reference), reference.length);
assert.equal(prepared.compressed, true);
assert.equal(prepared.blockCount, 2);
assert.equal(prepared.compressedBlocks, 2);
assert.equal(prepared.wireBytes, 315);
const wire = concat(prepared.chunks);
assert.equal(
  sha256(wire),
  "a5ede66ee509f03cca76f181fd0b08e1dd057fd6531fa229ad3726634a11a370",
);
assert.deepEqual(decodeTransport(wire, reference.length), reference);

let randomState = 0x12345678;
const random = Uint8Array.from({ length: 9000 }, () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState & 0xff;
});
const rawFallback = await prepareTransportPayload(unevenChunks(random), random.length);
assert.equal(rawFallback.compressed, false);
assert.equal(rawFallback.streamBytes, random.length + 8);
assert.deepEqual(concat(rawFallback.chunks), random);

const header = buildCompressedStartPreamble(315, reference.length);
assert.equal(header.length, 16);
assert.deepEqual(Array.from(header.subarray(0, 3)), [0xa5, 0x5a, 0x02]);
const headerView = new DataView(header.buffer);
assert.equal(headerView.getUint32(3, true), 315);
assert.equal(headerView.getUint32(7, true), reference.length);
assert.equal(headerView.getUint16(11, true), 4096);
assert.deepEqual(Array.from(header.subarray(13)), [1, 0, 0]);

const oldFirmware = parseFirmwareInfoReply("FW,1,info,00002200,0,app,0");
const supportedFirmware = parseFirmwareInfoReply("FW,1,info,00002300,0,app,0");
assert.equal(oldFirmware.version, "V0.0.34");
assert.equal(oldFirmware.supportsCompressedTransport, false);
assert.equal(supportedFirmware.version, "V0.0.35");
assert.equal(supportedFirmware.supportsCompressedTransport, true);
assert.equal(
  parseFirmwareInfoReply("FW,1,info,00010500,0,bl_iap,0").supportsCompressedTransport,
  false,
);
assert.equal(parseFirmwareInfoReply("PONG"), null);

function createMockDevice(versionHex) {
  const writes = [];
  const replies = [];
  const readers = [];
  const encoder = new TextEncoder();
  const enqueueReply = (text) => {
    const bytes = encoder.encode(text);
    const result = {
      status: "ok",
      data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    };
    const reader = readers.shift();
    if (reader) reader(result);
    else replies.push(result);
  };
  return {
    opened: true,
    writes,
    async transferOut(_endpoint, data) {
      const copy = new Uint8Array(data);
      writes.push(copy);
      if (
        copy.length === 4 &&
        copy[0] === 0xa5 &&
        copy[1] === 0x5a &&
        copy[2] === 0x0c &&
        copy[3] === 0x01
      ) {
        enqueueReply(`FW,1,info,${versionHex},0,app,0`);
      } else if (
        copy.length === 3 &&
        copy[0] === 0xa5 &&
        copy[1] === 0x5a &&
        copy[2] === 0x09
      ) {
        enqueueReply("PONG,A1");
      }
      return { status: "ok", bytesWritten: copy.length };
    },
    transferIn() {
      if (replies.length) return Promise.resolve(replies.shift());
      return new Promise((resolve) => readers.push(resolve));
    },
  };
}

const compressedDevice = createMockDevice("00002300");
const compressedProgress = [];
const compressedStats = await sendGfm1PayloadStream(
  compressedDevice,
  reference.length,
  unevenChunks(reference),
  {
    onProgress: (sent, total, transport) => {
      compressedProgress.push({ sent, total, transport });
    },
  },
);
const compressedStart = compressedDevice.writes.find(
  (write) => write.length === 16 && write[0] === 0xa5 && write[2] === 0x02,
);
assert.ok(compressedStart, "V0.0.35 must use compressed START");
assert.equal(compressedStats.compressed, true);
assert.equal(compressedStats.wireBytes, 315);
assert.equal(compressedProgress.at(-1).sent, 331);
assert.equal(compressedProgress.at(-1).total, 331);

const legacyDevice = createMockDevice("00002200");
const legacyStats = await sendGfm1PayloadStream(
  legacyDevice,
  reference.length,
  unevenChunks(reference),
);
const legacyStart = legacyDevice.writes.find(
  (write) => write.length === 8 && write[0] === 0xa5 && write[2] === 0x01,
);
assert.ok(legacyStart, "V0.0.34 must remain on raw START");
assert.equal(legacyStats.compressed, false);
assert.equal(legacyStats.streamBytes, reference.length + 8);

console.log("WebUSB compressed transport tests passed.");
