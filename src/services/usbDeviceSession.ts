import { isAllowedUsbDevice, usbDeviceFilters } from "../config/allowedDevices";
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_WRITE_RETRIES,
  LCD_HEIGHT,
  LCD_WIDTH,
  buildDataPacket,
  buildEndPacket,
  buildStartPacket,
  crc16Ccitt,
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
      const result = await withTimeout(
        device.transferIn(inEndpoint, 64),
        40,
        "drain timeout"
      );
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
      const left = Math.max(30, Math.min(120, deadline - Date.now()));
      const result = await withTimeout(
        device.transferIn(inEndpoint, 64),
        left,
        "ack poll timeout"
      );
      if (result.status !== "ok" || !result.data) {
        await sleep(20);
        continue;
      }
      const text = decodeAckText(result.data);
      if (text && expected.has(text)) {
        return text;
      }
    } catch {
      await sleep(20);
    }
  }
  throw new Error("设备应答超时");
}

async function transferOutWithRetry(
  device: USBDevice,
  outEndpoint: number,
  data: Uint8Array,
  retries = DEFAULT_WRITE_RETRIES
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const result = await device.transferOut(outEndpoint, data);
      if (result.status === "ok") {
        return;
      }
    } catch {
      await sleep(2);
    }
  }
  throw new Error("USB 写入失败");
}

export async function pushStaticImagePayload(
  session: UsbEndpoints,
  payload: Uint8Array,
  useRle: boolean,
  options: StaticImagePushOptions = {}
): Promise<void> {
  const width = options.width ?? LCD_WIDTH;
  const height = options.height ?? LCD_HEIGHT;
  const chunkSize = Math.max(1, Math.min(options.chunkSize ?? DEFAULT_CHUNK_SIZE, 56));
  const writeRetries = options.writeRetries ?? DEFAULT_WRITE_RETRIES;
  const onProgress = options.onProgress;

  const { device, outEndpoint, inEndpoint } = session;
  const ackEach = options.ackEach ?? true;

  await drainIn(device, inEndpoint);

  const startPacket = useRle ? buildStartPacket(width, height, payload.length) : buildStartPacket(width, height);
  await transferOutWithRetry(device, outEndpoint, startPacket, writeRetries);

  const startAck = await readAckText(device, inEndpoint, START_ACKS, 10000);
  if (startAck !== "OK_START") {
    throw new Error(`设备拒绝开始帧: ${startAck}`);
  }

  let sent = 0;
  let seq = 0;
  let frameCrc = 0xffff;
  const total = payload.length;
  onProgress?.(0, total);

  while (sent < total) {
    const end = Math.min(sent + chunkSize, total);
    const part = payload.subarray(sent, end);
    const packet = buildDataPacket(seq, part);
    await transferOutWithRetry(device, outEndpoint, packet, writeRetries);

    if (ackEach) {
      const dataAck = await readAckText(device, inEndpoint, DATA_ACKS, 1500);
      if (dataAck !== "OK_D") {
        throw new Error(`分包应答错误 (${sent}): ${dataAck}`);
      }
    }

    frameCrc = crc16Ccitt(part, frameCrc);
    sent = end;
    seq = (seq + 1) & 0xff;
    onProgress?.(sent, total);
  }

  const endPacket = buildEndPacket(frameCrc);
  await transferOutWithRetry(device, outEndpoint, endPacket, writeRetries);

  const endAck = await readAckText(device, inEndpoint, END_ACKS, 30000);
  if (endAck !== "OK_SHOW") {
    throw new Error(`设备拒绝结束帧: ${endAck}`);
  }
}
