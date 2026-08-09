export interface V1ProWebUsbDevice {
  opened?: boolean;
  serialNumber?: string;
  productName?: string;
}

export interface V1ProDeviceCapacity {
  jedecHex: string;
  model: number;
  totalMb: number;
  usableMb: number;
  productFrames: number;
  maxPayloadBytes: number;
  maxFrames: number;
}

export interface V1ProTransferProgress {
  phase: "encode" | "transfer";
  sent: number;
  total: number;
  ratio: number;
  frameCount?: number;
  note?: string;
}

export interface V1ProTransferResult {
  bytes: number;
  frameCount: number;
  note?: string;
}

export interface V1ProTransferFileOptions {
  fileName?: string;
  maxFrames?: number;
  maxVideoFps?: number;
  maxVideoSpeed?: number;
  pingFirst?: boolean;
  requirePing?: boolean;
  onProgress?: (info: V1ProTransferProgress) => void;
}

export interface V1ProConnectOptions {
  reuseAuthorized?: boolean;
}

export class V1ProUsbError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "V1ProUsbError";
    this.code = code;
  }
}

export interface V1ProWebTransferClient {
  device: V1ProWebUsbDevice | null;
  deviceCapacity: V1ProDeviceCapacity | null;
  busy: boolean;
  readonly connected: boolean;
  connect(opts?: V1ProConnectOptions): Promise<V1ProWebUsbDevice>;
  disconnect(): Promise<void>;
  refreshDeviceCapacity(): Promise<V1ProDeviceCapacity | null>;
  getCapacityLabel(): string;
  transferFile(file: Blob, opts?: V1ProTransferFileOptions): Promise<V1ProTransferResult>;
}
