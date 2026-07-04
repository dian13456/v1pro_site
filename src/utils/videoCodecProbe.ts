export interface VideoCodecProbeResult {
  compatible: boolean;
  reason?: string;
}

const PROBE_BYTES = 512 * 1024;

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function includesAscii(bytes: Uint8Array, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  return indexOfBytes(bytes, needle) >= 0;
}

function readAvcProfile(bytes: Uint8Array): number | null {
  const marker = new TextEncoder().encode("avcC");
  const index = indexOfBytes(bytes, marker);
  if (index < 0 || index + 9 >= bytes.length) return null;
  return bytes[index + 8];
}

export async function probeVideoBrowserCompatibility(file: File): Promise<VideoCodecProbeResult> {
  const chunk = await file.slice(0, Math.min(file.size, PROBE_BYTES)).arrayBuffer();
  const bytes = new Uint8Array(chunk);

  if (includesAscii(bytes, "hvc1") || includesAscii(bytes, "hev1") || includesAscii(bytes, "hvt1")) {
    return {
      compatible: false,
      reason: "检测到 HEVC/H.265 编码，Edge 浏览器无法播放。请上传 H.264 8-bit 的 MP4 视频。",
    };
  }

  if (includesAscii(bytes, "av01") || includesAscii(bytes, "dav1")) {
    return {
      compatible: false,
      reason: "检测到 AV1 编码，Edge 浏览器可能无法播放。请上传 H.264 8-bit 的 MP4 视频。",
    };
  }

  const avcProfile = readAvcProfile(bytes);
  if (avcProfile === 110) {
    return {
      compatible: false,
      reason: "检测到 H.264 10-bit (Hi10P) 编码，Edge 浏览器无法播放。请转换为 8-bit H.264 MP4 后再上传。",
    };
  }

  return { compatible: true };
}
