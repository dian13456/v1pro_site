/**
 * High-level WebUSB transfer API for website / demo pages.
 */
import {
  DEFAULT_MAX_GIF_FRAMES,
  MAX_VIDEO_FPS,
  MAX_VIDEO_SPEED,
  WEBUSB_TRANSFER_VERSION,
} from "./v1pro-constants.js?v=1.2.0";
import { planGfm1Encode } from "./v1pro-gfm1.js?v=1.2.0";
import {
  closeDevice,
  openAuthorizedDevice,
  probeDevice,
  queryDeviceCapacity,
  requestAndOpenDevice,
  sendGfm1PayloadStream,
  V1ProUsbError,
} from "./v1pro-usb.js?v=1.2.0";

export { V1ProUsbError, queryDeviceCapacity, WEBUSB_TRANSFER_VERSION };

/**
 * @param {{
 *   totalMb?: number,
 *   usableMb?: number,
 *   maxFrames?: number,
 *   model?: number,
 * }|null|undefined} capacity
 */
export function formatDeviceCapacityLabel(capacity) {
  if (!capacity) return "";
  const total = capacity.totalMb ? `${capacity.totalMb}MB` : "未知容量";
  const frames = capacity.maxFrames ? `${capacity.maxFrames} 帧` : "";
  const model = capacity.model ? `${capacity.model} 档` : "";
  return [total, model, frames].filter(Boolean).join(" · ");
}

export class V1ProWebTransfer {
  constructor() {
    /** @type {USBDevice|null} */
    this.device = null;
    this.busy = false;
    /** @type {import("./v1pro-usb.js").parseJedecReply extends (t: infer T) => infer R ? R : never|null} */
    this.deviceCapacity = null;
  }

  /** @returns {boolean} */
  get connected() {
    return !!(this.device && this.device.opened);
  }

  getCapacityLabel() {
    return formatDeviceCapacityLabel(this.deviceCapacity);
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
        await this.refreshDeviceCapacity();
        return this.device;
      }
    }
    this.device = await requestAndOpenDevice();
    await this.refreshDeviceCapacity();
    return this.device;
  }

  async refreshDeviceCapacity() {
    if (!this.device || !this.device.opened) {
      this.deviceCapacity = null;
      return null;
    }
    try {
      this.deviceCapacity = await queryDeviceCapacity(this.device);
    } catch {
      this.deviceCapacity = null;
    }
    return this.deviceCapacity;
  }

  async disconnect() {
    const d = this.device;
    this.device = null;
    this.deviceCapacity = null;
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
      throw new V1ProUsbError("invalid_file", "请选择有效的图片、GIF 或短视频文件。");
    }

    const fileName =
      opts.fileName ||
      (typeof File !== "undefined" && file instanceof File ? file.name : "") ||
      "";
    const capacity = this.deviceCapacity;
    const maxFrames = opts.maxFrames ?? capacity?.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
    const maxPayloadBytes = capacity?.maxPayloadBytes;
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
        } else if (probe.capacity) {
          this.deviceCapacity = probe.capacity;
        }
      }

      const capacityNote = formatDeviceCapacityLabel(this.deviceCapacity);
      if (onProgress) {
        onProgress({ phase: "encode", sent: 0, total: 1, ratio: 0, note: capacityNote || undefined });
      }

      const plan = await planGfm1Encode(file, {
        maxFrames,
        maxVideoFps: opts.maxVideoFps ?? MAX_VIDEO_FPS,
        maxVideoSpeed: opts.maxVideoSpeed ?? MAX_VIDEO_SPEED,
        maxPayloadBytes,
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

      if (maxPayloadBytes && plan.totalBytes > maxPayloadBytes) {
        throw new V1ProUsbError(
          "gfm1_too_large",
          `GFM1 过大（${plan.totalBytes} 字节），超过设备可用 Flash（约 ${this.deviceCapacity?.usableMb ?? "?"}MB）。`
        );
      }

      const note = [capacityNote, plan.note, probeNote].filter(Boolean).join("；") || undefined;
      const streamTotal = 8 + plan.totalBytes;

      await sendGfm1PayloadStream(this.device, plan.totalBytes, plan.payloadChunks(), {
        maxPayloadBytes,
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
