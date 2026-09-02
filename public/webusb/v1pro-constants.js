/** V1PRO WebUSB shared constants (align with usb_send_gif.py / USB protocol). */

export const V1PRO_USB_FILTERS = [
  { vendorId: 0x0483, productId: 0x66aa },
  { vendorId: 0x0483, productId: 0x66ab },
  { vendorId: 0x2e3c, productId: 0x5753 },
];

/**
 * WebUSB transferIn/Out 使用端点号 1–15（不含方向位）。
 * 描述符里 IN 是 0x81、OUT 是 0x01，API 两侧都传 1。
 */
export const EP_OUT = 1;
export const EP_IN = 1;
/**
 * One WebUSB transferOut submission. USB still packetizes this into 64-byte
 * endpoint packets; batching avoids thousands of browser/JS round trips.
 */
export const USB_CHUNK = 64 * 1024;

export const USBDL_MAGIC0 = 0xa5;
export const USBDL_MAGIC1 = 0x5a;
export const USBDL_CMD_START = 0x01;
export const USBDL_CMD_START_COMPRESSED = 0x02;
export const USBDL_CMD_ERASE = 0x04;
export const USBDL_CMD_JEDEC = 0x07;
export const USBDL_CMD_DISPLAY = 0x08;
export const USBDL_DISPLAY_SUB_BRIGHTNESS = 0xff;
export const USBDL_DISPLAY_SUB_ROTATE = 0xfe;
export const USBDL_DISPLAY_SUB_FOLLOW_SCREEN_OFF = 0xfd;
export const USBDL_DISPLAY_SUB_QUERY = 0xfc;
export const USBDL_CMD_PING = 0x09;
export const USBDL_CMD_LIVE = 0x0b;
export const USBDL_CMD_FW = 0x0c;
export const USBDL_FW_SUB_INFO = 0x01;
export const USBDL_CMD_URL = 0x0d;
export const USBDL_CMD_SPECTRUM = 0x0e;
export const SPECTRUM_SUB_STOP = 0x00;
export const SPECTRUM_SUB_START = 0x01;
export const SPECTRUM_SUB_FRAME = 0x02;
export const SPECTRUM_BANDS = 32;
export const SPECTRUM_MAX_HEIGHT = 140;
export const USBDL_URL_SUB_COMMIT = 0xfa;
export const USBDL_URL_SUB_CHUNK = 0xfb;
export const USBDL_URL_SUB_QUERY = 0xfc;
export const USBDL_URL_SUB_ENABLE = 0xfd;
export const USBDL_URL_SUB_BEGIN = 0xfe;
export const USBDL_URL_SUB_WRITE = 0xff;
export const USB_HID_URL_MAX_LEN = 180;

export let LCD_W = 320;
export let LCD_H = 170;
export let FRAME_PIXEL_BYTES = LCD_W * LCD_H * 2;

export function configurePanelGeometry(width, height) {
  const w = Math.trunc(Number(width));
  const h = Math.trunc(Number(height));
  if (!(w >= 100 && w <= 1024 && h >= 100 && h <= 1024)) {
    throw new Error(`无效屏幕尺寸：${width}x${height}`);
  }
  LCD_W = w;
  LCD_H = h;
  FRAME_PIXEL_BYTES = w * h * 2;
}
export const ANIM_VERSION = 1;
export const ANIM_MIN_FRAME_MS = 1;
export const DEFAULT_FRAME_MS = 100;

/** W25Q256-class: 32 MiB minus ANIM_FLASH_BASE 0x1000 */
export const ANIM_FLASH_MAX_BYTES = 0x02000000 - 0x1000;

/** Soft cap for browser GIF decode when device capacity is unknown. */
export const DEFAULT_MAX_GIF_FRAMES = 70;

/** Video encode: prefer up to this output fps (device capacity may lower it). */
export const MAX_VIDEO_FPS = 30;

/** Identified V1P/V2 hardware supports beginner-mode material up to 45 fps. */
export const MAX_MATERIAL_FPS = 45;

/** Lowest permitted video output fps before applying playback speed-up. */
export const MIN_VIDEO_FPS = 20;

/** GUI beginner mode uses at most 10x after real compressed-byte fitting. */
export const MAX_VIDEO_SPEED = 10;

/** Short video clip cap when device capacity is unknown (seconds). */
export const DEFAULT_MAX_VIDEO_SEC = 10;

/** Sample rate when converting short video to GFM1 frames (fallback). */
export const DEFAULT_VIDEO_FPS = 10;

/** WebUSB 直传测试页 / SDK 版本（用于确认是否加载到最新静态资源）。 */
export const WEBUSB_TRANSFER_VERSION = "1.2.36";

/** GFM1 payload chunks to encode before sending START (keeps USB stream alive during video seek). */
export const PREFETCH_CHUNKS_BEFORE_START = 6;

export const PING_TIMEOUT_MS = 1500;
export const IO_TIMEOUT_MS = 15000;
