import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

interface ImageSignResponse {
  url?: string;
  error?: string;
}

const imageUrlCache = new Map<number, string>();
const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

export async function createImageUrl(resourceId: number, fallbackImageUrl?: string): Promise<string> {
  if (imageUrlCache.has(resourceId)) {
    return imageUrlCache.get(resourceId) as string;
  }

  if (isStaticMode()) {
    if (!fallbackImageUrl) {
      throw new Error("静态模式下缺少图片地址");
    }
    imageUrlCache.set(resourceId, fallbackImageUrl);
    return fallbackImageUrl;
  }

  const auth = getAuthState();
  if (!hasValidLocalAuth() || !auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  try {
    const signed = await apiFetch<ImageSignResponse>(`/api/image/?id=${resourceId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (!signed.url) {
      throw new Error(signed.error || "图片链接生成失败");
    }

    imageUrlCache.set(resourceId, signed.url);
    return signed.url;
  } catch {
    if (fallbackImageUrl && ABSOLUTE_HTTP_URL.test(fallbackImageUrl)) {
      imageUrlCache.set(resourceId, fallbackImageUrl);
      return fallbackImageUrl;
    }
    throw new Error("图片链接生成失败");
  }
}
