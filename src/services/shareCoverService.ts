export const MAX_SHARE_COVER_BYTES = 8 * 1024 * 1024;

const SUPPORTED_COVER_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const SUPPORTED_COVER_EXTENSIONS = /\.(jpe?g|png|webp)$/i;

export function validateShareCoverFile(file: File): string | null {
  const supportedType = SUPPORTED_COVER_MIME_TYPES.has(file.type.toLowerCase());
  const supportedExtension = SUPPORTED_COVER_EXTENSIONS.test(file.name);
  if (!supportedType && !supportedExtension) {
    return "封面仅支持 JPG、PNG 或 WebP 图片";
  }
  if (file.size <= 0) {
    return "封面文件无效";
  }
  if (file.size > MAX_SHARE_COVER_BYTES) {
    return `封面图片不能超过 ${Math.floor(MAX_SHARE_COVER_BYTES / 1024 / 1024)}MB`;
  }
  return null;
}

function loadCoverImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取封面图片，请换一张重试"));
    };
    image.src = objectUrl;
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("封面图片处理失败，请换一张重试"));
      }
    }, "image/jpeg", quality);
  });
}

export async function prepareShareCoverJpeg(
  file: File,
  maxEdge = 1280,
  quality = 0.85,
): Promise<Blob> {
  const validationError = validateShareCoverFile(file);
  if (validationError) {
    throw new Error(validationError);
  }

  const image = await loadCoverImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("封面图片尺寸无效，请换一张重试");
  }

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("当前浏览器无法处理封面图片");
  }

  // JPEG does not preserve transparency. A light background avoids transparent
  // PNG/WebP covers becoming black on material cards.
  context.fillStyle = "#f5f7fb";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvasToJpegBlob(canvas, quality);
}
