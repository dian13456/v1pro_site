/**
 * High-level WebUSB transfer API for website / demo pages.
 *
 * Usage:
 *   import { V1ProWebTransfer } from './v1pro-web-transfer.js';
 *   const client = new V1ProWebTransfer();
 *   await client.connect();
 *   await client.transferFile(file, { onProgress: (p) => ... });
 *   await client.disconnect();
 */
import { DEFAULT_MAX_GIF_FRAMES, WEBUSB_TRANSFER_VERSION } from "./v1pro-constants.js?v=1.0.5";
import { encodeBlobToGfm1 } from "./v1pro-gfm1.js?v=1.0.5";
import {
  closeDevice,
  openAuthorizedDevice,
  ping,
  requestAndOpenDevice,
  sendGfm1,
  V1ProUsbError,
} from "./v1pro-usb.js?v=1.0.5";

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

  /**
   * Prompt user to pick a V1PRO device (must be called from a click handler).
   * @param {{ reuseAuthorized?: boolean }} [opts]
   */
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
   * @param {Blob} file
   * @param {{
   *   fileName?: string,
   *   maxFrames?: number,
   *   pingFirst?: boolean,
   *   onProgress?: (info: {
   *     phase: 'encode'|'transfer',
   *     sent: number,
   *     total: number,
   *     ratio: number,
   *     frameCount?: number,
   *     note?: string,
   *   }) => void,
   * }} [opts]
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
    try {
      if (pingFirst) {
        await ping(this.device);
      }

      if (onProgress) {
        onProgress({ phase: "encode", sent: 0, total: 1, ratio: 0 });
      }
      const { gfm1, frameCount, note } = await encodeBlobToGfm1(file, {
        maxFrames,
        fileName,
      });
      if (onProgress) {
        onProgress({
          phase: "encode",
          sent: 1,
          total: 1,
          ratio: 1,
          frameCount,
          note,
        });
      }

      await sendGfm1(this.device, gfm1, {
        onProgress: (sent, total) => {
          if (onProgress) {
            onProgress({
              phase: "transfer",
              sent,
              total,
              ratio: total > 0 ? sent / total : 0,
              frameCount,
              note,
            });
          }
        },
      });

      return { bytes: gfm1.length, frameCount, note };
    } finally {
      this.busy = false;
    }
  }
}
