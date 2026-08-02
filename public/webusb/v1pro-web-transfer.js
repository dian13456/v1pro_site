/**
 * High-level WebUSB transfer API for website / demo pages.
 */
import { DEFAULT_MAX_GIF_FRAMES, WEBUSB_TRANSFER_VERSION } from "./v1pro-constants.js?v=1.0.9";
import { planGfm1Encode } from "./v1pro-gfm1.js?v=1.0.9";
import {
  closeDevice,
  openAuthorizedDevice,
  probeDevice,
  requestAndOpenDevice,
  sendGfm1PayloadStream,
  V1ProUsbError,
} from "./v1pro-usb.js?v=1.0.9";

export { V1ProUsbError };
export { WEBUSB_TRANSFER_VERSION };

export class V1ProWebTransfer {
  constructor() {
    /** @type {USBDevice|null} */
    this.device = null;
    this.busy = false;
  }

  /** @returns {boolean} */
  get connected() {
    return !!(this.device && this.device.opened);
  }

  async connect(opts = {}) {
    if (this.busy) {
      throw new V1ProUsbError("busy", "当前有传输任务正在进行。");
    }
    await this.disconnect();
    if (opts.reuseAuthorized) {
      const existing = await openAuthorizedDevice();
      if (existing) {
        this.device = existing;
        return this.device;
      }
    }
    this.device = await requestAndOpenDevice();
    return this.device;
  }

  async disconnect() {
    const d = this.device;
    this.device = null;
    await closeDevice(d);
  }

  /**
   * Encode File/Blob to GFM1 and send via START stream.
   * Device flash erase begins as soon as START is sent, overlapping with encode/USB.
   */
  async transferFile(file, opts = {}) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    if (this.busy) {
      throw new V1ProUsbError("busy", "当前有传输任务正在进行。");
    }
    if (!(file instanceof Blob) || file.size <= 0) {
      throw new V1ProUsbError("invalid_file", "请选择有效的图片或 GIF 文件。");
    }

    const fileName =
      opts.fileName ||
      (typeof File !== "undefined" && file instanceof File ? file.name : "") ||
      "";
    const maxFrames = opts.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
    const pingFirst = opts.pingFirst !== false;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

    this.busy = true;
    let probeNote;
    try {
      if (pingFirst) {
        const probe = await probeDevice(this.device);
        if (!probe.ok) {
          if (opts.requirePing === true) {
            throw new V1ProUsbError("ping_timeout", probe.note || "设备无响应 PING。");
          }
          probeNote = probe.note || "设备未应答 PING，已跳过探测并尝试直接传输";
        }
      }

      if (onProgress) {
        onProgress({ phase: "encode", sent: 0, total: 1, ratio: 0 });
      }

      const plan = await planGfm1Encode(file, {
        maxFrames,
        fileName,
        onFrameEncoded: (frameIndex, frameCount) => {
          if (onProgress) {
            onProgress({
              phase: "encode",
              sent: frameIndex,
              total: frameCount,
              ratio: frameCount > 0 ? frameIndex / frameCount : 0,
              frameCount,
            });
          }
        },
      });

      const note = [probeNote, plan.note].filter(Boolean).join("；") || undefined;
      const streamTotal = 8 + plan.totalBytes;

      await sendGfm1PayloadStream(this.device, plan.totalBytes, plan.payloadChunks(), {
        onProgress: (sent, total) => {
          if (!onProgress) return;
          const encodeWeight = 0.12;
          const transferRatio = total > 0 ? sent / total : 0;
          const phase = sent <= 8 + 56 + plan.frameCount * 2 ? "encode" : "transfer";
          onProgress({
            phase,
            sent,
            total,
            ratio: Math.min(1, encodeWeight + transferRatio * (1 - encodeWeight)),
            frameCount: plan.frameCount,
            note,
          });
        },
      });

      if (onProgress) {
        onProgress({
          phase: "transfer",
          sent: streamTotal,
          total: streamTotal,
          ratio: 1,
          frameCount: plan.frameCount,
          note,
        });
      }

      return { bytes: plan.totalBytes, frameCount: plan.frameCount, note };
    } finally {
      this.busy = false;
    }
  }
}
