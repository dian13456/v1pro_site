import assert from "node:assert/strict";

globalThis.window = {
  addEventListener() {},
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
};

const {
  buildLiveFramePacket,
  exitLiveMode,
  sendLiveRgb565,
} = await import("../public/webusb/v1pro-usb.js");

const pixels = new Uint8Array(320 * 170 * 2);
for (let index = 0; index < pixels.length; index += 1) pixels[index] = index & 0xff;
const packet = buildLiveFramePacket(pixels);
assert.equal(packet.length, 8 + pixels.length);
assert.deepEqual(Array.from(packet.subarray(0, 3)), [0xa5, 0x5a, 0x0b]);
assert.equal(new DataView(packet.buffer).getUint32(3, true), pixels.length);
assert.equal(packet[7], 0);
assert.deepEqual(packet.subarray(8), pixels);
assert.throws(() => buildLiveFramePacket(new Uint8Array(8)), /108800/);

const writes = [];
const encoder = new TextEncoder();
const device = {
  opened: true,
  async transferOut(endpoint, data) {
    writes.push({ endpoint, data: Uint8Array.from(data) });
    return { status: "ok", bytesWritten: data.byteLength };
  },
  async transferIn() {
    const data = encoder.encode(writes.length > 2 ? "LIVE,exit" : "LIVE,ok");
    return { status: "ok", data: new DataView(data.buffer) };
  },
};

assert.equal(await sendLiveRgb565(device, pixels), "LIVE,ok");
assert.equal(writes.length, 2, "the full frame should be split into two WebUSB writes");
assert.deepEqual(Array.from(writes[0].data.subarray(0, 8)), Array.from(packet.subarray(0, 8)));
assert.equal(await exitLiveMode(device), "LIVE,exit");
assert.equal(writes.length, 3);
assert.deepEqual(Array.from(writes[2].data), [0xa5, 0x5a, 0x0b, 0, 0, 0, 0, 0]);

console.log("WebUSB LIVE protocol tests passed");
