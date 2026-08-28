import assert from "node:assert/strict";

globalThis.window = {
  addEventListener() {},
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
};

const {
  buildSpectrumPacket,
  sendSpectrumFrame,
  stopSpectrum,
} = await import("../public/webusb/v1pro-usb.js");

const heights = Array.from({ length: 32 }, (_, index) => index * 5);
const start = buildSpectrumPacket(heights, { start: true, sequence: 257 });
assert.equal(start.length, 38);
assert.deepEqual(Array.from(start.subarray(0, 6)), [0xa5, 0x5a, 0x0e, 0x01, 0x01, 32]);
assert.equal(start[6], 0);
assert.equal(start[34], 140, "heights must be clamped to the firmware maximum");
assert.equal(start[37], 140);

const frame = buildSpectrumPacket(new Uint8Array(32).fill(44), {
  start: false,
  sequence: 9,
});
assert.deepEqual(Array.from(frame.subarray(0, 6)), [0xa5, 0x5a, 0x0e, 0x02, 0x09, 32]);
assert.deepEqual(Array.from(frame.subarray(6)), new Array(32).fill(44));
assert.throws(() => buildSpectrumPacket([1, 2, 3]), /32/);

const writes = [];
const device = {
  opened: true,
  async transferOut(endpoint, data) {
    writes.push({ endpoint, data: Uint8Array.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) });
    return { status: "ok", bytesWritten: data.byteLength };
  },
};

await sendSpectrumFrame(device, new Array(32).fill(20), { start: true, sequence: 0 });
await stopSpectrum(device);
assert.equal(writes.length, 2);
assert.equal(writes[0].endpoint, 1);
assert.equal(writes[0].data.length, 38);
assert.deepEqual(Array.from(writes[1].data), [0xa5, 0x5a, 0x0e, 0x00]);

console.log("WebUSB spectrum protocol tests passed");
