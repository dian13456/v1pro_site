declare module "@v1pro-webusb/v1pro-web-transfer.js" {
  export const WEBUSB_TRANSFER_VERSION: string;
  export const V1ProUsbError: typeof import("./types/v1proWebTransfer").V1ProUsbError;
  export const V1ProWebTransfer: new () => import("./types/v1proWebTransfer").V1ProWebTransferClient;
  export function listAuthorizedDevices(): Promise<USBDevice[]>;
}
