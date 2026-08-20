const USB_COMMAND_MAGIC_0 = 0xa5;
const USB_COMMAND_MAGIC_1 = 0x5a;
const USB_COMMAND_URL = 0x0d;
const USB_URL_QUERY = 0xfc;
const USB_URL_ENABLE = 0xfd;
const USB_REPLY_BYTES = 64;
const USB_COMMAND_TIMEOUT_MS = 2_000;

interface BulkEndpoints {
  interfaceNumber: number;
  inEndpoint: number;
  outEndpoint: number;
}

function findBulkEndpoints(device: USBDevice): BulkEndpoints {
  const configuration = device.configuration;
  if (configuration) {
    for (const usbInterface of configuration.interfaces) {
      for (const alternate of usbInterface.alternates) {
        const input = alternate.endpoints.find(
          (endpoint) => endpoint.direction === "in" && endpoint.type === "bulk",
        );
        const output = alternate.endpoints.find(
          (endpoint) => endpoint.direction === "out" && endpoint.type === "bulk",
        );
        if (input && output) {
          return {
            interfaceNumber: usbInterface.interfaceNumber,
            inEndpoint: input.endpointNumber,
            outEndpoint: output.endpointNumber,
          };
        }
      }
    }
  }
  return { interfaceNumber: 0, inEndpoint: 1, outEndpoint: 1 };
}

function withUsbTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("USB 配置响应超时")),
      USB_COMMAND_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function sendCommand(
  device: USBDevice,
  endpoints: BulkEndpoints,
  payload: Uint8Array,
  expectedPrefix: string,
): Promise<string> {
  const commandBuffer = new ArrayBuffer(payload.byteLength);
  new Uint8Array(commandBuffer).set(payload);
  const output = await withUsbTimeout(
    device.transferOut(endpoints.outEndpoint, commandBuffer),
  );
  if (output.status !== "ok") {
    throw new Error("USB 配置写入失败");
  }

  const input = await withUsbTimeout(
    device.transferIn(endpoints.inEndpoint, USB_REPLY_BYTES),
  );
  if (input.status !== "ok" || !input.data) {
    throw new Error("USB 配置读取失败");
  }
  const reply = new TextDecoder()
    .decode(input.data.buffer.slice(input.data.byteOffset, input.data.byteOffset + input.data.byteLength))
    .replace(/\0+$/g, "")
    .trim();
  if (!reply.toUpperCase().startsWith(expectedPrefix)) {
    throw new Error(`USB 配置响应异常：${reply || "空响应"}`);
  }
  return reply;
}

/**
 * The factory firmware opens the website once through its HID boot launcher.
 * After the user grants WebUSB access and enters the site, turn that launcher
 * off so later power cycles do not repeatedly open the browser.
 */
export async function disableBootWebsiteAfterEntry(device: USBDevice): Promise<boolean> {
  if (!device.opened) {
    await device.open();
  }
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }

  const endpoints = findBulkEndpoints(device);
  let claimed = false;
  try {
    await device.claimInterface(endpoints.interfaceNumber);
    claimed = true;
    const query = await sendCommand(
      device,
      endpoints,
      new Uint8Array([
        USB_COMMAND_MAGIC_0,
        USB_COMMAND_MAGIC_1,
        USB_COMMAND_URL,
        USB_URL_QUERY,
      ]),
      "URL,",
    );
    const enabled = /^URL,1(?:,|$)/i.test(query);
    if (!enabled) {
      return false;
    }

    const disabled = await sendCommand(
      device,
      endpoints,
      new Uint8Array([
        USB_COMMAND_MAGIC_0,
        USB_COMMAND_MAGIC_1,
        USB_COMMAND_URL,
        USB_URL_ENABLE,
        0,
      ]),
      "URLE,",
    );
    if (!/^URLE,0$/i.test(disabled)) {
      throw new Error(`设备未确认关闭上电打开网站：${disabled}`);
    }
    return true;
  } finally {
    if (claimed) {
      try {
        await device.releaseInterface(endpoints.interfaceNumber);
      } catch {
        // The outer authentication flow closes the handle as a final fallback.
      }
    }
  }
}
