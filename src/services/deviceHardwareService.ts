/** Identify the dedicated V1 firmware without opening its USB interface. */
export function identifyUsbHardware(device: Pick<USBDevice,
  "vendorId" | "productId" | "productName" | "deviceVersionMajor" | "deviceVersionMinor" | "deviceVersionSubminor"
>): "V1" | undefined {
  // PID 66AB also exists on older V1PRO units. Require the descriptor set
  // declared by V1 firmware User/v1pro_usb_desc.c (product + bcdDevice 0401).
  if (
    device.vendorId === 0x0483 &&
    device.productId === 0x66ab &&
    device.productName?.trim() === "佳点V1" &&
    device.deviceVersionMajor === 4 &&
    device.deviceVersionMinor === 0 &&
    device.deviceVersionSubminor === 1
  ) return "V1";
  return undefined;
}
