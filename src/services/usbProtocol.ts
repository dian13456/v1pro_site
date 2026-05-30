export const PROTO_A5 = 0xa5;
export const PROTO_5A = 0x5a;
export const CMD_IMG_START = 0x01;
export const CMD_IMG_DATA = 0x02;
export const CMD_IMG_END = 0x03;

export const LCD_WIDTH = 170;
export const LCD_HEIGHT = 320;
export const DEFAULT_CHUNK_SIZE = 56;
export const DEFAULT_WRITE_RETRIES = 8;

export function crc16Ccitt(data: Uint8Array, init = 0xffff): number {
  let crc = init & 0xffff;
  for (let i = 0; i < data.length; i += 1) {
    crc ^= (data[i] << 8) & 0xffff;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc & 0xffff;
}

export function buildStartPacket(width: number, height: number, rlePayloadLen?: number): Uint8Array {
  if (rlePayloadLen !== undefined) {
    const packet = new Uint8Array(11);
    packet.set([PROTO_A5, PROTO_5A, CMD_IMG_START]);
    packet[3] = width & 0xff;
    packet[4] = (width >> 8) & 0xff;
    packet[5] = height & 0xff;
    packet[6] = (height >> 8) & 0xff;
    packet[7] = rlePayloadLen & 0xff;
    packet[8] = (rlePayloadLen >> 8) & 0xff;
    packet[9] = (rlePayloadLen >> 16) & 0xff;
    packet[10] = (rlePayloadLen >> 24) & 0xff;
    return packet;
  }

  return new Uint8Array([
    PROTO_A5,
    PROTO_5A,
    CMD_IMG_START,
    width & 0xff,
    (width >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ]);
}

export function buildDataPacket(seq: number, chunk: Uint8Array): Uint8Array {
  const plen = chunk.length;
  const pktCrc = crc16Ccitt(chunk);
  const packet = new Uint8Array(8 + plen);
  packet.set([PROTO_A5, PROTO_5A, CMD_IMG_DATA, seq & 0xff]);
  packet[4] = plen & 0xff;
  packet[5] = (plen >> 8) & 0xff;
  packet[6] = pktCrc & 0xff;
  packet[7] = (pktCrc >> 8) & 0xff;
  packet.set(chunk, 8);
  return packet;
}

export function buildEndPacket(frameCrc: number): Uint8Array {
  return new Uint8Array([PROTO_A5, PROTO_5A, CMD_IMG_END, frameCrc & 0xff, (frameCrc >> 8) & 0xff]);
}

export function decodeAckText(data: DataView | undefined): string {
  if (!data) return "";
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) {
    end -= 1;
  }
  return new TextDecoder("ascii", { fatal: false }).decode(bytes.subarray(0, end)).trim();
}
