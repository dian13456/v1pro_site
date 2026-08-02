import type { V1ProWebTransferClient } from "../types/v1proWebTransfer";

/** 与 public/webusb/v1pro-constants.js 中 WEBUSB_TRANSFER_VERSION 保持一致 */
export const WEBUSB_TRANSFER_VERSION = "1.0.2";

let sdkPromise: Promise<{
  V1ProWebTransfer: new () => V1ProWebTransferClient;
  V1ProUsbError: typeof import("../types/v1proWebTransfer").V1ProUsbError;
  WEBUSB_TRANSFER_VERSION?: string;
}> | null = null;

function sdkUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base}webusb/v1pro-web-transfer.js?v=${WEBUSB_TRANSFER_VERSION}`;
}

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

export async function loadV1ProWebTransferSdk() {
  if (!sdkPromise) {
    sdkPromise = import(/* @vite-ignore */ sdkUrl()) as Promise<{
      V1ProWebTransfer: new () => V1ProWebTransferClient;
      V1ProUsbError: typeof import("../types/v1proWebTransfer").V1ProUsbError;
    }>;
  }
  return sdkPromise;
}

export async function createV1ProWebTransferClient(): Promise<V1ProWebTransferClient> {
  const { V1ProWebTransfer } = await loadV1ProWebTransferSdk();
  return new V1ProWebTransfer();
}
