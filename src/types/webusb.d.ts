interface USBDevice {
  opened: boolean;
  vendorId: number;
  productId: number;
  serialNumber?: string;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>;
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
  configuration?: USBConfiguration | null;
}

interface USBOutTransferResult {
  status: "ok" | "stall" | "babble";
  bytesWritten: number;
}

interface USBInTransferResult {
  status: "ok" | "stall" | "babble";
  data?: DataView;
}

interface Navigator {
  usb: USB;
}

interface USB {
  getDevices(): Promise<USBDevice[]>;
  requestDevice(options: USBDeviceRequestOptions): Promise<USBDevice>;
  addEventListener(
    type: "connect" | "disconnect",
    listener: (event: USBConnectionEvent) => void
  ): void;
  removeEventListener(
    type: "connect" | "disconnect",
    listener: (event: USBConnectionEvent) => void
  ): void;
}

interface USBConnectionEvent extends Event {
  device: USBDevice;
}

interface USBDeviceRequestOptions {
  filters: USBDeviceFilter[];
}

interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
}

interface USBConfiguration {
  interfaces: USBInterface[];
}

interface USBInterface {
  interfaceNumber: number;
  alternates: USBAlternateInterface[];
}

interface USBAlternateInterface {
  endpoints: USBEndpoint[];
}

interface USBEndpoint {
  endpointNumber: number;
  direction: "in" | "out";
  type: "bulk" | "interrupt" | "isochronous" | "control";
}
