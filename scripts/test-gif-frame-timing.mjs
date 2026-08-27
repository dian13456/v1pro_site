import assert from "node:assert/strict";
import { readGifFrameDelays } from "../src/services/gifFrameTiming.ts";

// 2x2, three-frame GIF with 50 ms, 120 ms and 30 ms frame delays.
const fixture = Buffer.from(
  "R0lGODlhAgACAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQIBQAAACwAAAAAAgACAAAIBgABCAQQEAAh+QQIDAAAACwAAAAAAgACAIEA/wAAAAAAAAAAAAAIBgABCAQQEAAh+QQIAwAAACwAAAAAAgACAIEAAP8AAAAAAAAAAAAIBgABCAQQEAA7",
  "base64",
);

const delays = await readGifFrameDelays(new Blob([fixture], { type: "image/gif" }));
assert.deepEqual(delays, [50, 120, 30]);
console.log("GIF frame timing test passed:", delays.join(", "));
