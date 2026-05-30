import { LCD_HEIGHT, LCD_WIDTH } from "./usbProtocol";

export type ImageFitMode = "fill" | "contain";

function rgbTo565(r: number, g: number, b: number): [number, number] {
  return [(r & 0xf8) | (g >> 5), ((g & 0x1c) << 3) | (b >> 3)];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = url;
  });
}

function drawSourceToPanel(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceW: number,
  sourceH: number,
  dstW: number,
  dstH: number,
  fitMode: ImageFitMode
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, dstW, dstH);

  if (sourceW <= 0 || sourceH <= 0) {
    throw new Error("图片尺寸无效");
  }

  let drawW = dstW;
  let drawH = dstH;
  let offsetX = 0;
  let offsetY = 0;

  if (fitMode === "contain") {
    const scale = Math.min(dstW / sourceW, dstH / sourceH);
    drawW = Math.max(1, Math.round(sourceW * scale));
    drawH = Math.max(1, Math.round(sourceH * scale));
    offsetX = Math.floor((dstW - drawW) / 2);
    offsetY = Math.floor((dstH - drawH) / 2);
  }

  ctx.drawImage(source, offsetX, offsetY, drawW, drawH);
}

function fitDrawImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dstW: number,
  dstH: number,
  fitMode: ImageFitMode
): void {
  drawSourceToPanel(ctx, img, img.naturalWidth, img.naturalHeight, dstW, dstH, fitMode);
}

export async function fetchImageToRgb565(
  url: string,
  options: { width?: number; height?: number; fitMode?: ImageFitMode; rotateDeg?: number } = {}
): Promise<Uint8Array> {
  const width = options.width ?? LCD_WIDTH;
  const height = options.height ?? LCD_HEIGHT;
  const fitMode = options.fitMode ?? "fill";
  const rotateDeg = options.rotateDeg ?? 0;

  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 不可用");
  }

  if (rotateDeg === 90 || rotateDeg === 180 || rotateDeg === 270) {
    const radians = (-rotateDeg * Math.PI) / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    const rotatedW = Math.max(1, Math.round(img.naturalWidth * cos + img.naturalHeight * sin));
    const rotatedH = Math.max(1, Math.round(img.naturalWidth * sin + img.naturalHeight * cos));
    const rotateCanvas = document.createElement("canvas");
    rotateCanvas.width = rotatedW;
    rotateCanvas.height = rotatedH;
    const rotateCtx = rotateCanvas.getContext("2d");
    if (!rotateCtx) {
      throw new Error("Canvas 不可用");
    }
    rotateCtx.translate(rotatedW / 2, rotatedH / 2);
    rotateCtx.rotate(radians);
    rotateCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    canvas.width = width;
    canvas.height = height;
    drawSourceToPanel(ctx, rotateCanvas, rotatedW, rotatedH, width, height, fitMode);
  } else {
    canvas.width = width;
    canvas.height = height;
    fitDrawImage(ctx, img, width, height, fitMode);
  }

  const { data } = ctx.getImageData(0, 0, width, height);
  const out = new Uint8Array(width * height * 2);
  let o = 0;
  for (let i = 0; i < data.length; i += 4) {
    const [lo, hi] = rgbTo565(data[i], data[i + 1], data[i + 2]);
    out[o] = lo;
    out[o + 1] = hi;
    o += 2;
  }
  return out;
}

export function encodeRgb565Rle(raw: Uint8Array): Uint8Array {
  if (raw.length % 2 !== 0) {
    throw new Error("RGB565 长度必须为偶数");
  }

  const out: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const c0 = raw[i];
    const c1 = raw[i + 1];
    let j = i + 2;
    let count = 1;
    while (j < raw.length && raw[j] === c0 && raw[j + 1] === c1 && count < 0xffff) {
      count += 1;
      j += 2;
    }
    out.push(count & 0xff, (count >> 8) & 0xff, c0, c1);
    i = j;
  }
  return new Uint8Array(out);
}

export function prepareRgb565Payload(raw: Uint8Array): { payload: Uint8Array; useRle: boolean } {
  const compressed = encodeRgb565Rle(raw);
  const useRle = compressed.length < raw.length && compressed.length > 0 && compressed.length % 4 === 0;
  return {
    payload: useRle ? compressed : raw,
    useRle,
  };
}
