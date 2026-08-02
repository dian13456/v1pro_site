export interface V1ProWebUsbDevice {
  opened?: boolean;
  serialNumber?: string;
  productName?: string;
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
  pingFirst?: boolean;
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
  busy: boolean;
  readonly connected: boolean;
  connect(opts?: V1ProConnectOptions): Promise<V1ProWebUsbDevice>;
  disconnect(): Promise<void>;
  transferFile(file: Blob, opts?: V1ProTransferFileOptions): Promise<V1ProTransferResult>;
}
