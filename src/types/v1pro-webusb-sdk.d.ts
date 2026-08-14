declare module "@v1pro-webusb/v1pro-web-transfer.js" {
  export const V1ProWebTransfer: new () => import("./v1proWebTransfer").V1ProWebTransferClient;
  export const V1ProUsbError: typeof import("./v1proWebTransfer").V1ProUsbError;
  export const WEBUSB_TRANSFER_VERSION: string;
  export function listAuthorizedDevices(): Promise<USBDevice[]>;
}
