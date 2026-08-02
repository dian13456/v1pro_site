/**
 * Low-level WebUSB helpers for V1PRO START + GFM1 transfer.
 */
import {
  ANIM_FLASH_MAX_BYTES,
  BULK_OUT_TIMEOUT_MS,
  EP_IN,
  EP_OUT,
  IO_TIMEOUT_MS,
  PING_TIMEOUT_MS,
  TRANSFER_DRAIN_INTERVAL_MS,
  TRANSFER_OUT_RETRIES,
  USB_CHUNK,
  USBDL_CMD_PING,
  USBDL_CMD_START,
  USBDL_MAGIC0,
  USBDL_MAGIC1,
  V1PRO_USB_FILTERS,
} from "./v1pro-constants.js";

export class V1ProUsbError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = "V1ProUsbError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, code, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new V1ProUsbError(code, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * @param {USBDevice} device
 */
async function drainInQuick(device) {
  for (let i = 0; i < 8; i += 1) {
    try {
      const result = await withTimeout(
        device.transferIn(EP_IN, 64),
        12,
        "drain_timeout",
        "drain"
      );
      if (result.status !== "ok" || !result.data || result.data.byteLength === 0) {
        break;
      }
    } catch {
      break;
    }
  }
}

/**
 * @param {USBDevice} device
 * @param {number} endpoint
 * @param {Uint8Array} slice
 * @param {number} timeoutMs
 * @param {number} retries
 */
async function transferOutWithRetry(device, endpoint, slice, timeoutMs, retries) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const result = await withTimeout(
        device.transferOut(endpoint, slice),
        timeoutMs,
        "io_timeout",
        "USB 写出超时。请关闭「佳点V1PRO控制工具」、保持 USB 连接，大 GIF 传输时请耐心等待（设备可能在擦写 Flash）。"
      );
      if (result.status === "ok") {
        return;
      }
    } catch (err) {
      if (err instanceof V1ProUsbError && err.code === "io_timeout") {
        throw err;
      }
      if (attempt + 1 >= retries) {
        if (err instanceof V1ProUsbError) throw err;
        throw new V1ProUsbError(
          "transfer_out_failed",
          formatUsbOpenHint(err),
          err
        );
      }
      await sleep(4);
    }
  }
  throw new V1ProUsbError(
    "transfer_out_failed",
    "USB 写出失败，请重新插拔设备后重试。"
  );
}

/**
 * @param {USBDevice} device
 * @param {Uint8Array} data
 * @param {{ timeoutMs?: number, retries?: number }} [opts]
 */
export async function bulkOut(device, data, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? BULK_OUT_TIMEOUT_MS;
  const retries = opts.retries ?? TRANSFER_OUT_RETRIES;
  for (let i = 0; i < data.length; i += USB_CHUNK) {
    const slice = data.subarray(i, Math.min(i + USB_CHUNK, data.length));
    await transferOutWithRetry(device, EP_OUT, slice, timeoutMs, retries);
  }
}

/**
 * @param {USBDevice} device
 * @param {number} [length]
 */
export async function bulkIn(device, length = 64) {
  try {
    const result = await withTimeout(
      device.transferIn(EP_IN, length),
      IO_TIMEOUT_MS,
      "io_timeout",
      "USB 读入超时。"
    );
    return new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength
    );
  } catch (err) {
    if (err instanceof V1ProUsbError) throw err;
    throw new V1ProUsbError("transfer_in_failed", formatUsbOpenHint(err), err);
  }
}

function formatUsbOpenHint(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  if (/Access denied|busy|claimed|LIBUSB_ERROR_BUSY|Access|占用/i.test(msg)) {
    return "无法占用 USB 接口。请先关闭「佳点V1PRO控制工具」及其他占用设备的程序后重试。";
  }
  if (/No device|disconnected|NetworkError|NotFound/i.test(msg)) {
    return "设备已断开或不存在，请重新插拔 USB 后点击连接。";
  }
  return `USB 通信失败：${msg}`;
}

/**
 * @returns {Promise<USBDevice>}
 */
export async function requestAndOpenDevice() {
  if (!navigator.usb) {
    throw new V1ProUsbError(
      "webusb_unsupported",
      "当前浏览器不支持 WebUSB。请使用 Chrome 或 Edge 桌面版，并在 HTTPS 或 localhost 打开页面。"
    );
  }
  let device;
  try {
    device = await navigator.usb.requestDevice({ filters: V1PRO_USB_FILTERS });
  } catch (err) {
    if (err && err.name === "NotFoundError") {
      throw new V1ProUsbError("user_cancelled", "未选择设备。", err);
    }
    throw new V1ProUsbError("request_failed", formatUsbOpenHint(err), err);
  }
  await openClaimed(device);
  return device;
}

/**
 * Open previously authorized device (optional convenience).
 * @returns {Promise<USBDevice|null>}
 */
export async function openAuthorizedDevice() {
  if (!navigator.usb) return null;
  const devices = await navigator.usb.getDevices();
  const match = devices.find((d) =>
    V1PRO_USB_FILTERS.some(
      (f) => d.vendorId === f.vendorId && d.productId === f.productId
    )
  );
  if (!match) return null;
  await openClaimed(match);
  return match;
}

/**
 * @param {USBDevice} device
 */
async function openClaimed(device) {
  try {
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    await device.claimInterface(0);
    await drainInQuick(device);
  } catch (err) {
    try {
      if (device.opened) await device.close();
    } catch {
      /* ignore */
    }
    throw new V1ProUsbError("claim_failed", formatUsbOpenHint(err), err);
  }
}

/**
 * @param {USBDevice|null|undefined} device
 */
export async function closeDevice(device) {
  if (!device) return;
  try {
    if (device.opened) {
      try {
        await device.releaseInterface(0);
      } catch {
        /* ignore */
      }
      await device.close();
    }
  } catch {
    /* ignore */
  }
}

/**
 * @param {USBDevice} device
 * @returns {Promise<boolean>}
 */
export async function ping(device) {
  await drainInQuick(device);
  const cmd = new Uint8Array([USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_PING]);
  try {
    await bulkOut(device, cmd, { timeoutMs: IO_TIMEOUT_MS, retries: 3 });
  } catch (err) {
    if (err instanceof V1ProUsbError) throw err;
    throw new V1ProUsbError("ping_failed", formatUsbOpenHint(err), err);
  }
  try {
    const buf = await withTimeout(
      bulkIn(device, 64),
      PING_TIMEOUT_MS,
      "ping_timeout",
      "设备无响应 PING。请确认：① 已进入应用固件（非 Bootloader）；② 未打开控制工具；③ USB 已插好。"
    );
    const text = new TextDecoder().decode(buf).replace(/\0/g, "").trim();
    if (!text.startsWith("PONG")) {
      throw new V1ProUsbError(
        "ping_bad_reply",
        `设备应答异常（期望 PONG）：${text.slice(0, 40) || "(空)"}`
      );
    }
    return true;
  } catch (err) {
    if (err instanceof V1ProUsbError) throw err;
    throw new V1ProUsbError("ping_failed", formatUsbOpenHint(err), err);
  }
}

/**
 * Send START header + GFM1 payload over Bulk OUT.
 * @param {USBDevice} device
 * @param {Uint8Array} gfm1
 * @param {{ onProgress?: (sent: number, total: number) => void }} [opts]
 */
export async function sendGfm1(device, gfm1, opts = {}) {
  if (!(gfm1 instanceof Uint8Array) || gfm1.length < 56) {
    throw new V1ProUsbError("invalid_gfm1", "GFM1 载荷无效。");
  }
  if (gfm1.length > ANIM_FLASH_MAX_BYTES) {
    throw new V1ProUsbError(
      "gfm1_too_large",
      `GFM1 过大（${gfm1.length} 字节），超过设备 Flash 上限。`
    );
  }

  await drainInQuick(device);

  const total = gfm1.length;
  const preamble = new Uint8Array(8);
  preamble[0] = USBDL_MAGIC0;
  preamble[1] = USBDL_MAGIC1;
  preamble[2] = USBDL_CMD_START;
  preamble[3] = total & 0xff;
  preamble[4] = (total >>> 8) & 0xff;
  preamble[5] = (total >>> 16) & 0xff;
  preamble[6] = (total >>> 24) & 0xff;
  preamble[7] = 0x00;

  const streamLen = preamble.length + total;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  let sent = 0;
  let lastDrainAt = Date.now();

  const writeChunk = async (chunk) => {
    const now = Date.now();
    if (now - lastDrainAt >= TRANSFER_DRAIN_INTERVAL_MS) {
      await drainInQuick(device);
      lastDrainAt = now;
    }
    await bulkOut(device, chunk);
    sent += chunk.length;
    if (onProgress) onProgress(Math.min(sent, streamLen), streamLen);
  };

  // Stream in larger logical batches assembled into 64B USB packets inside bulkOut.
  await writeChunk(preamble);

  const BATCH = 4096;
  for (let i = 0; i < gfm1.length; i += BATCH) {
    await writeChunk(gfm1.subarray(i, Math.min(i + BATCH, gfm1.length)));
  }

  await drainInQuick(device);
}
