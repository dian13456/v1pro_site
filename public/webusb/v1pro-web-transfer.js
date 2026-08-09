/**
 * High-level WebUSB transfer API for website / demo pages.
 */
import {
  DEFAULT_MAX_GIF_FRAMES,
  MAX_VIDEO_FPS,
  MAX_VIDEO_SPEED,
  PREFETCH_CHUNKS_BEFORE_START,
  WEBUSB_TRANSFER_VERSION,
} from "./v1pro-constants.js?v=1.2.14";
import {
  planGfm1Encode,
  predictVideoTransferFromUrl,
} from "./v1pro-gfm1.js?v=1.2.14";
import {
  beginGfm1PayloadStream,
  closeDevice,
  openAuthorizedDevice,
  probeDevice,
  queryDeviceCapacity,
  requestAndOpenDevice,
  sendGfm1PayloadStream,
  V1ProUsbError,
} from "./v1pro-usb.js?v=1.2.14";

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
  if (!capacity?.maxFrames) return "";
  return `${capacity.maxFrames}帧`;
}

export class V1ProWebTransfer {
  constructor() {
    /** @type {USBDevice|null} */
    this.device = null;
    this.busy = false;
    /** @type {import("./v1pro-usb.js").parseJedecReply extends (t: infer T) => infer R ? R : never|null} */
    this.deviceCapacity = null;
    this.preparedTransferBytes = null;
    /** @type {string|null} */
    this.capacityError = null;
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
      this.capacityError = "设备未连接";
      return null;
    }
    this.capacityError = null;
    try {
      this.deviceCapacity = await queryDeviceCapacity(this.device, {
        wake: true,
        retries: 3,
      });
      if (!this.deviceCapacity) {
        this.capacityError = "设备未返回 JED 容量应答";
      }
    } catch (err) {
      this.deviceCapacity = null;
      this.capacityError =
        err instanceof V1ProUsbError
          ? err.message
          : err && err.message
            ? String(err.message)
            : "JEDEC 查询失败";
    }
    return this.deviceCapacity;
  }

  async disconnect() {
    const d = this.device;
    this.device = null;
    this.deviceCapacity = null;
    this.capacityError = null;
    this.preparedTransferBytes = null;
    await closeDevice(d);
  }

  async predictVideoUrl(url, opts = {}) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    if (!this.deviceCapacity) {
      await this.refreshDeviceCapacity();
    }
    if (!this.deviceCapacity) {
      const detail = this.capacityError ? `（${this.capacityError}）` : "";
      throw new V1ProUsbError(
        "capacity_unavailable",
        `无法读取设备容量${detail}，已停止视频空间预测。请重新连接设备后重试。`
      );
    }
    const prediction = await predictVideoTransferFromUrl(
      url,
      opts.maxFrames ?? this.deviceCapacity.maxFrames,
      {
        maxVideoFps: opts.maxVideoFps ?? MAX_VIDEO_FPS,
        maxVideoSpeed: opts.maxVideoSpeed ?? MAX_VIDEO_SPEED,
      }
    );
    if (prediction.totalBytes > this.deviceCapacity.maxPayloadBytes) {
      throw new V1ProUsbError(
        "gfm1_too_large",
        "完整视频即使降至 20fps、5 倍速后仍无法装入设备，请选择更短的视频。"
      );
    }
    return prediction;
  }

  async beginPreparedVideoTransfer(totalBytes) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    if (this.busy || this.preparedTransferBytes != null) {
      throw new V1ProUsbError("busy", "当前有传输任务正在进行。");
    }
    const maxPayloadBytes = this.deviceCapacity?.maxPayloadBytes;
    if (!maxPayloadBytes) {
      throw new V1ProUsbError("capacity_unavailable", "无法读取设备容量，不能开始预擦除。");
    }
    this.busy = true;
    try {
      await beginGfm1PayloadStream(this.device, totalBytes, { maxPayloadBytes });
      this.preparedTransferBytes = totalBytes;
    } finally {
      this.busy = false;
    }
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
    const pingFirst = opts.pingFirst !== false;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const lowerType = (file.type || "").toLowerCase();
    const lowerName = fileName.toLowerCase();
    const isVideo =
      opts.mediaType === "video" ||
      lowerType.startsWith("video/") ||
      /\.(mp4|webm|mov|m4v)$/i.test(lowerName);
    const preparedTotalBytes = opts.preparedTotalBytes ?? null;
    if (
      this.preparedTransferBytes != null &&
      preparedTotalBytes !== this.preparedTransferBytes
    ) {
      throw new V1ProUsbError(
        "prepared_transfer_mismatch",
        "预擦除任务与当前视频不一致，请重新连接设备后重试。"
      );
    }

    this.busy = true;
    let probeNote;
    try {
      if (!this.deviceCapacity) {
        await this.refreshDeviceCapacity();
      }

      const shouldProbe = pingFirst && !this.deviceCapacity;
      if (shouldProbe) {
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

      if (isVideo && !this.deviceCapacity && opts.maxFrames == null) {
        throw new V1ProUsbError(
          "capacity_unavailable",
          "无法读取设备容量，已停止视频转换。请重新连接设备后重试。"
        );
      }
      const capacity = this.deviceCapacity;
      const maxFrames = opts.maxFrames ?? capacity?.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
      const maxPayloadBytes = capacity?.maxPayloadBytes;
      const capacityNote = formatDeviceCapacityLabel(this.deviceCapacity);
      if (onProgress) {
        onProgress({
          phase: "encode",
          sent: 0,
          total: 1,
          ratio: 0,
          note: capacityNote ? `准备编码… ${capacityNote}` : "准备编码…",
        });
      }

      const plan = await planGfm1Encode(file, {
        maxFrames,
        maxVideoFps: opts.maxVideoFps ?? MAX_VIDEO_FPS,
        maxVideoSpeed: opts.maxVideoSpeed ?? MAX_VIDEO_SPEED,
        maxPayloadBytes,
        fileName,
        mediaType: opts.mediaType,
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
      if (preparedTotalBytes != null && plan.totalBytes !== preparedTotalBytes) {
        throw new V1ProUsbError(
          "prediction_changed",
          `视频实际转换大小与预测不一致（${plan.totalBytes}/${preparedTotalBytes} 字节），已停止写入。`
        );
      }

      const note = [capacityNote, plan.note, probeNote].filter(Boolean).join("；") || undefined;
      const streamTotal = 8 + plan.totalBytes;

      await sendGfm1PayloadStream(this.device, plan.totalBytes, plan.payloadChunks(), {
        maxPayloadBytes,
        startAlreadySent: preparedTotalBytes != null,
        prefetchBeforeStart: PREFETCH_CHUNKS_BEFORE_START,
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
      this.preparedTransferBytes = null;
      this.busy = false;
    }
  }
}
