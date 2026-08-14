/**
 * High-level WebUSB transfer API for website / demo pages.
 */
import {
  DEFAULT_MAX_GIF_FRAMES,
  MAX_VIDEO_FPS,
  MAX_VIDEO_SPEED,
  PREFETCH_CHUNKS_BEFORE_START,
  WEBUSB_TRANSFER_VERSION,
} from "./v1pro-constants.js?v=1.2.23";
import {
  planGfm1Encode,
  predictVideoTransferFromUrl,
} from "./v1pro-gfm1.js?v=1.2.24";
import {
  beginGfm1PayloadStream,
  closeDevice,
  listAuthorizedDevices,
  openAuthorizedDevice,
  openSelectedDevice,
  probeDevice,
  queryDeviceCapacity,
  requestAndOpenDevice,
  sendGfm1PayloadStream,
  V1ProUsbError,
} from "./v1pro-usb.js?v=1.2.23";

export { V1ProUsbError, listAuthorizedDevices, queryDeviceCapacity, WEBUSB_TRANSFER_VERSION };

const GFM1_HEADER_BYTES = 56;
const GFM1_FRAME_BYTES = 320 * 170 * 2;

async function planPrebuiltGfm1(blob, metadata = {}) {
  if (!(blob instanceof Blob) || blob.size < GFM1_HEADER_BYTES) {
    throw new V1ProUsbError("invalid_gfm1", "浏览器本地转换结果无效。");
  }
  const header = new Uint8Array(await blob.slice(0, GFM1_HEADER_BYTES).arrayBuffer());
  if (String.fromCharCode(...header.subarray(0, 4)) !== "GFM1") {
    throw new V1ProUsbError("invalid_gfm1", "浏览器本地转换结果缺少 GFM1 文件头。");
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const version = view.getUint16(4, true);
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const frameCount = view.getUint16(10, true);
  const pixelBytes = view.getUint32(12, true);
  if (version !== 1 || width !== 320 || height !== 170 || frameCount < 1) {
    throw new V1ProUsbError("invalid_gfm1", "浏览器本地转换结果的版本或画面尺寸不正确。");
  }
  if (metadata.frameCount != null && frameCount !== metadata.frameCount) {
    throw new V1ProUsbError(
      "invalid_gfm1",
      `浏览器本地转换帧数不一致（${frameCount}/${metadata.frameCount}）。`,
    );
  }
  const expectedPixelBytes = frameCount * GFM1_FRAME_BYTES;
  const expectedTotalBytes = GFM1_HEADER_BYTES + frameCount * 2 + expectedPixelBytes;
  if (pixelBytes !== expectedPixelBytes || blob.size !== expectedTotalBytes) {
    throw new V1ProUsbError(
      "invalid_gfm1",
      `浏览器本地转换结果大小不正确（${blob.size}/${expectedTotalBytes} 字节）。`,
    );
  }

  return {
    frameCount,
    fps: metadata.fps,
    totalBytes: blob.size,
    note: metadata.note || "浏览器 FFmpeg 本地转换",
    async *payloadChunks() {
      const reader = blob.stream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

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
    if (opts.device) {
      this.device = await openSelectedDevice(opts.device);
      await this.refreshDeviceCapacity();
      return this.device;
    }
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
        minVideoFps: opts.minVideoFps,
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
    const isGif =
      opts.mediaType === "gif" ||
      lowerType === "image/gif" ||
      lowerName.endsWith(".gif");
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
      if (onProgress && !opts.prebuiltGfm1) {
        onProgress({
          phase: "encode",
          sent: 0,
          total: 1,
          ratio: 0,
          note: capacityNote ? `准备编码… ${capacityNote}` : "准备编码…",
        });
      }

      const plan = opts.prebuiltGfm1
        ? await planPrebuiltGfm1(file, opts.prebuiltGfm1)
        : await planGfm1Encode(file, {
            maxFrames,
            maxVideoFps: opts.maxVideoFps ?? MAX_VIDEO_FPS,
            minVideoFps: opts.minVideoFps,
            maxVideoSpeed: opts.maxVideoSpeed ?? MAX_VIDEO_SPEED,
            maxPayloadBytes,
            fileName,
            mediaType: opts.mediaType,
            fitMode: opts.fitMode ?? (isGif ? "contain" : "fill"),
            rotationDeg: opts.rotationDeg ?? 0,
            colorProfile: opts.colorProfile ?? "normal",
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

      const requestedVideoFps =
        isVideo && opts.maxVideoFps === opts.minVideoFps ? opts.maxVideoFps : null;
      if (requestedVideoFps != null && plan.fps !== requestedVideoFps) {
        throw new V1ProUsbError(
          "video_fps_mismatch",
          `视频实际编码帧率不一致：选择 ${requestedVideoFps}fps，实际为 ${plan.fps ?? "未知"}fps。`
        );
      }

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
          onProgress({
            // Encoding has already completed before sendGfm1PayloadStream starts.
            // Treat every callback here as transfer progress; classifying the
            // first packets as encode makes the combined UI jump backwards.
            phase: "transfer",
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

      return {
        bytes: plan.totalBytes,
        frameCount: plan.frameCount,
        fps: isVideo ? plan.fps : undefined,
        note,
      };
    } finally {
      this.preparedTransferBytes = null;
      this.busy = false;
    }
  }
}
