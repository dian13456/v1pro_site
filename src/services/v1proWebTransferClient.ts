import type { V1ProWebTransferClient } from "../types/v1proWebTransfer";

/** 与 public/webusb/v1pro-constants.js 中 WEBUSB_TRANSFER_VERSION 保持一致 */
export const WEBUSB_TRANSFER_VERSION = "1.2.7";

type WebUsbSdkModule = {
  V1ProWebTransfer: new () => V1ProWebTransferClient;
  V1ProUsbError: typeof import("../types/v1proWebTransfer").V1ProUsbError;
  WEBUSB_TRANSFER_VERSION?: string;
};

let sdkPromise: Promise<WebUsbSdkModule> | null = null;
let sdkLoadedVersion = "";

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

export async function loadV1ProWebTransferSdk(): Promise<WebUsbSdkModule> {
  if (sdkPromise && sdkLoadedVersion !== WEBUSB_TRANSFER_VERSION) {
    sdkPromise = null;
  }
  if (!sdkPromise) {
    sdkLoadedVersion = WEBUSB_TRANSFER_VERSION;
    sdkPromise = import("@v1pro-webusb/v1pro-web-transfer.js").catch((err: unknown) => {
      sdkPromise = null;
      sdkLoadedVersion = "";
      throw err;
    });
  }
  return sdkPromise;
}

export async function createV1ProWebTransferClient(): Promise<V1ProWebTransferClient> {
  const { V1ProWebTransfer } = await loadV1ProWebTransferSdk();
  return new V1ProWebTransfer();
}
