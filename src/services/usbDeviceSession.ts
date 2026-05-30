import { DESKTOP_IMAGE_TRANSFER } from "../config/desktopTransfer";
import { isAllowedUsbDevice, usbDeviceFilters } from "../config/allowedDevices";
import {
  DEFAULT_CHUNK_SIZE,
  USB_FRAME_SIZE,
  buildDataFramesBuffer,
  buildEndPacket,
  buildStartPacket,
  decodeAckText,
} from "./usbProtocol";

export interface UsbEndpoints {
  device: USBDevice;
  interfaceNumber: number;
  outEndpoint: number;
  inEndpoint: number;
}

export interface StaticImagePushOptions {
  width?: number;
  height?: number;
  chunkSize?: number;
  ackEach?: boolean;
  writeRetries?: number;
  onProgress?: (sent: number, total: number) => void;
}

const START_ACKS = new Set(["OK_START", "ER_WH", "ER_START"]);
const DATA_ACKS = new Set(["OK_D", "ER_CRC", "ER_SEQ", "ER_DATA", "ER_WR"]);
const END_ACKS = new Set(["OK_SHOW", "ER_SIZE", "ER_FCRC", "ER_FLSH", "ER_END"]);
const PING_ACKS = new Set(["OK_PING"]);
const PING_PACKET = new Uint8Array([0xa5, 0x5a, 0x0d]);
const MIN_BATCH_BYTES = 64 * 1024;
const MAX_BATCH_BYTES = 256 * 1024;
const MAX_IN_FLIGHT = 3;
const PROGRESS_UPDATE_MS = 60;
const PERIODIC_DRAIN_MS = 250;

let cachedWriteOnlyMode: boolean | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

export async function resolveAuthorizedDevice(): Promise<USBDevice> {
  if (!("usb" in navigator)) {
    throw new Error("当前浏览器不支持 WebUSB");
  }

  const granted = await navigator.usb.getDevices();
  const matched = granted.filter((device) => isAllowedUsbDevice(device.vendorId, device.productId));
  if (matched.length > 0) {
    return matched[0];
  }

  try {
    return await navigator.usb.requestDevice({ filters: usbDeviceFilters() });
  } catch (error) {
    const domError = error as DOMException;
    if (domError?.name === "NotFoundError") {
      throw new Error("未找到可用设备，请连接后重试");
    }
    throw error;
  }
}

function pickBulkEndpoints(device: USBDevice): { interfaceNumber: number; outEndpoint: number; inEndpoint: number } {
  const configuration = device.configuration;
  if (!configuration) {
    throw new Error("USB 配置无效");
  }

  for (const usbInterface of configuration.interfaces) {
    for (const alternate of usbInterface.alternates) {
      const out = alternate.endpoints.find((endpoint) => endpoint.direction === "out" && endpoint.type === "bulk");
      const input = alternate.endpoints.find((endpoint) => endpoint.direction === "in" && endpoint.type === "bulk");
      if (out && input) {
        return {
          interfaceNumber: usbInterface.interfaceNumber,
          outEndpoint: out.endpointNumber,
          inEndpoint: input.endpointNumber,
        };
      }
    }
  }

  return { interfaceNumber: 0, outEndpoint: 0x01, inEndpoint: 0x02 };
}

export async function prepareUsbSession(device: USBDevice): Promise<UsbEndpoints> {
  if (!device.opened) {
    await device.open();
  }

  if (!device.configuration) {
    await device.selectConfiguration(1);
  }

  const { interfaceNumber, outEndpoint, inEndpoint } = pickBulkEndpoints(device);
  try {
    await device.claimInterface(interfaceNumber);
  } catch {
    // Interface may already be claimed during auth flow.
  }

  return { device, interfaceNumber, outEndpoint, inEndpoint };
}

export async function drainIn(device: USBDevice, inEndpoint: number): Promise<void> {
  for (let i = 0; i < 32; i += 1) {
    try {
      const result = await withTimeout(device.transferIn(inEndpoint, 64), 30, "drain timeout");
      if (result.status !== "ok" || !result.data || result.data.byteLength === 0) {
        break;
      }
    } catch {
      break;
    }
  }
}

async function quickDrainIn(device: USBDevice, inEndpoint: number): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    try {
      const result = await withTimeout(device.transferIn(inEndpoint, 64), 8, "drain timeout");
      if (result.status !== "ok" || !result.data || result.data.byteLength === 0) {
        break;
      }
    } catch {
      break;
    }
  }
}

export async function readAckText(
  device: USBDevice,
  inEndpoint: number,
  expected: Set<string>,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const left = Math.max(20, Math.min(200, deadline - Date.now()));
      const result = await withTimeout(device.transferIn(inEndpoint, 64), left, "ack poll timeout");
      if (result.status !== "ok" || !result.data) {
        continue;
      }
      const text = decodeAckText(result.data);
      if (text && expected.has(text)) {
        return text;
      }
    } catch {
      // keep polling until deadline
    }
  }
  throw new Error("设备应答超时");
}

async function transferOutWithRetry(
  device: USBDevice,
  outEndpoint: number,
  data: Uint8Array,
  retries: number
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const result = await device.transferOut(
        outEndpoint,
        new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength)
      );
      if (result.status === "ok") {
        return;
      }
    } catch {
      if (attempt + 1 < retries) {
        await sleep(2);
      }
    }
  }
  throw new Error("USB 写入失败");
}

function clampBatchSize(value: number): number {
  return Math.max(MIN_BATCH_BYTES, Math.min(MAX_BATCH_BYTES, value));
}

function createProgressReporter(
  totalPayloadBytes: number,
  onProgress?: (sent: number, total: number) => void
): (sentPayloadBytes: number, force?: boolean) => void {
  let lastReportAt = 0;
  let lastSent = -1;
  return (sentPayloadBytes: number, force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && sentPayloadBytes === lastSent) return;
    if (!force && now - lastReportAt < PROGRESS_UPDATE_MS) return;
    lastSent = sentPayloadBytes;
    lastReportAt = now;
    onProgress(sentPayloadBytes, totalPayloadBytes);
  };
}

interface PendingWrite {
  promise: Promise<void>;
  sentPayloadBytes: number;
}

async function transferOutHighThroughput(
  session: UsbEndpoints,
  frames: Uint8Array,
  payloadBytes: number,
  writeRetries: number,
  onProgress?: (sent: number, total: number) => void
): Promise<void> {
  const { device, outEndpoint, inEndpoint } = session;
  const report = createProgressReporter(payloadBytes, onProgress);
  const batchBytes = clampBatchSize(DESKTOP_IMAGE_TRANSFER.webBatchBytes);
  const total = frames.length;

  let offset = 0;
  let lastDrainAt = Date.now();
  const queue: PendingWrite[] = [];
  report(0, true);

  const enqueue = (sliceStart: number, sliceEnd: number): void => {
    const chunk = frames.subarray(sliceStart, sliceEnd);
    const sentPayloadBytes = Math.min(payloadBytes, Math.round((sliceEnd / total) * payloadBytes));
    queue.push({
      promise: transferOutWithRetry(device, outEndpoint, chunk, writeRetries),
      sentPayloadBytes,
    });
  };

  while (offset < total || queue.length > 0) {
    while (queue.length < MAX_IN_FLIGHT && offset < total) {
      const end = Math.min(offset + batchBytes, total);
      enqueue(offset, end);
      offset = end;
    }

    const head = queue.shift();
    if (!head) continue;
    await head.promise;
    report(head.sentPayloadBytes);

    const now = Date.now();
    if (now - lastDrainAt >= PERIODIC_DRAIN_MS) {
      await quickDrainIn(device, inEndpoint);
      lastDrainAt = now;
    }
  }

  await quickDrainIn(device, inEndpoint);
  report(payloadBytes, true);
}

async function transferOutAckFallback(
  session: UsbEndpoints,
  frames: Uint8Array,
  payloadBytes: number,
  chunkSize: number,
  writeRetries: number,
  ackEach: boolean,
  onProgress?: (sent: number, total: number) => void
): Promise<void> {
  const { device, outEndpoint, inEndpoint } = session;
  const frameCount = frames.length / USB_FRAME_SIZE;
  const report = createProgressReporter(payloadBytes, onProgress);
  let sent = 0;
  report(0, true);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    const start = frameIndex * USB_FRAME_SIZE;
    const frame = frames.subarray(start, start + USB_FRAME_SIZE);
    await transferOutWithRetry(device, outEndpoint, frame, writeRetries);

    if (ackEach) {
      const dataAck = await readAckText(device, inEndpoint, DATA_ACKS, 1500);
      if (dataAck !== "OK_D") {
        throw new Error(`分包应答错误 (${sent}): ${dataAck}`);
      }
    }

    sent = Math.min(payloadBytes, sent + chunkSize);
    report(sent);
    if (DESKTOP_IMAGE_TRANSFER.paceMs > 0) {
      await sleep(DESKTOP_IMAGE_TRANSFER.paceMs);
    }
  }

  report(payloadBytes, true);
}

async function probeInAck(session: UsbEndpoints): Promise<boolean> {
  const { device, outEndpoint, inEndpoint } = session;
  await drainIn(device, inEndpoint);
  try {
    await transferOutWithRetry(device, outEndpoint, PING_PACKET, DESKTOP_IMAGE_TRANSFER.writeRetries);
    const ack = await readAckText(device, inEndpoint, PING_ACKS, 2000);
    return ack === "OK_PING";
  } catch {
    return false;
  }
}

async function pushStaticImagePayloadInternal(
  session: UsbEndpoints,
  payload: Uint8Array,
  useRle: boolean,
  writeOnlyMode: boolean,
  options: StaticImagePushOptions
): Promise<void> {
  const width = options.width ?? DESKTOP_IMAGE_TRANSFER.width;
  const height = options.height ?? DESKTOP_IMAGE_TRANSFER.height;
  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_SIZE));
  const writeRetries = options.writeRetries ?? DESKTOP_IMAGE_TRANSFER.writeRetries;
  const ackEach = !writeOnlyMode && options.ackEach === true;

  const { device, outEndpoint, inEndpoint } = session;
  await drainIn(device, inEndpoint);

  const startPacket = useRle ? buildStartPacket(width, height, payload.length) : buildStartPacket(width, height);
  await transferOutWithRetry(device, outEndpoint, startPacket, writeRetries);

  if (writeOnlyMode) {
    await sleep(DESKTOP_IMAGE_TRANSFER.writeOnlyStartDelayMs);
  } else {
    const startAck = await readAckText(device, inEndpoint, START_ACKS, 10000);
    if (startAck !== "OK_START") {
      throw new Error(`设备拒绝开始帧: ${startAck}`);
    }
  }

  const { frames, frameCrc } = buildDataFramesBuffer(payload, chunkSize);
  if (writeOnlyMode) {
    await transferOutHighThroughput(session, frames, payload.length, writeRetries, options.onProgress);
  } else {
    await transferOutAckFallback(session, frames, payload.length, chunkSize, writeRetries, ackEach, options.onProgress);
  }

  const endPacket = buildEndPacket(frameCrc);
  await transferOutWithRetry(device, outEndpoint, endPacket, writeRetries);

  if (writeOnlyMode) {
    await quickDrainIn(device, inEndpoint);
    await sleep(DESKTOP_IMAGE_TRANSFER.writeOnlyEndDelayMs);
    return;
  }

  const endAck = await readAckText(device, inEndpoint, END_ACKS, 30000);
  if (endAck !== "OK_SHOW") {
    throw new Error(`设备拒绝结束帧: ${endAck}`);
  }
}

export async function pushStaticImagePayload(
  session: UsbEndpoints,
  payload: Uint8Array,
  useRle: boolean,
  options: StaticImagePushOptions = {}
): Promise<void> {
  // 高性能主路径：默认 writeOnly，避免 ACK polling 开销。
  let writeOnlyMode = cachedWriteOnlyMode ?? true;

  try {
    await pushStaticImagePayloadInternal(session, payload, useRle, writeOnlyMode, options);
  } catch (error) {
    const message = (error as Error)?.message || "";
    if (writeOnlyMode) {
      // 主路径失败时再尝试 ACK fallback，避免影响正常高速传输。
      const canAck = await probeInAck(session);
      if (canAck) {
        cachedWriteOnlyMode = false;
        await pushStaticImagePayloadInternal(session, payload, useRle, false, options);
        return;
      }
      if (message.includes("应答超时")) {
        throw new Error("设备应答超时，请确认设备未处于时间显示/屏保模式，并重新插拔后再试");
      }
      throw error;
    }

    if (message.includes("应答超时")) {
      cachedWriteOnlyMode = true;
      await pushStaticImagePayloadInternal(session, payload, useRle, true, options);
      return;
    }
    throw error;
  }

  cachedWriteOnlyMode = writeOnlyMode;
}
