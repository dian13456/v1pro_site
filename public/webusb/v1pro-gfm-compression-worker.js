import { optimizePrebuiltGfm1 } from "./v1pro-gfm-compression.js?v=1.2.36";

self.addEventListener("message", (event) => {
  try {
    const input = event.data?.input;
    const options = event.data?.options || {};
    const result = optimizePrebuiltGfm1(input, options);
    self.postMessage(result, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error || "GFM 压缩失败"),
    });
  }
});
