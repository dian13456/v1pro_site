/** 与 winusb_host_gui.py「发送图片」默认参数保持一致 */
const rotateDeg = Number(import.meta.env.VITE_USB_ROTATE_DEG || 90);

export const DESKTOP_IMAGE_TRANSFER = {
  width: 170,
  height: 320,
  chunkSize: 56,
  writeRetries: 8,
  paceMs: 0,
  // 横屏写入默认 90（与桌面版一致）
  rotateDeg: Number.isFinite(rotateDeg) ? rotateDeg : 90,
  scalePct: 100,
  fitMode: "contain" as const,
  swapRgb565: false,
  /** 高速主路径默认关闭逐包 ACK，ACK 仅在 fallback 里启用 */
  ackEachWhenInAvailable: false,
  /** 仅写模式（IN 不可读）时与桌面版 sleep 一致 */
  writeOnlyStartDelayMs: 50,
  writeOnlyEndDelayMs: 200,
  /** WebUSB 批量写：64KB~256KB 都可，这里默认 64KB，进度反馈更及时 */
  webBatchBytes: 64 * 1024,
};
