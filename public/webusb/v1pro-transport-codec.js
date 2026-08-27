/**
 * V1PRO block-compressed USB transport.
 *
 * Wire format mirrors tools/transport_codec.py and the firmware decoder:
 * independent 4 KiB blocks, each stored as raw bytes or a raw LZ4 block.
 */

export const TRANSPORT_VERSION = 1;
export const TRANSPORT_BLOCK_SIZE = 4096;
export const TRANSPORT_BLOCK_METHOD_RAW = 0;
export const TRANSPORT_BLOCK_METHOD_LZ4 = 1;
export const COMPRESSED_START_HEADER_BYTES = 16;
export const RAW_START_HEADER_BYTES = 8;

function writeExtendedLength(out, length) {
  let left = length;
  while (left >= 255) {
    out.push(255);
    left -= 255;
  }
  out.push(left);
}

function keyAt(data, offset) {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

/** Encode one standard raw LZ4 block without a frame header or checksum. */
export function lz4CompressBlock(data) {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("LZ4 input must be a Uint8Array");
  }
  const size = data.length;
  if (size === 0) return new Uint8Array(0);

  const out = [];
  const table = new Map();
  let anchor = 0;
  let pos = 0;

  while (pos + 4 <= size) {
    const key = keyAt(data, pos);
    const ref = table.get(key);
    table.set(key, pos);
    if (ref === undefined || pos - ref > 0xffff) {
      pos += 1;
      continue;
    }

    let matchLength = 4;
    while (
      pos + matchLength < size &&
      data[ref + matchLength] === data[pos + matchLength]
    ) {
      matchLength += 1;
    }

    const literalLength = pos - anchor;
    const matchCode = matchLength - 4;
    out.push((Math.min(literalLength, 15) << 4) | Math.min(matchCode, 15));
    if (literalLength >= 15) writeExtendedLength(out, literalLength - 15);
    for (let i = anchor; i < pos; i += 1) out.push(data[i]);

    const distance = pos - ref;
    out.push(distance & 0xff, (distance >>> 8) & 0xff);
    if (matchCode >= 15) writeExtendedLength(out, matchCode - 15);

    const matchStart = pos;
    pos += matchLength;
    anchor = pos;
    const seedEnd = Math.min(pos, size - 3);
    for (let updatePos = matchStart + 1; updatePos < seedEnd; updatePos += 1) {
      table.set(keyAt(data, updatePos), updatePos);
    }
  }

  const literalLength = size - anchor;
  out.push(Math.min(literalLength, 15) << 4);
  if (literalLength >= 15) writeExtendedLength(out, literalLength - 15);
  for (let i = anchor; i < size; i += 1) out.push(data[i]);
  return Uint8Array.from(out);
}

function encodeBlock(raw) {
  const packed = lz4CompressBlock(raw);
  const useLz4 = packed.length < raw.length;
  const stored = useLz4 ? packed : raw;
  const block = new Uint8Array(5 + stored.length);
  const view = new DataView(block.buffer);
  block[0] = useLz4 ? TRANSPORT_BLOCK_METHOD_LZ4 : TRANSPORT_BLOCK_METHOD_RAW;
  view.setUint16(1, raw.length, true);
  view.setUint16(3, stored.length, true);
  block.set(stored, 5);
  return { block, compressed: useLz4 };
}

/**
 * Consume a one-shot GFM1 chunk stream and prepare both the legacy and
 * compressed candidates. The returned `chunks` already represent the chosen
 * wire payload, so START can be followed without an encoding pause.
 */
export async function prepareTransportPayload(payloadChunks, expectedRawBytes) {
  if (!payloadChunks?.[Symbol.asyncIterator]) {
    throw new TypeError("payloadChunks must be an AsyncIterable<Uint8Array>");
  }
  if (!Number.isSafeInteger(expectedRawBytes) || expectedRawBytes <= 0) {
    throw new RangeError("expectedRawBytes must be a positive safe integer");
  }

  const rawChunks = [];
  const packedChunks = [];
  const pending = new Uint8Array(TRANSPORT_BLOCK_SIZE);
  let pendingLength = 0;
  let rawBytes = 0;
  let wireBytes = 0;
  let blockCount = 0;
  let compressedBlocks = 0;

  const flushBlock = (length) => {
    const raw = pending.slice(0, length);
    const { block, compressed } = encodeBlock(raw);
    packedChunks.push(block);
    wireBytes += block.length;
    blockCount += 1;
    if (compressed) compressedBlocks += 1;
  };

  for await (const value of payloadChunks) {
    if (!(value instanceof Uint8Array) || value.length === 0) continue;
    rawChunks.push(value);
    rawBytes += value.length;
    if (rawBytes > expectedRawBytes) {
      throw new RangeError(
        `GFM1 stream exceeds declared size: ${rawBytes}/${expectedRawBytes}`,
      );
    }

    let offset = 0;
    while (offset < value.length) {
      const take = Math.min(
        TRANSPORT_BLOCK_SIZE - pendingLength,
        value.length - offset,
      );
      pending.set(value.subarray(offset, offset + take), pendingLength);
      pendingLength += take;
      offset += take;
      if (pendingLength === TRANSPORT_BLOCK_SIZE) {
        flushBlock(pendingLength);
        pendingLength = 0;
      }
    }
  }

  if (rawBytes !== expectedRawBytes) {
    throw new RangeError(
      `GFM1 stream size mismatch: ${rawBytes}/${expectedRawBytes}`,
    );
  }
  if (pendingLength > 0) flushBlock(pendingLength);

  const compressedStreamBytes = COMPRESSED_START_HEADER_BYTES + wireBytes;
  const rawStreamBytes = RAW_START_HEADER_BYTES + rawBytes;
  const compressed = compressedStreamBytes < rawStreamBytes;
  return {
    compressed,
    chunks: compressed ? packedChunks : rawChunks,
    rawBytes,
    wireBytes: compressed ? wireBytes : rawBytes,
    streamBytes: compressed ? compressedStreamBytes : rawStreamBytes,
    blockCount,
    compressedBlocks,
    ratio: compressed ? wireBytes / rawBytes : 1,
  };
}
