/**
 * High-level WebUSB transfer API for website / demo pages.
 */
import {
  configurePanelGeometry,
  DEFAULT_MAX_GIF_FRAMES,
  FRAME_PIXEL_BYTES,
  LCD_H,
  LCD_W,
  MAX_VIDEO_FPS,
  MAX_VIDEO_SPEED,
  PREFETCH_CHUNKS_BEFORE_START,
  SPECTRUM_BANDS,
  WEBUSB_TRANSFER_VERSION,
} from "./v1pro-constants.js?v=1.2.36";
import {
  planGfm1Encode,
  predictVideoTransferFromUrl,
} from "./v1pro-gfm1.js?v=1.2.36";
import { optimizePrebuiltGfm1 } from "./v1pro-gfm-compression.js?v=1.2.36";
import {
  beginGfm1PayloadStream,
  closeDevice,
  listAuthorizedDevices,
  openAuthorizedDevice,
  openSelectedDevice,
  probeDevice,
  queryBootWebsiteConfig,
  queryDisplayStatus,
  queryDeviceCapacity,
  requestAndOpenDevice,
  sendGfm1PayloadStream,
  setDisplayBrightness,
  setDisplayRotation,
  setFollowScreenOff,
  setBootWebsiteConfig,
  sendSpectrumFrame,
  stopSpectrum,
  sendLiveRgb565,
  exitLiveMode,
  V1ProUsbError,
} from "./v1pro-usb.js?v=1.2.36";

export { V1ProUsbError, listAuthorizedDevices, queryDeviceCapacity, WEBUSB_TRANSFER_VERSION };

const GFM1_HEADER_BYTES = 56;
const GFM_PAYLOAD_CHUNK_BYTES = 256 * 1024;

async function optimizePrebuiltGfm1InWorker(sourceBytes, options) {
  if (typeof Worker !== "function") {
    return optimizePrebuiltGfm1(sourceBytes, options);
  }
  let worker;
  try {
    worker = new Worker(
      new URL("./v1pro-gfm-compression-worker.js?v=1.2.36", import.meta.url),
      { type: "module", name: "v1pro-gfm-compression" },
    );
  } catch {
    return optimizePrebuiltGfm1(sourceBytes, options);
  }

  const input = sourceBytes.byteOffset === 0 && sourceBytes.byteLength === sourceBytes.buffer.byteLength
    ? sourceBytes.buffer
    : sourceBytes.slice().buffer;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("GFM 压缩容量计算超时，请缩短素材后重试。"));
    }, 5 * 60 * 1000);
    const finish = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.addEventListener("message", (event) => {
      finish();
      if (event.data?.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data);
      }
    }, { once: true });
    worker.addEventListener("error", (event) => {
      finish();
      reject(new Error(event.message || "GFM 压缩 Worker 加载失败。"));
    }, { once: true });
    worker.postMessage({ input, options }, [input]);
  });
}

async function planPrebuiltGfm1(blob, metadata = {}, options = {}) {
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
  if (version !== 1 || width !== LCD_W || height !== LCD_H || frameCount < 1) {
    throw new V1ProUsbError("invalid_gfm1", "浏览器本地转换结果的版本或画面尺寸不正确。");
  }
  if (metadata.frameCount != null && frameCount !== metadata.frameCount) {
    throw new V1ProUsbError(
      "invalid_gfm1",
      `浏览器本地转换帧数不一致（${frameCount}/${metadata.frameCount}）。`,
    );
  }
  const expectedPixelBytes = frameCount * FRAME_PIXEL_BYTES;
  const expectedTotalBytes = GFM1_HEADER_BYTES + frameCount * 2 + expectedPixelBytes;
  if (pixelBytes !== expectedPixelBytes || blob.size !== expectedTotalBytes) {
    throw new V1ProUsbError(
      "invalid_gfm1",
      `浏览器本地转换结果大小不正确（${blob.size}/${expectedTotalBytes} 字节）。`,
    );
  }

  const sourceBytes = new Uint8Array(await blob.arrayBuffer());
  // The material-card path deliberately omits a user-selected FPS. Keep its
  // beginner floor firmware-aware here as a defensive fallback: GFM3 devices
  // may measure down to 20fps, while legacy devices retain the stable 25fps
  // compatibility floor. Explicit callers still win via minVideoFps.
  const automaticMinFps = options.beginnerAuto
    ? (options.capacity?.persistentCompression ? 20 : 25)
    : undefined;
  let optimized;
  try {
    optimized = await optimizePrebuiltGfm1InWorker(sourceBytes, {
      maxBytes: options.maxPayloadBytes,
      maxFps: options.maxVideoFps,
      fitMinFps: options.mediaType === "video"
        ? (options.minVideoFps ?? automaticMinFps ?? 20)
        : 15,
      maxSpeed: options.maxVideoSpeed ?? 10,
      autoSpeed: options.mediaType === "video",
      gfm2Enabled: options.capacity?.gfm2 === true,
      gfm3Enabled: options.capacity?.persistentCompression === true,
      antiTearing: true,
    });
  } catch (error) {
    throw new V1ProUsbError(
      "gfm_fit_failed",
      error instanceof Error ? error.message : "GFM 压缩容量适配失败。",
      error,
    );
  }

  const compressionNote = optimized.magic === "GFM1"
    ? optimized.note
    : `Flash ${optimized.magic} 持久压缩 · ${optimized.note}`;
  return {
    frameCount: optimized.frameCount,
    sourceFrameCount: optimized.sourceFrameCount,
    fps: optimized.fps,
    speed: optimized.speed,
    storageFormat: optimized.magic,
    totalBytes: optimized.bytes.length,
    note: [metadata.note || "浏览器 FFmpeg 本地转换", compressionNote]
      .filter(Boolean)
      .join("；"),
    async *payloadChunks() {
      for (let offset = 0; offset < optimized.bytes.length; offset += GFM_PAYLOAD_CHUNK_BYTES) {
        yield optimized.bytes.subarray(
          offset,
          Math.min(optimized.bytes.length, offset + GFM_PAYLOAD_CHUNK_BYTES),
        );
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
 *   lcdW?: number,
 *   lcdH?: number,
 * }|null|undefined} capacity
 */
export function formatDeviceCapacityLabel(capacity) {
  if (!capacity?.maxFrames) return "";
  const width = capacity.lcdW || 320;
  const height = capacity.lcdH || 170;
  const sizeName = width === 320 && height === 170
    ? "1.9寸"
    : width === 320 && height === 240
      ? "2.4寸"
      : `${width}×${height}`;
  if (capacity.persistentCompression) {
    return `${sizeName} ${width}×${height} · GFM3 按实际字节计算（${capacity.maxFrames}帧为未压缩参考）`;
  }
  return `${capacity.maxFrames}帧 · ${sizeName} ${width}×${height}`;
}

function formatTransportNote(transport) {
  if (!transport?.compressed) return "";
  const saved = Math.max(0, Math.round((1 - transport.ratio) * 100));
  return `USB LZ4 压缩传输 · 节省 ${saved}%`;
}

export class V1ProWebTransfer {
  constructor() {
    /** @type {USBDevice|null} */
    this.device = null;
    this.busy = false;
    /** @type {import("./v1pro-usb.js").parseJedecReply extends (t: infer T) => infer R ? R : never|null} */
    this.deviceCapacity = null;
    this.preparedTransferBytes = null;
    /**
     * @type {{
     *   requestedBytes: number,
     *   transferStarted: boolean,
     *   promise: Promise<{requestedBytes: number, confirmedBytes: number, error?: unknown}>,
     * }|null}
     */
    this.preparedTransfer = null;
    /** @type {string|null} */
    this.capacityError = null;
    this.spectrumActive = false;
    this.spectrumSequence = 0;
    this.liveModeActive = false;
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
      } else {
        configurePanelGeometry(this.deviceCapacity.lcdW, this.deviceCapacity.lcdH);
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
    const preparedTransfer = this.preparedTransfer;
    if (preparedTransfer?.promise) {
      try {
        // WebUSB cannot cancel an in-flight transferIn. Join the sized erase
        // before releasing the interface so its delayed ACK cannot steal the
        // next device command or leak the USB handle to the desktop GUI.
        await preparedTransfer.promise;
      } catch {
        // beginPreparedTransfer resolves failures for START fallback, but keep
        // disconnect defensive if a future implementation rejects instead.
      }
    }
    if (d?.opened && this.spectrumActive) {
      try {
        await stopSpectrum(d);
      } catch {
        // Closing the interface below remains the final cleanup path.
      }
    }
    if (d?.opened && this.liveModeActive) {
      try {
        await exitLiveMode(d);
      } catch {
        // Closing the interface below remains the final cleanup path.
      }
    }
    this.device = null;
    this.deviceCapacity = null;
    this.capacityError = null;
    this.preparedTransferBytes = null;
    this.preparedTransfer = null;
    this.busy = false;
    this.spectrumActive = false;
    this.spectrumSequence = 0;
    this.liveModeActive = false;
    configurePanelGeometry(320, 170);
    await closeDevice(d);
  }

  async runDisplayControl(action) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    if (this.busy) {
      throw new V1ProUsbError("busy", "当前有设备任务正在进行，请稍后重试。");
    }
    this.busy = true;
    try {
      return await action(this.device);
    } finally {
      this.busy = false;
    }
  }

  async getDisplayStatus() {
    return this.runDisplayControl((device) => queryDisplayStatus(device));
  }

  async setDisplayBrightness(brightness) {
    return this.runDisplayControl((device) => setDisplayBrightness(device, brightness));
  }

  async setDisplayRotation(rotation) {
    return this.runDisplayControl((device) => setDisplayRotation(device, rotation));
  }

  async setFollowScreenOff(enabled) {
    return this.runDisplayControl((device) => setFollowScreenOff(device, enabled));
  }

  async getBootWebsiteConfig() {
    return this.runDisplayControl((device) => queryBootWebsiteConfig(device));
  }

  async setBootWebsiteConfig(enabled, url) {
    return this.runDisplayControl((device) => setBootWebsiteConfig(device, enabled, url));
  }

  async startMusicSpectrum(heights = new Array(SPECTRUM_BANDS).fill(0)) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    if (this.busy) {
      throw new V1ProUsbError("busy", "当前有设备任务正在进行，请稍后重试。");
    }
    this.spectrumSequence = 0;
    await sendSpectrumFrame(this.device, heights, {
      start: true,
      sequence: this.spectrumSequence,
    });
    this.spectrumActive = true;
    this.spectrumSequence = (this.spectrumSequence + 1) & 0xff;
  }

  async sendMusicSpectrumFrame(heights) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "设备已断开。");
    }
    if (!this.spectrumActive) {
      await this.startMusicSpectrum(heights);
      return;
    }
    await sendSpectrumFrame(this.device, heights, {
      start: false,
      sequence: this.spectrumSequence,
    });
    this.spectrumSequence = (this.spectrumSequence + 1) & 0xff;
  }

  async stopMusicSpectrum() {
    const device = this.device;
    this.spectrumActive = false;
    this.spectrumSequence = 0;
    if (device?.opened) {
      await stopSpectrum(device);
    }
  }

  async startLiveFrame(pixels) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    if (this.busy || this.spectrumActive) {
      throw new V1ProUsbError("busy", "当前有设备任务正在进行，请先停止后重试。");
    }
    await sendLiveRgb565(this.device, pixels);
    this.liveModeActive = true;
  }

  async sendLiveFrame(pixels) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "设备已断开。");
    }
    if (!this.liveModeActive) {
      await this.startLiveFrame(pixels);
      return;
    }
    await sendLiveRgb565(this.device, pixels);
  }

  async stopLiveMode() {
    const device = this.device;
    this.liveModeActive = false;
    if (device?.opened) {
      await exitLiveMode(device);
    }
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
        "完整视频即使降至 20fps、10 倍速后仍无法装入设备，请选择更短的视频。"
      );
    }
    return prediction;
  }

  estimatePreeraseBytes(estimatedFrames) {
    const capacity = this.deviceCapacity;
    if (!capacity?.maxPayloadBytes) {
      throw new V1ProUsbError("capacity_unavailable", "无法读取设备容量，不能计算预擦除范围。");
    }
    const width = Math.max(1, Math.trunc(capacity.lcdW || LCD_W));
    const height = Math.max(1, Math.trunc(capacity.lcdH || LCD_H));
    let eraseFrames = Math.ceil(Math.max(1, Number(estimatedFrames) || 1) * 1.2) + 1;
    if (Number.isFinite(capacity.maxFrames) && capacity.maxFrames > 0) {
      eraseFrames = Math.min(eraseFrames, Math.trunc(capacity.maxFrames));
    }
    const referenceBytes = GFM1_HEADER_BYTES + eraseFrames * (2 + width * height * 2);
    return Math.min(capacity.maxPayloadBytes, referenceBytes);
  }

  beginPreparedTransfer(totalBytes) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    if (this.busy || this.preparedTransfer != null) {
      throw new V1ProUsbError("busy", "当前有传输任务正在进行。");
    }
    const maxPayloadBytes = this.deviceCapacity?.maxPayloadBytes;
    if (!maxPayloadBytes) {
      throw new V1ProUsbError("capacity_unavailable", "无法读取设备容量，不能开始预擦除。");
    }
    const requestedBytes = Math.trunc(Number(totalBytes));
    if (!Number.isFinite(requestedBytes) || requestedBytes <= 0 || requestedBytes > maxPayloadBytes) {
      throw new V1ProUsbError(
        "invalid_preerase_size",
        `预擦除范围无效（${totalBytes}/${maxPayloadBytes} 字节）。`,
      );
    }
    const waitForAck = this.deviceCapacity?.gfm2 === true
      || this.deviceCapacity?.persistentCompression === true;
    this.busy = true;
    const state = {
      requestedBytes,
      transferStarted: false,
      promise: Promise.resolve({ requestedBytes, confirmedBytes: 0 }),
    };
    state.promise = beginGfm1PayloadStream(this.device, requestedBytes, {
      maxPayloadBytes,
      waitForAck,
    }).then((confirmedBytes) => ({
      requestedBytes,
      confirmedBytes: Number.isFinite(confirmedBytes) ? Number(confirmedBytes) : requestedBytes,
    })).catch((error) => ({
      requestedBytes,
      confirmedBytes: 0,
      error,
    }));
    this.preparedTransferBytes = requestedBytes;
    this.preparedTransfer = state;
    return state.promise;
  }

  beginPreparedVideoTransfer(totalBytes) {
    return this.beginPreparedTransfer(totalBytes);
  }

  /**
   * Encode File/Blob to GFM1 and send via START stream.
   * Device flash erase begins as soon as START is sent, overlapping with encode/USB.
   */
  async transferFile(file, opts = {}) {
    if (!this.device || !this.device.opened) {
      throw new V1ProUsbError("not_connected", "请先连接设备。");
    }
    const preparedTransfer = this.preparedTransfer;
    if (this.busy && (!preparedTransfer || preparedTransfer.transferStarted)) {
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
    if (preparedTransfer) preparedTransfer.transferStarted = true;
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
          configurePanelGeometry(probe.capacity.lcdW, probe.capacity.lcdH);
        }
      }

      if (isVideo && !this.deviceCapacity && opts.maxFrames == null) {
        throw new V1ProUsbError(
          "capacity_unavailable",
          "无法读取设备容量，已停止视频转换。请重新连接设备后重试。"
        );
      }
      const capacity = this.deviceCapacity;
      const automaticMinVideoFps = opts.beginnerAuto
        ? (capacity?.persistentCompression ? 20 : 25)
        : undefined;
      const maxFrames = opts.maxFrames ?? capacity?.maxFrames ?? DEFAULT_MAX_GIF_FRAMES;
      const maxPayloadBytes = capacity?.maxPayloadBytes;
      const capacityNote = formatDeviceCapacityLabel(this.deviceCapacity);
      if (onProgress) {
        const prepareNote = opts.prebuiltGfm1 && capacity?.persistentCompression
          ? `正在 Worker 中测量 GFM3 实际压缩容量… ${capacityNote}`
          : capacityNote
            ? `准备编码… ${capacityNote}`
            : "准备编码…";
        onProgress({
          phase: "encode",
          sent: 0,
          total: 1,
          ratio: 0,
          note: prepareNote,
        });
      }

      const plan = opts.prebuiltGfm1
        ? await planPrebuiltGfm1(file, opts.prebuiltGfm1, {
            capacity,
            maxPayloadBytes,
            mediaType: opts.mediaType,
            maxVideoFps: opts.maxVideoFps ?? capacity?.materialMaxFps ?? MAX_VIDEO_FPS,
            minVideoFps: opts.minVideoFps ?? automaticMinVideoFps,
            beginnerAuto: opts.beginnerAuto === true,
            maxVideoSpeed: opts.maxVideoSpeed ?? MAX_VIDEO_SPEED,
          })
        : await planGfm1Encode(file, {
            maxFrames,
            maxVideoFps: opts.maxVideoFps ?? MAX_VIDEO_FPS,
            minVideoFps: opts.minVideoFps ?? automaticMinVideoFps,
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
      if (
        requestedVideoFps != null
        && Math.abs(Number(plan.fps) - Number(requestedVideoFps)) > 0.51
      ) {
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
      if (preparedTransfer) {
        if (onProgress) {
          onProgress({
            phase: "encode",
            sent: 0,
            total: 1,
            ratio: 0,
            frameCount: plan.frameCount,
            note: "正在等待设备预擦除完成…",
          });
        }
        const preerase = await preparedTransfer.promise;
        if (!preerase.error && preerase.confirmedBytes < plan.totalBytes) {
          try {
            // Firmware treats a larger repeated ERASE value as the new total
            // boundary and only erases the missing tail. START remains the
            // final safety net if this optional top-up fails.
            await beginGfm1PayloadStream(this.device, plan.totalBytes, {
              maxPayloadBytes,
              waitForAck: capacity?.gfm2 === true || capacity?.persistentCompression === true,
            });
          } catch (error) {
            console.warn("[V1PRO] pre-erase top-up failed; START will complete erase", error);
          }
        }
      }

      const baseNote = [capacityNote, plan.note, probeNote].filter(Boolean).join("；") || undefined;

      const transport = await sendGfm1PayloadStream(
        this.device,
        plan.totalBytes,
        plan.payloadChunks(),
        {
          maxPayloadBytes,
          /* Prepared mode performs only sized erase. Send START immediately
           * before the already encoded payload so firmware RX cannot time out. */
          startAlreadySent: false,
          prefetchBeforeStart: PREFETCH_CHUNKS_BEFORE_START,
          verificationTimeoutMs: plan.storageFormat === "GFM3" ? 60000 : 0,
          onProgress: (sent, total, currentTransport) => {
            if (!onProgress) return;
            const transferRatio = total > 0 ? sent / total : 0;
            const progressNote = [baseNote, formatTransportNote(currentTransport)]
              .filter(Boolean)
              .join("；") || undefined;
            onProgress({
              // Encoding has already completed before sendGfm1PayloadStream starts.
              // Treat every callback here as transfer progress; classifying the
              // first packets as encode makes the combined UI jump backwards.
              phase: "transfer",
              sent,
              total,
              ratio: Math.min(1, transferRatio),
              frameCount: plan.frameCount,
              note: progressNote,
            });
          },
        },
      );

      const note = [baseNote, formatTransportNote(transport)].filter(Boolean).join("；") || undefined;

      if (onProgress) {
        onProgress({
          phase: "transfer",
          sent: transport.streamBytes,
          total: transport.streamBytes,
          ratio: 1,
          frameCount: plan.frameCount,
          note,
        });
      }

      return {
        bytes: plan.totalBytes,
        frameCount: plan.frameCount,
        sourceFrameCount: plan.sourceFrameCount ?? plan.frameCount,
        fps: isVideo ? plan.fps : undefined,
        speed: isVideo ? plan.speed : undefined,
        storageFormat: plan.storageFormat ?? "GFM1",
        note,
      };
    } finally {
      this.preparedTransferBytes = null;
      if (this.preparedTransfer === preparedTransfer) {
        this.preparedTransfer = null;
      }
      this.busy = false;
    }
  }
}
