/** V1PRO WebUSB shared constants (align with usb_send_gif.py / USB protocol). */

export const V1PRO_USB_FILTERS = [
  { vendorId: 0x0483, productId: 0x66aa },
  { vendorId: 0x2e3c, productId: 0x5753 },
];

/**
 * WebUSB transferIn/Out 使用端点号 1–15（不含方向位）。
 * 描述符里 IN 是 0x81、OUT 是 0x01，API 两侧都传 1。
 */
export const EP_OUT = 1;
export const EP_IN = 1;
export const USB_CHUNK = 64;

export const USBDL_MAGIC0 = 0xa5;
export const USBDL_MAGIC1 = 0x5a;
export const USBDL_CMD_START = 0x01;
export const USBDL_CMD_JEDEC = 0x07;
export const USBDL_CMD_PING = 0x09;

export const LCD_W = 320;
export const LCD_H = 170;
export const FRAME_PIXEL_BYTES = LCD_W * LCD_H * 2; // 108800
export const ANIM_VERSION = 1;
export const ANIM_MIN_FRAME_MS = 1;
export const DEFAULT_FRAME_MS = 100;

/** W25Q256-class: 32 MiB minus ANIM_FLASH_BASE 0x1000 */
export const ANIM_FLASH_MAX_BYTES = 0x02000000 - 0x1000;

/** Soft cap for browser GIF / short-video decode (frames). */
export const DEFAULT_MAX_GIF_FRAMES = 70;

/** Short video clip cap for WebUSB test page (seconds). */
export const DEFAULT_MAX_VIDEO_SEC = 10;

/** Sample rate when converting short video to GFM1 frames. */
export const DEFAULT_VIDEO_FPS = 10;

/** WebUSB 直传测试页 / SDK 版本（用于确认是否加载到最新静态资源）。 */
export const WEBUSB_TRANSFER_VERSION = "1.1.0";

export const PING_TIMEOUT_MS = 1500;
export const IO_TIMEOUT_MS = 15000;
