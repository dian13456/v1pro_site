/**
 * Low-level WebUSB helpers for V1PRO START + GFM1 transfer.
 */
import {
  ANIM_FLASH_MAX_BYTES,
  EP_IN,
  EP_OUT,
  FRAME_PIXEL_BYTES,
  IO_TIMEOUT_MS,
  PING_TIMEOUT_MS,
  USB_CHUNK,
  USBDL_CMD_ERASE,
  USBDL_CMD_DISPLAY,
  USBDL_CMD_JEDEC,
  USBDL_CMD_PING,
  USBDL_CMD_LIVE,
  USBDL_CMD_START,
  USBDL_CMD_START_COMPRESSED,
  USBDL_CMD_FW,
  USBDL_FW_SUB_INFO,
  USBDL_CMD_URL,
  USBDL_CMD_SPECTRUM,
  SPECTRUM_BANDS,
  SPECTRUM_MAX_HEIGHT,
  SPECTRUM_SUB_FRAME,
  SPECTRUM_SUB_START,
  SPECTRUM_SUB_STOP,
  USBDL_DISPLAY_SUB_BRIGHTNESS,
  USBDL_DISPLAY_SUB_FOLLOW_SCREEN_OFF,
  USBDL_DISPLAY_SUB_QUERY,
  USBDL_DISPLAY_SUB_ROTATE,
  USBDL_MAGIC0,
  USBDL_MAGIC1,
  USBDL_URL_SUB_BEGIN,
  USBDL_URL_SUB_CHUNK,
  USBDL_URL_SUB_COMMIT,
  USBDL_URL_SUB_ENABLE,
  USBDL_URL_SUB_QUERY,
  USBDL_URL_SUB_WRITE,
  USB_HID_URL_MAX_LEN,
  V1PRO_USB_FILTERS,
} from "./v1pro-constants.js?v=1.2.36";
import {
  prepareTransportPayload,
  TRANSPORT_BLOCK_SIZE,
  TRANSPORT_VERSION,
} from "./v1pro-transport-codec.js?v=1.2.36";

/** 大文件写出参数：定义在 usb 层，避免 constants.js 旧缓存导致模块加载失败。 */
const BULK_OUT_TIMEOUT_MS = 60000;
const TRANSFER_OUT_RETRIES = 5;
const TRANSFER_DRAIN_INTERVAL_MS = 2000;
const TRANSFER_DRAIN_BYTES = 1024 * 1024;
const PROBE_POLL_TIMEOUT_MS = 4000;
const JEDEC_PROBE_TIMEOUT_MS = 3000;
const DISPLAY_COMMAND_TIMEOUT_MS = 2000;
const FIRMWARE_INFO_TIMEOUT_MS = 1800;
const LIVE_COMMAND_TIMEOUT_MS = 4000;
const MIN_COMPRESSED_TRANSPORT_VERSION_WORD = 0x00002300; // V0.0.35
const USBDL_CMD_RESET_STREAM = 0x03;
const ERASE_SECTOR_BYTES = 4096;
const ERASE_BLOCK_32K_BYTES = 32 * 1024;
const ERASE_BLOCK_64K_BYTES = 64 * 1024;

/**
 * @typedef {{
 *   interfaceNumber: number,
 *   inEndpoint: number,
 *   outEndpoint: number,
 *   pendingIn: Promise<USBInTransferResult>|null,
 *   firmwareInfo?: ReturnType<typeof parseFirmwareInfoReply>,
 * }} DeviceSession
 */

/** @type {WeakMap<USBDevice, DeviceSession>} */
const deviceSessions = new WeakMap();

const DESKTOP_BRIDGE_BASE = "http://127.0.0.1:8765";
const DESKTOP_HANDOFF_TTL_SECONDS = 90;
const DESKTOP_HANDOFF_KEEPALIVE_MS = 30000;
/** @type {Map<USBDevice, {leaseId: string, timer: number}>} */
const desktopHandoffs = new Map();
/** @type {WeakMap<USBDevice, {release: () => void, completed: Promise<void>}>} */
const webUsbTabLocks = new WeakMap();

function getWebUsbClientId() {
  const key = "jadot-webusb-client-id";
  try {
    let value = window.sessionStorage.getItem(key);
    if (!value) {
      value = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      window.sessionStorage.setItem(key, value);
    }
    return value;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

async function bridgeFetch(path, payload, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${DESKTOP_BRIDGE_BASE}${path}`, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function acquireWebUsbTabLock(device) {
  if (!navigator.locks?.request || webUsbTabLocks.has(device)) return;
  const identity = device.serialNumber || `${device.vendorId.toString(16)}-${device.productId.toString(16)}`;
  const name = `jadot-v1pro-webusb:${identity}`;
  let releaseHold = () => {};
  let resolveAcquired;
  let rejectAcquired;
  const acquired = new Promise((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  const completed = navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) {
      rejectAcquired(new V1ProUsbError("tab_busy", "另一个网页标签正在使用这台设备，请等待其传输完成。"));
      return;
    }
    await new Promise((resolve) => {
      releaseHold = resolve;
      resolveAcquired();
    });
  });
  completed.catch(() => {});
  await acquired;
  webUsbTabLocks.set(device, { release: releaseHold, completed });
}

async function releaseWebUsbTabLock(device) {
  const held = webUsbTabLocks.get(device);
  if (!held) return;
  webUsbTabLocks.delete(device);
  held.release();
  try {
    await held.completed;
  } catch {
    // The lock is advisory; USB close already completed.
  }
}

async function requestDesktopHandoff(device) {
  if (desktopHandoffs.has(device)) return;
  let response;
  try {
    response = await bridgeFetch("/usb/handoff/start", {
      clientId: getWebUsbClientId(),
      serial: device.serialNumber || "",
      vid: device.vendorId,
      pid: device.productId,
      ttlSeconds: DESKTOP_HANDOFF_TTL_SECONDS,
    }, 7000);
  } catch {
    // GUI is not running (or is an older release): normal WebUSB still works.
    return;
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    return;
  }
  if (!response.ok || !body?.ok || !body?.leaseId) {
    if (response.status === 404) return;
    throw new V1ProUsbError(
      "desktop_busy",
      body?.error || "桌面 GUI 暂时无法移交 USB，请稍后重试。"
    );
  }
  const leaseId = String(body.leaseId);
  const timer = window.setInterval(() => {
    bridgeFetch("/usb/handoff/keepalive", { leaseId }, 2500).catch(() => {});
  }, DESKTOP_HANDOFF_KEEPALIVE_MS);
  desktopHandoffs.set(device, { leaseId, timer });
}

async function releaseDesktopHandoff(device) {
  const handoff = desktopHandoffs.get(device);
  if (!handoff) return;
  desktopHandoffs.delete(device);
  window.clearInterval(handoff.timer);
  try {
    await bridgeFetch("/usb/handoff/finish", { leaseId: handoff.leaseId }, 2500);
  } catch {
    // GUI watchdog reclaims ownership when the lease expires.
  }
}

window.addEventListener("pagehide", () => {
  for (const handoff of desktopHandoffs.values()) {
    window.clearInterval(handoff.timer);
    try {
      navigator.sendBeacon(
        `${DESKTOP_BRIDGE_BASE}/usb/handoff/finish`,
        JSON.stringify({ leaseId: handoff.leaseId })
      );
    } catch {
      // Lease timeout remains the final safety net.
    }
  }
  desktopHandoffs.clear();
});

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
function pickBulkEndpoints(device) {
  const configuration = device.configuration;
  if (!configuration) {
    return { interfaceNumber: 0, outEndpoint: EP_OUT, inEndpoint: EP_IN };
  }

  for (const usbInterface of configuration.interfaces) {
    for (const alternate of usbInterface.alternates) {
      const out = alternate.endpoints.find(
        (endpoint) => endpoint.direction === "out" && endpoint.type === "bulk"
      );
      const input = alternate.endpoints.find(
        (endpoint) => endpoint.direction === "in" && endpoint.type === "bulk"
      );
      if (out && input) {
        return {
          interfaceNumber: usbInterface.interfaceNumber,
          outEndpoint: out.endpointNumber,
          inEndpoint: input.endpointNumber,
        };
      }
    }
  }

  return { interfaceNumber: 0, outEndpoint: EP_OUT, inEndpoint: EP_IN };
}

/**
 * @param {USBDevice} device
 * @returns {DeviceSession}
 */
function getSession(device) {
  const existing = deviceSessions.get(device);
  if (existing) return existing;
  return {
    interfaceNumber: 0,
    outEndpoint: EP_OUT,
    inEndpoint: EP_IN,
    pendingIn: null,
    firmwareInfo: undefined,
  };
}

/**
 * WebUSB cannot cancel transferIn. Never abandon a timed-out IN, or the next
 * real reply (e.g. JED,...) will be consumed by the orphaned promise.
 * @param {USBDevice} device
 * @param {number} length
 * @param {number} timeoutMs
 */
async function transferInTracked(device, length, timeoutMs) {
  const session = getSession(device);
  if (!deviceSessions.has(device)) {
    deviceSessions.set(device, session);
  }

  if (!session.pendingIn) {
    session.pendingIn = device.transferIn(session.inEndpoint, length);
  }

  const pending = session.pendingIn;
  let timer;
  try {
    const result = await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new V1ProUsbError("io_timeout", "USB 读入超时。")),
          timeoutMs
        );
      }),
    ]);
    if (session.pendingIn === pending) {
      session.pendingIn = null;
    }
    return result;
  } catch (err) {
    // On timeout, keep pendingIn so the next reader reuses the same transferIn.
    // WebUSB cannot cancel an in-flight IN; abandoning it steals later replies.
    if (!(err instanceof V1ProUsbError && err.code === "io_timeout")) {
      if (session.pendingIn === pending) {
        session.pendingIn = null;
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {USBDevice} device
 */
async function drainInQuick(device) {
  for (let i = 0; i < 8; i += 1) {
    try {
      const result = await transferInTracked(device, 64, 20);
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
 * @param {string[]} prefixes
 * @param {number} timeoutMs
 */
async function readTextReply(device, prefixes, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const normalizedPrefixes = prefixes.map((prefix) => prefix.toUpperCase());
  /** @type {string[]} */
  const seen = [];
  while (Date.now() < deadline) {
    try {
      const left = Math.max(40, Math.min(400, deadline - Date.now()));
      const result = await transferInTracked(device, 64, left);
      if (result.status !== "ok" || !result.data || result.data.byteLength === 0) {
        continue;
      }
      const text = new TextDecoder()
        .decode(
          new Uint8Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength
          )
        )
        .replace(/\0/g, "")
        .trim();
      if (!text) continue;
      seen.push(text);
      const normalizedText = text.toUpperCase();
      if (normalizedPrefixes.some((prefix) => normalizedText.startsWith(prefix))) {
        return text;
      }
    } catch {
      // keep polling until deadline; pending IN stays tracked
    }
  }
  if (seen.length) {
    console.warn("[V1PRO] unexpected USB text replies while waiting:", seen);
  }
  return null;
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
      if (
        result.status === "ok" &&
        (typeof result.bytesWritten !== "number" || result.bytesWritten === slice.byteLength)
      ) {
        return;
      }
      if (result.status === "ok") {
        throw new V1ProUsbError(
          "partial_write",
          `USB 写出不完整：${result.bytesWritten ?? 0}/${slice.byteLength} 字节。`
        );
      }
    } catch (err) {
      if (
        err instanceof V1ProUsbError &&
        (err.code === "io_timeout" || err.code === "partial_write")
      ) {
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
  const { outEndpoint } = getSession(device);
  const timeoutMs = opts.timeoutMs ?? BULK_OUT_TIMEOUT_MS;
  const retries = opts.retries ?? TRANSFER_OUT_RETRIES;
  for (let i = 0; i < data.length; i += USB_CHUNK) {
    const slice = data.subarray(i, Math.min(i + USB_CHUNK, data.length));
    await transferOutWithRetry(device, outEndpoint, slice, timeoutMs, retries);
  }
}

/**
 * @param {USBDevice} device
 * @param {number} [length]
 */
export async function bulkIn(device, length = 64) {
  try {
    const result = await transferInTracked(device, length, IO_TIMEOUT_MS);
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

/**
 * Build the low-bandwidth 32-band packet rendered directly by V1PRO firmware.
 * @param {readonly number[]} heights
 * @param {{ start?: boolean, sequence?: number }} [opts]
 */
export function buildSpectrumPacket(heights, opts = {}) {
  if (!Array.isArray(heights) && !(heights instanceof Uint8Array)) {
    throw new V1ProUsbError("spectrum_data_invalid", "音乐频谱数据格式不正确。");
  }
  if (heights.length !== SPECTRUM_BANDS) {
    throw new V1ProUsbError(
      "spectrum_data_invalid",
      `音乐频谱需要 ${SPECTRUM_BANDS} 个频段，当前为 ${heights.length} 个。`
    );
  }
  const packet = new Uint8Array(6 + SPECTRUM_BANDS);
  packet[0] = USBDL_MAGIC0;
  packet[1] = USBDL_MAGIC1;
  packet[2] = USBDL_CMD_SPECTRUM;
  packet[3] = opts.start ? SPECTRUM_SUB_START : SPECTRUM_SUB_FRAME;
  packet[4] = Math.max(0, Math.round(Number(opts.sequence) || 0)) & 0xff;
  packet[5] = SPECTRUM_BANDS;
  for (let index = 0; index < SPECTRUM_BANDS; index += 1) {
    packet[6 + index] = Math.max(
      0,
      Math.min(SPECTRUM_MAX_HEIGHT, Math.round(Number(heights[index]) || 0))
    );
  }
  return packet;
}

/** Send one spectrum frame. Firmware intentionally does not ACK these frames. */
export async function sendSpectrumFrame(device, heights, opts = {}) {
  requireOpenDisplayDevice(device);
  const packet = buildSpectrumPacket(heights, opts);
  await bulkOut(device, packet, { timeoutMs: 1000, retries: 2 });
}

/** Exit MCU spectrum mode and return to the stored animation. */
export async function stopSpectrum(device) {
  requireOpenDisplayDevice(device);
  await bulkOut(
    device,
    new Uint8Array([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_SPECTRUM,
      SPECTRUM_SUB_STOP,
    ]),
    { timeoutMs: 1000, retries: 2 }
  );
}

/**
 * Build one firmware-compatible full-screen LIVE packet.
 * Layout: A5 5A 0B + payload length (u32 LE) + mode 00 + RGB565 bytes.
 * @param {Uint8Array} pixels
 */
export function buildLiveFramePacket(pixels) {
  if (!(pixels instanceof Uint8Array) || pixels.byteLength !== FRAME_PIXEL_BYTES) {
    throw new V1ProUsbError(
      "live_frame_invalid",
      `LIVE 画面必须为 ${FRAME_PIXEL_BYTES} 字节 RGB565 数据。`
    );
  }
  const packet = new Uint8Array(8 + pixels.byteLength);
  packet[0] = USBDL_MAGIC0;
  packet[1] = USBDL_MAGIC1;
  packet[2] = USBDL_CMD_LIVE;
  new DataView(packet.buffer).setUint32(3, pixels.byteLength, true);
  packet[7] = 0x00;
  packet.set(pixels, 8);
  return packet;
}

function parseLiveReply(reply) {
  if (!reply) {
    throw new V1ProUsbError("live_timeout", "设备未返回 LIVE 应答，请重新连接后重试。");
  }
  if (reply.startsWith("LIVE,ok") || reply.startsWith("LIVE,exit")) return reply;
  if (reply.startsWith("LIVE,err,")) {
    throw new V1ProUsbError("live_rejected", `设备拒绝实时画面：${reply.slice(9) || "unknown"}`);
  }
  throw new V1ProUsbError("live_reply_invalid", `设备返回了未知 LIVE 应答：${reply}`);
}

/** Push one full-screen RGB565 frame using the detected panel geometry. */
export async function sendLiveRgb565(device, pixels) {
  requireOpenDisplayDevice(device);
  await bulkOut(device, buildLiveFramePacket(pixels), {
    timeoutMs: LIVE_COMMAND_TIMEOUT_MS,
    retries: 2,
  });
  return parseLiveReply(
    await readTextReply(device, ["LIVE,"], LIVE_COMMAND_TIMEOUT_MS)
  );
}

/** Leave LIVE hold and resume the animation stored in the device. */
export async function exitLiveMode(device) {
  requireOpenDisplayDevice(device);
  const packet = new Uint8Array(8);
  packet[0] = USBDL_MAGIC0;
  packet[1] = USBDL_MAGIC1;
  packet[2] = USBDL_CMD_LIVE;
  // payload length remains zero; packet[7] is full-frame mode 0.
  await bulkOut(device, packet, { timeoutMs: 2000, retries: 2 });
  return parseLiveReply(await readTextReply(device, ["LIVE,"], 2500));
}

function requireOpenDisplayDevice(device) {
  if (!device?.opened) {
    throw new V1ProUsbError("not_connected", "请先连接设备。");
  }
}

async function sendDisplayCommand(device, payload, replyPrefix) {
  requireOpenDisplayDevice(device);
  await drainInQuick(device);
  await bulkOut(device, payload, { timeoutMs: DISPLAY_COMMAND_TIMEOUT_MS, retries: 2 });
  const reply = await readTextReply(device, [replyPrefix], DISPLAY_COMMAND_TIMEOUT_MS);
  if (!reply) {
    throw new V1ProUsbError(
      "display_control_unsupported",
      "设备未确认显示控制命令，请升级 V1PRO 固件后重试。"
    );
  }
  return reply;
}

/** Query DISPLAY prefs: STA,<brightness>,<screenOff>,<rotation>,<followScreenOff>. */
export async function queryDisplayStatus(device) {
  const reply = await sendDisplayCommand(
    device,
    new Uint8Array([USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_DISPLAY, USBDL_DISPLAY_SUB_QUERY]),
    "STA,"
  );
  const parts = reply.replace(/\0/g, "").trim().split(",");
  if (parts.length < 5 || parts[0].toUpperCase() !== "STA") {
    throw new V1ProUsbError("display_status_invalid", `设备显示状态格式错误：${reply}`);
  }
  const brightness = Math.max(0, Math.min(255, Number.parseInt(parts[1], 10) || 0));
  const rotation = Math.max(0, Math.min(3, Number.parseInt(parts[3], 10) || 0));
  return {
    brightness,
    screenOff: Number.parseInt(parts[2], 10) !== 0,
    rotation,
    followScreenOff: Number.parseInt(parts[4], 10) !== 0,
  };
}

/** Set backlight PWM level (0 switches the screen off, 1..255 switches it on). */
export async function setDisplayBrightness(device, brightness) {
  const level = Math.max(0, Math.min(255, Math.round(Number(brightness) || 0)));
  const reply = await sendDisplayCommand(
    device,
    new Uint8Array([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_DISPLAY,
      USBDL_DISPLAY_SUB_BRIGHTNESS,
      level,
    ]),
    "DSP,"
  );
  return Math.max(0, Math.min(255, Number.parseInt(reply.split(",")[1], 10) || level));
}

/** Set physical LCD landscape direction. Website UI uses 0 and 2 (0°/180°). */
export async function setDisplayRotation(device, rotation) {
  const direction = Math.max(0, Math.min(3, Math.round(Number(rotation) || 0)));
  const reply = await sendDisplayCommand(
    device,
    new Uint8Array([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_DISPLAY,
      USBDL_DISPLAY_SUB_ROTATE,
      direction,
    ]),
    "ROT,"
  );
  return Math.max(0, Math.min(3, Number.parseInt(reply.split(",")[1], 10) || direction));
}

/** Follow host USB suspend / screen-off state. */
export async function setFollowScreenOff(device, enabled) {
  const value = enabled ? 1 : 0;
  const reply = await sendDisplayCommand(
    device,
    new Uint8Array([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_DISPLAY,
      USBDL_DISPLAY_SUB_FOLLOW_SCREEN_OFF,
      value,
    ]),
    "VSO,"
  );
  return Number.parseInt(reply.split(",")[1], 10) !== 0;
}

function validateBootWebsiteUrl(url) {
  const text = String(url || "").trim();
  if (!text) {
    throw new V1ProUsbError("boot_url_invalid", "请填写要在上电时打开的网址。");
  }
  if (text.length > USB_HID_URL_MAX_LEN) {
    throw new V1ProUsbError(
      "boot_url_invalid",
      `网址最长 ${USB_HID_URL_MAX_LEN} 个字符。`
    );
  }
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new V1ProUsbError("boot_url_invalid", "网址格式不正确，请填写完整的 http:// 或 https:// 地址。");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new V1ProUsbError("boot_url_invalid", "网址必须以 http:// 或 https:// 开头。");
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      throw new V1ProUsbError("boot_url_invalid", "网址仅支持可由键盘输入的 ASCII 字符。");
    }
  }
  return text;
}

async function sendBootWebsiteCommand(device, payload, replyPrefix) {
  requireOpenDisplayDevice(device);
  await drainInQuick(device);
  await bulkOut(device, payload, { timeoutMs: DISPLAY_COMMAND_TIMEOUT_MS, retries: 2 });
  const reply = await readTextReply(device, [replyPrefix], DISPLAY_COMMAND_TIMEOUT_MS);
  if (!reply) {
    throw new V1ProUsbError(
      "boot_url_unsupported",
      "设备未确认上电打开网页命令，请升级 V1PRO 固件后重试。"
    );
  }
  return reply;
}

/** Read the persisted HID boot-launcher URL and enabled state. */
export async function queryBootWebsiteConfig(device) {
  const reply = await sendBootWebsiteCommand(
    device,
    new Uint8Array([USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_URL, USBDL_URL_SUB_QUERY]),
    "URL,"
  );
  const parts = reply.replace(/\0/g, "").trim().split(",");
  if (parts.length < 3 || parts[0].toUpperCase() !== "URL") {
    throw new V1ProUsbError("boot_url_invalid_reply", `设备网址状态格式错误：${reply}`);
  }
  const enabled = Number.parseInt(parts[1], 10) !== 0;
  const length = Math.max(
    0,
    Math.min(USB_HID_URL_MAX_LEN, Number.parseInt(parts[2], 10) || 0)
  );
  if (length === 0) return { enabled: false, url: "" };

  let url = "";
  for (let offset = 0; offset < length;) {
    const chunkLength = Math.min(48, length - offset);
    const chunkReply = await sendBootWebsiteCommand(
      device,
      new Uint8Array([
        USBDL_MAGIC0,
        USBDL_MAGIC1,
        USBDL_CMD_URL,
        USBDL_URL_SUB_CHUNK,
        offset & 0xff,
        chunkLength,
      ]),
      "URLC,"
    );
    const chunk = chunkReply.slice(5, 5 + chunkLength);
    if (chunk.length !== chunkLength) {
      throw new V1ProUsbError("boot_url_invalid_reply", "设备返回的网址数据不完整，请重新读取。");
    }
    url += chunk;
    offset += chunkLength;
  }
  return { enabled, url: validateBootWebsiteUrl(url) };
}

/** Persist a URL and enable/disable the firmware HID boot launcher. */
export async function setBootWebsiteConfig(device, enabled, url) {
  const rawUrl = String(url || "").trim();
  const cleaned = enabled || rawUrl ? validateBootWebsiteUrl(rawUrl) : "";
  if (!cleaned) {
    const reply = await sendBootWebsiteCommand(
      device,
      new Uint8Array([
        USBDL_MAGIC0,
        USBDL_MAGIC1,
        USBDL_CMD_URL,
        USBDL_URL_SUB_ENABLE,
        0,
      ]),
      "URLE,"
    );
    if (!/^URLE,0(?:,|$)/i.test(reply)) {
      throw new V1ProUsbError("boot_url_write_failed", `设备未确认关闭上电打开网页：${reply}`);
    }
    return queryBootWebsiteConfig(device);
  }

  const data = new TextEncoder().encode(cleaned);
  await sendBootWebsiteCommand(
    device,
    new Uint8Array([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_URL,
      USBDL_URL_SUB_BEGIN,
      data.length & 0xff,
      (data.length >> 8) & 0xff,
    ]),
    "URLB,"
  );
  for (let offset = 0; offset < data.length;) {
    const chunk = data.subarray(offset, Math.min(offset + 48, data.length));
    const payload = new Uint8Array(6 + chunk.length);
    payload.set([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_URL,
      USBDL_URL_SUB_WRITE,
      offset & 0xff,
      (offset >> 8) & 0xff,
    ]);
    payload.set(chunk, 6);
    await sendBootWebsiteCommand(device, payload, "URLW,");
    offset += chunk.length;
  }
  const committed = await sendBootWebsiteCommand(
    device,
    new Uint8Array([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_URL,
      USBDL_URL_SUB_COMMIT,
      enabled ? 1 : 0,
    ]),
    "URL,"
  );
  if (committed.replace(/\0/g, "").trim().toUpperCase() !== "URL,OK") {
    throw new V1ProUsbError("boot_url_write_failed", `设备保存网址失败：${committed}`);
  }
  return queryBootWebsiteConfig(device);
}

function formatUsbOpenHint(err) {
  const msg = err && err.message ? String(err.message) : String(err);
  if (/claimInterface|claim interface|Unable to claim|Access denied|busy|claimed|LIBUSB_ERROR_BUSY|Access|占用/i.test(msg)) {
    return "USB 接口被本地软件占用，请关闭本地软件后重试！";
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
 * Return every previously authorized V1PRO without opening or claiming it.
 * @returns {Promise<USBDevice[]>}
 */
export async function listAuthorizedDevices() {
  if (!navigator.usb) return [];
  const devices = await navigator.usb.getDevices();
  return devices.filter((device) =>
    V1PRO_USB_FILTERS.some(
      (filter) =>
        device.vendorId === filter.vendorId && device.productId === filter.productId
    )
  );
}

/**
 * Open one exact device selected by the website UI.
 * @param {USBDevice} device
 * @returns {Promise<USBDevice>}
 */
export async function openSelectedDevice(device) {
  if (!device) {
    throw new V1ProUsbError("device_required", "请选择要传输的 V1PRO 设备。");
  }
  const allowed = V1PRO_USB_FILTERS.some(
    (filter) =>
      device.vendorId === filter.vendorId && device.productId === filter.productId
  );
  if (!allowed) {
    throw new V1ProUsbError("device_not_allowed", "所选设备不是受支持的 V1PRO。");
  }
  await openClaimed(device);
  return device;
}

/**
 * @param {USBDevice} device
 */
async function openClaimed(device) {
  try {
    await acquireWebUsbTabLock(device);
    await requestDesktopHandoff(device);
    if (!device.opened) await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);
    const endpoints = pickBulkEndpoints(device);
    const session = {
      ...endpoints,
      pendingIn: null,
      firmwareInfo: undefined,
    };
    deviceSessions.set(device, session);
    await device.claimInterface(session.interfaceNumber);
    await drainInQuick(device);
  } catch (err) {
    deviceSessions.delete(device);
    try {
      if (device.opened) await device.close();
    } catch {
      /* ignore */
    }
    await releaseDesktopHandoff(device);
    await releaseWebUsbTabLock(device);
    throw new V1ProUsbError("claim_failed", formatUsbOpenHint(err), err);
  }
}

/**
 * @param {USBDevice|null|undefined} device
 */
export async function closeDevice(device) {
  if (!device) return;
  const session = deviceSessions.get(device);
  try {
    if (device.opened) {
      try {
        await device.releaseInterface(session?.interfaceNumber ?? 0);
      } catch {
        /* ignore */
      }
      await device.close();
    }
  } catch {
    /* ignore */
  }
  deviceSessions.delete(device);
  await releaseDesktopHandoff(device);
  await releaseWebUsbTabLock(device);
}

/**
 * @param {string|null|undefined} text
 * @returns {{
 *   jedecHex: string,
 *   model: number,
 *   totalMb: number,
 *   usableMb: number,
 *   productFrames: number,
 *   lcdW: number,
 *   lcdH: number,
 *   capabilities: string[],
 *   gfm2: boolean,
 *   gfm3: boolean,
 *   persistentCompression: boolean,
 *   liveLz4: boolean,
 *   hardwareVariant: "V1P"|"V2"|"UNKNOWN",
 *   materialMaxFps: number,
 *   maxPayloadBytes: number,
 *   maxFrames: number,
 * }|null}
 */
export function parseJedecReply(text) {
  if (!text) return null;
  const parts = text.trim().split(",");
  if (parts[0] !== "JED" || parts.length < 6) return null;

  const jedecHex = parts[1] || "";
  const model = Number.parseInt(parts[2], 10);
  const totalMb = Number.parseFloat(parts[3]);
  const usableMb = Number.parseFloat(parts[4]);
  const productFrames = Number.parseInt(parts[5], 10);
  if (!Number.isFinite(productFrames) || productFrames <= 0) {
    return null;
  }
  let lcdW = Number.parseInt(parts[6], 10) || 320;
  let lcdH = Number.parseInt(parts[7], 10) || 170;
  if (!(lcdW >= 100 && lcdW <= 1024 && lcdH >= 100 && lcdH <= 1024)) {
    lcdW = 320;
    lcdH = 170;
  }

  const capabilities = parts.slice(8).map((part) => part.trim()).filter(Boolean);
  const upperCapabilities = capabilities.map((part) => part.toUpperCase());
  const gfm2 = upperCapabilities.includes("GFM2");
  const gfm3 = upperCapabilities.some((part) => part === "GFM3" || part === "LZ4P");
  const liveLz4 = upperCapabilities.includes("LZ4L");
  const hardwareTokens = upperCapabilities
    .filter((part) => part.startsWith("HW="))
    .map((part) => part.slice(3).trim());
  let hardwareVariant;
  if (hardwareTokens.length) {
    hardwareVariant = new Set(hardwareTokens).size === 1 ? hardwareTokens[0] : "UNKNOWN";
    if (hardwareVariant !== "V1P" && hardwareVariant !== "V2") hardwareVariant = "UNKNOWN";
  } else if (lcdW === 320 && lcdH === 170) {
    hardwareVariant = "V1P";
  } else if (lcdW === 320 && lcdH === 240) {
    hardwareVariant = "V2";
  } else {
    hardwareVariant = "UNKNOWN";
  }
  const expectedGeometry = hardwareVariant === "V1P"
    ? [320, 170]
    : hardwareVariant === "V2"
      ? [320, 240]
      : null;
  if (expectedGeometry && (lcdW !== expectedGeometry[0] || lcdH !== expectedGeometry[1])) {
    hardwareVariant = "UNKNOWN";
  }
  const persistentCompression = gfm2 && gfm3;
  const materialMaxFps = hardwareVariant === "UNKNOWN" ? 30 : 45;

  const totalBytes = Number.isFinite(totalMb) && totalMb > 0 ? Math.floor(totalMb * 1024 * 1024) : 0;
  const maxPayloadBytes = Math.min(
    ANIM_FLASH_MAX_BYTES,
    totalBytes > 0 ? Math.max(0, totalBytes - 0x1000) : ANIM_FLASH_MAX_BYTES,
  );
  const framesByBytes = Math.max(
    1,
    Math.floor((maxPayloadBytes - 56) / (2 + lcdW * lcdH * 2)),
  );
  // Use firmware product_frames; total_mb is the full animation region (77/154/308).
  const maxFrames = Math.max(1, Math.min(productFrames, framesByBytes));

  return {
    jedecHex,
    model: Number.isFinite(model) ? model : 0,
    totalMb: Number.isFinite(totalMb) ? totalMb : 0,
    usableMb: Number.isFinite(usableMb) ? usableMb : 0,
    productFrames,
    lcdW,
    lcdH,
    capabilities,
    gfm2,
    gfm3,
    persistentCompression,
    liveLz4,
    hardwareVariant,
    materialMaxFps,
    maxPayloadBytes,
    maxFrames,
  };
}

/** Parse `FW,1,info,MMMMmmPP,...,app,...` returned by APP firmware. */
export function parseFirmwareInfoReply(text) {
  if (!text) return null;
  const parts = text.replace(/\0/g, "").trim().split(",");
  if (
    parts.length < 6 ||
    parts[0].toUpperCase() !== "FW" ||
    parts[1] !== "1" ||
    parts[2].toLowerCase() !== "info"
  ) {
    return null;
  }
  const versionWord = Number.parseInt(parts[3], 16);
  if (!Number.isFinite(versionWord)) return null;
  const packed = versionWord >>> 0;
  const major = (packed >>> 24) & 0xff;
  const minor = (packed >>> 16) & 0xff;
  const patch = (packed >>> 8) & 0xff;
  const mode = parts[5].trim().toLowerCase();
  return {
    versionWord: packed,
    version: `V${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
    mode,
    supportsCompressedTransport:
      mode === "app" && packed >= MIN_COMPRESSED_TRANSPORT_VERSION_WORD,
  };
}

/**
 * Best-effort APP version query. It is read-only and safe on old firmware;
 * unsupported devices simply time out and remain on the legacy raw protocol.
 */
export async function queryFirmwareInfo(device) {
  const session = getSession(device);
  if (session.firmwareInfo !== undefined) return session.firmwareInfo;

  try {
    await drainInQuick(device);
    const command = new Uint8Array([
      USBDL_MAGIC0,
      USBDL_MAGIC1,
      USBDL_CMD_FW,
      USBDL_FW_SUB_INFO,
    ]);
    await transferOutWithRetry(
      device,
      session.outEndpoint,
      command,
      IO_TIMEOUT_MS,
      2,
    );
    const reply = await readTextReply(
      device,
      ["FW,1,info,"],
      FIRMWARE_INFO_TIMEOUT_MS,
    );
    session.firmwareInfo = parseFirmwareInfoReply(reply);
  } catch {
    session.firmwareInfo = null;
  }
  return session.firmwareInfo;
}

/**
 * Query device Flash capacity via JEDEC command.
 * Some firmwares reply more reliably after a PING wake-up.
 * @param {USBDevice} device
 * @param {{ wake?: boolean, retries?: number }} [opts]
 */
export async function queryDeviceCapacity(device, opts = {}) {
  const wake = opts.wake !== false;
  const retries = Math.max(1, opts.retries ?? 3);
  const { outEndpoint } = getSession(device);

  if (wake) {
    try {
      await drainInQuick(device);
      const pingCmd = new Uint8Array([USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_PING]);
      await transferOutWithRetry(device, outEndpoint, pingCmd, IO_TIMEOUT_MS, 3);
      const wakeReply = await readTextReply(
        device,
        ["PONG", "JED,"],
        Math.max(PING_TIMEOUT_MS, PROBE_POLL_TIMEOUT_MS)
      );
      // Rare firmwares answer the wake with JEDEC text; accept it immediately.
      if (wakeReply && wakeReply.startsWith("JED,")) {
        const parsedWake = parseJedecReply(wakeReply);
        if (parsedWake) return parsedWake;
      }
    } catch {
      // wake is best-effort; continue to JEDEC
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await drainInQuick(device);
      const jedecCmd = new Uint8Array([USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_JEDEC]);
      await transferOutWithRetry(device, outEndpoint, jedecCmd, IO_TIMEOUT_MS, 3);
      const jedec = await readTextReply(device, ["JED,"], JEDEC_PROBE_TIMEOUT_MS);
      const parsed = parseJedecReply(jedec);
      if (parsed) return parsed;
    } catch (err) {
      lastError = err;
    }
    await sleep(40);
  }

  if (lastError instanceof V1ProUsbError) throw lastError;
  if (lastError) {
    throw new V1ProUsbError("jedec_failed", formatUsbOpenHint(lastError), lastError);
  }
  return null;
}

/**
 * @param {USBDevice} device
 * @returns {Promise<boolean>}
 */
export async function ping(device, opts = {}) {
  const { outEndpoint } = getSession(device);
  await drainInQuick(device);

  const pingCmd = new Uint8Array([USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_PING]);
  try {
    await transferOutWithRetry(device, outEndpoint, pingCmd, IO_TIMEOUT_MS, 3);
  } catch (err) {
    if (err instanceof V1ProUsbError) throw err;
    throw new V1ProUsbError("ping_failed", formatUsbOpenHint(err), err);
  }

  const pong = await readTextReply(
    device,
    ["PONG"],
    Math.max(PING_TIMEOUT_MS, PROBE_POLL_TIMEOUT_MS)
  );
  if (pong) {
    if (opts.requireAnimation === true && /,A0(?:,|$)/.test(pong)) {
      throw new V1ProUsbError(
        "gfm1_rejected",
        "设备未接受本次动画数据，请重新连接后重试。"
      );
    }
    return true;
  }

  const jedecCmd = new Uint8Array([USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_JEDEC]);
  try {
    await transferOutWithRetry(device, outEndpoint, jedecCmd, IO_TIMEOUT_MS, 3);
  } catch (err) {
    if (err instanceof V1ProUsbError) throw err;
    throw new V1ProUsbError("ping_failed", formatUsbOpenHint(err), err);
  }

  const jedec = await readTextReply(device, ["JED,"], JEDEC_PROBE_TIMEOUT_MS);
  if (jedec) return true;

  throw new V1ProUsbError(
    "ping_timeout",
    "设备无响应 PING。请确认：① 已进入应用固件（非 Bootloader）；② 已关闭控制工具；③ USB 已插好；④ 设备未处于屏保/时钟界面。将尝试跳过探测直接传输。"
  );
}

/**
 * Best-effort device probe; does not throw on timeout.
 * @param {USBDevice} device
 * @returns {Promise<{ ok: boolean, note?: string }>}
 */
export async function probeDevice(device) {
  try {
    await ping(device);
    let capacity = null;
    try {
      capacity = await queryDeviceCapacity(device);
    } catch {
      capacity = null;
    }
    return { ok: true, capacity };
  } catch (err) {
    const message =
      err instanceof V1ProUsbError
        ? err.message
        : err && err.message
          ? String(err.message)
          : "设备探测失败";
    return { ok: false, note: message };
  }
}

function createDrainTracker() {
  let lastDrainAt = Date.now();
  let bytesSinceDrain = 0;
  return {
    /**
     * @param {USBDevice} device
     * @param {number} bytesWritten
     */
    async maybeDrain(device, bytesWritten) {
      bytesSinceDrain += bytesWritten;
      const now = Date.now();
      if (
        bytesSinceDrain >= TRANSFER_DRAIN_BYTES ||
        now - lastDrainAt >= TRANSFER_DRAIN_INTERVAL_MS
      ) {
        await drainInQuick(device);
        lastDrainAt = now;
        bytesSinceDrain = 0;
      }
    },
  };
}

/**
 * @param {USBDevice} device
 * @param {Uint8Array} gfm1
 * @param {{ onProgress?: (sent: number, total: number) => void }} [opts]
 */
export async function sendGfm1(device, gfm1, opts = {}) {
  if (!(gfm1 instanceof Uint8Array) || gfm1.length < 56) {
    throw new V1ProUsbError("invalid_gfm1", "GFM1 载荷无效。");
  }
  const maxPayloadBytes = opts.maxPayloadBytes ?? ANIM_FLASH_MAX_BYTES;
  if (gfm1.length > maxPayloadBytes) {
    throw new V1ProUsbError(
      "gfm1_too_large",
      `GFM1 过大（${gfm1.length} 字节），超过设备 Flash 上限。`
    );
  }

  async function* chunks() {
    yield gfm1;
  }
  return sendGfm1PayloadStream(device, gfm1.length, chunks(), opts);
}

function buildStartPreamble(totalBytes) {
  const preamble = new Uint8Array(8);
  preamble[0] = USBDL_MAGIC0;
  preamble[1] = USBDL_MAGIC1;
  preamble[2] = USBDL_CMD_START;
  preamble[3] = totalBytes & 0xff;
  preamble[4] = (totalBytes >>> 8) & 0xff;
  preamble[5] = (totalBytes >>> 16) & 0xff;
  preamble[6] = (totalBytes >>> 24) & 0xff;
  preamble[7] = 0x00;
  return preamble;
}

export function buildCompressedStartPreamble(wireBytes, rawBytes) {
  const preamble = new Uint8Array(16);
  const view = new DataView(preamble.buffer);
  preamble[0] = USBDL_MAGIC0;
  preamble[1] = USBDL_MAGIC1;
  preamble[2] = USBDL_CMD_START_COMPRESSED;
  view.setUint32(3, wireBytes, true);
  view.setUint32(7, rawBytes, true);
  view.setUint16(11, TRANSPORT_BLOCK_SIZE, true);
  preamble[13] = TRANSPORT_VERSION;
  preamble[14] = 0x00;
  preamble[15] = 0x00;
  return preamble;
}

function validateStreamSize(totalBytes, maxPayloadBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new V1ProUsbError("invalid_gfm1", "GFM1 载荷无效。");
  }
  if (totalBytes > maxPayloadBytes) {
    throw new V1ProUsbError(
      "gfm1_too_large",
      `GFM1 过大（${totalBytes} 字节），超过设备 Flash 上限。`
    );
  }
}

/**
 * Estimate a safe wait for the firmware's mixed 64K/32K/4K erase plan. The
 * fixed margin also covers slower flash parts and USB scheduling jitter.
 * @param {number} totalBytes
 */
export function estimateSizedEraseTimeoutMs(totalBytes) {
  const alignedBytes = Math.ceil(totalBytes / ERASE_SECTOR_BYTES) * ERASE_SECTOR_BYTES;
  const blocks64K = Math.floor(alignedBytes / ERASE_BLOCK_64K_BYTES);
  let remaining = alignedBytes - blocks64K * ERASE_BLOCK_64K_BYTES;
  const blocks32K = Math.floor(remaining / ERASE_BLOCK_32K_BYTES);
  remaining -= blocks32K * ERASE_BLOCK_32K_BYTES;
  const sectors4K = Math.ceil(remaining / ERASE_SECTOR_BYTES);
  const estimatedSeconds = blocks64K * 0.42 + blocks32K * 0.24 + sectors4K * 0.1;
  return Math.max(20000, Math.ceil(estimatedSeconds * 1500 + 45000));
}

/** @param {number} totalBytes */
function buildSizedEraseCommand(totalBytes) {
  const erase = new Uint8Array(7);
  const view = new DataView(erase.buffer);
  erase[0] = USBDL_MAGIC0;
  erase[1] = USBDL_MAGIC1;
  erase[2] = USBDL_CMD_ERASE;
  view.setUint32(3, totalBytes, true);
  return erase;
}

/**
 * @param {string|null} reply
 * @param {number} requestedBytes
 */
export function parseSizedEraseReply(reply, requestedBytes) {
  if (typeof reply !== "string") return null;
  const fields = reply.trim().split(",");
  if (fields[0]?.toUpperCase() !== "OK_ERASE") return null;
  if (fields.length === 1 || fields[1]?.trim() === "") return requestedBytes;
  const confirmedBytes = Number(fields[1]);
  return Number.isSafeInteger(confirmedBytes) && confirmedBytes >= 0
    ? confirmedBytes
    : null;
}

/** @param {string|null} reply */
export function isResetStreamReply(reply) {
  if (typeof reply !== "string") return false;
  const normalized = reply.trim().toUpperCase();
  return normalized === "OK_ERASE" || normalized === "RST,2" || normalized.startsWith("RST,2,");
}

/**
 * @param {USBDevice} device
 * @param {number} timeoutMs
 */
async function resetTransferStream(device, timeoutMs) {
  const reset = Uint8Array.of(USBDL_MAGIC0, USBDL_MAGIC1, USBDL_CMD_RESET_STREAM, 0xa6);
  await bulkOut(device, reset);
  const reply = await readTextReply(
    device,
    ["OK_ERASE", "RST,2", "ERR", "BUSY", "FAIL"],
    timeoutMs
  );
  if (!isResetStreamReply(reply)) {
    throw new V1ProUsbError(
      "erase_reset_failed",
      reply ? `设备复位擦除状态失败：${reply}` : "设备复位擦除状态超时。"
    );
  }
}

/**
 * @param {USBDevice} device
 * @param {Uint8Array} command
 * @param {number} requestedBytes
 * @param {number} timeoutMs
 */
async function sendSizedEraseAndWait(device, command, requestedBytes, timeoutMs) {
  await bulkOut(device, command);
  const reply = await readTextReply(
    device,
    ["OK_ERASE", "BUSY", "ERR", "FAIL"],
    timeoutMs
  );
  const confirmedBytes = parseSizedEraseReply(reply, requestedBytes);
  if (confirmedBytes == null) {
    throw new V1ProUsbError(
      "erase_failed",
      reply ? `设备预擦除失败：${reply}` : "设备预擦除确认超时。"
    );
  }
  return confirmedBytes;
}

/**
 * Start a sized erase without entering GFM1 receive state. New firmware erases
 * in parallel with download/encode; old firmware safely ignores this command
 * and performs its normal erase when START arrives later.
 */
export async function beginGfm1PayloadStream(device, totalBytes, opts = {}) {
  const maxPayloadBytes = opts.maxPayloadBytes ?? ANIM_FLASH_MAX_BYTES;
  validateStreamSize(totalBytes, maxPayloadBytes);
  await drainInQuick(device);
  const erase = buildSizedEraseCommand(totalBytes);
  if (opts.waitForAck === false) {
    await bulkOut(device, erase);
    return totalBytes;
  }

  const eraseTimeoutMs = opts.eraseTimeoutMs ?? estimateSizedEraseTimeoutMs(totalBytes);
  const resetTimeoutMs = opts.resetTimeoutMs ?? Math.min(5000, eraseTimeoutMs);
  try {
    return await sendSizedEraseAndWait(device, erase, totalBytes, eraseTimeoutMs);
  } catch (firstError) {
    try {
      await resetTransferStream(device, resetTimeoutMs);
      // Consume a delayed erase/reset response before issuing the single retry.
      await drainInQuick(device);
      return await sendSizedEraseAndWait(device, erase, totalBytes, eraseTimeoutMs);
    } catch (retryError) {
      throw new V1ProUsbError(
        "erase_failed",
        retryError instanceof Error ? retryError.message : "设备预擦除失败。",
        firstError
      );
    }
  }
}

/**
 * Send START then a legacy raw or V0.0.35+ LZ4 block stream. Compression is
 * selected only after the complete one-shot encoder output is ready, ensuring
 * there is no pause after START and allowing an exact no-benefit fallback.
 * @param {USBDevice} device
 * @param {number} totalBytes GFM1 payload size (excluding 8-byte START header)
 * @param {AsyncIterable<Uint8Array>} payloadChunks
 * @param {{ onProgress?: (sent: number, total: number, transport?: object) => void, verificationTimeoutMs?: number }} [opts]
 */
export async function sendGfm1PayloadStream(device, totalBytes, payloadChunks, opts = {}) {
  const maxPayloadBytes = opts.maxPayloadBytes ?? ANIM_FLASH_MAX_BYTES;
  validateStreamSize(totalBytes, maxPayloadBytes);

  const startAlreadySent = opts.startAlreadySent === true;
  let prepared = null;
  let firmwareInfo = null;
  if (!startAlreadySent) {
    firmwareInfo = await queryFirmwareInfo(device);
    if (firmwareInfo?.supportsCompressedTransport) {
      try {
        prepared = await prepareTransportPayload(payloadChunks, totalBytes);
      } catch (err) {
        throw new V1ProUsbError(
          "invalid_gfm1",
          err instanceof Error ? err.message : "GFM1 压缩流准备失败。",
          err,
        );
      }
    }
  }

  if (!startAlreadySent) {
    await drainInQuick(device);
  }
  const compressed = prepared?.compressed === true;
  const preamble = compressed
    ? buildCompressedStartPreamble(prepared.wireBytes, totalBytes)
    : buildStartPreamble(totalBytes);
  const payloadWireBytes = compressed ? prepared.wireBytes : totalBytes;
  const transport = {
    compressed,
    protocol: compressed ? "lz4-block-v1" : "raw",
    firmwareVersion: firmwareInfo?.version,
    rawBytes: totalBytes,
    wireBytes: payloadWireBytes,
    streamBytes: preamble.length + payloadWireBytes,
    blockCount: prepared?.blockCount ?? 0,
    compressedBlocks: compressed ? prepared.compressedBlocks : 0,
    ratio: compressed ? prepared.ratio : 1,
  };

  const streamLen = transport.streamBytes;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  let sent = startAlreadySent ? preamble.length : 0;
  const drainTracker = createDrainTracker();
  const prefetchBeforeStart = Math.max(
    0,
    startAlreadySent ? 1 : (opts.prefetchBeforeStart ?? 3)
  );

  const writeChunk = async (chunk) => {
    if (!(chunk instanceof Uint8Array) || chunk.length === 0) return;
    await bulkOut(device, chunk);
    sent += chunk.length;
    await drainTracker.maybeDrain(device, chunk.length);
    if (onProgress) onProgress(Math.min(sent, streamLen), streamLen, transport);
  };

  const source = prepared
    ? (async function* preparedChunks() {
        for (const chunk of prepared.chunks) yield chunk;
      })()
    : payloadChunks;
  const iter = source[Symbol.asyncIterator]();
  const queue = [];
  let producerDone = false;
  let producerError = null;

  for (let i = 0; i < prefetchBeforeStart; i += 1) {
    const next = await iter.next();
    if (next.done) {
      producerDone = true;
      break;
    }
    queue.push(next.value);
  }

  const producer = (async () => {
    try {
      while (true) {
        const next = await iter.next();
        if (next.done) break;
        queue.push(next.value);
      }
    } catch (err) {
      producerError = err;
    } finally {
      producerDone = true;
    }
  })();

  if (!startAlreadySent) {
    await writeChunk(preamble);
  } else if (onProgress) {
    onProgress(sent, streamLen, transport);
  }

  while (!producerDone || queue.length > 0) {
    if (producerError) {
      throw producerError;
    }
    if (queue.length > 0) {
      const chunk = queue.shift();
      await writeChunk(chunk);
      continue;
    }
    await sleep(4);
  }

  try {
    await producer;
  } catch (err) {
    if (!producerError) {
      producerError = err;
      throw err;
    }
  }

  if (sent !== streamLen) {
    throw new V1ProUsbError(
      "invalid_gfm1",
      `GFM1 传输流长度错误：已发送 ${sent - preamble.length} 字节，期望 ${payloadWireBytes} 字节。`
    );
  }

  /* Wait for the device to finish draining its USB ring and commit playback.
   * Closing the interface immediately after transferOut can otherwise make the
   * firmware classify an otherwise complete browser transfer as interrupted. */
  const verificationTimeoutMs = Math.max(0, Math.trunc(opts.verificationTimeoutMs || 0));
  if (!verificationTimeoutMs) {
    await ping(device, { requireAnimation: true });
  } else {
    const deadline = Date.now() + verificationTimeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        await ping(device, { requireAnimation: true });
        lastError = null;
        break;
      } catch (error) {
        if (error instanceof V1ProUsbError && error.code === "gfm1_rejected") throw error;
        lastError = error;
        await sleep(250);
      }
    }
    if (lastError) {
      throw new V1ProUsbError(
        "gfm_verify_timeout",
        "设备仍在校验压缩素材或未返回完成状态，请保持连接后重试。",
        lastError,
      );
    }
  }
  return transport;
}
