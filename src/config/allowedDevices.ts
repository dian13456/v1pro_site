export interface UsbDeviceId {
  vendorId: number;
  productId: number;
}

/** 授权 USB 设备列表（WebUSB 弹窗仅显示这些设备） */
export const ALLOWED_USB_DEVICES: UsbDeviceId[] = [
  { vendorId: 0x0483, productId: 0x66aa },
  { vendorId: 0x2e3c, productId: 0x5753 },
];

export function isAllowedUsbDevice(vendorId: number, productId: number): boolean {
  return ALLOWED_USB_DEVICES.some(
    (device) => device.vendorId === vendorId && device.productId === productId
  );
}

export function usbDeviceFilters(): USBDeviceFilter[] {
  return ALLOWED_USB_DEVICES.map((device) => ({
    vendorId: device.vendorId,
    productId: device.productId,
  }));
}

export function formatUsbDeviceId(vendorId: number, productId: number): { vid: string; pid: string } {
  return {
    vid: vendorId.toString(16).padStart(4, "0"),
    pid: productId.toString(16).padStart(4, "0"),
  };
}
