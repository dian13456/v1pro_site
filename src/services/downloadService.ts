import { apiFetch } from "./httpClient";
import { getAuthState, hasValidLocalAuth, verifyTokenRemote } from "./authService";
import { isStaticMode } from "./runtimeMode";

interface DownloadSignResponse {
  success: boolean;
  url?: string;
  message?: string;
}

interface GinResourceResponse {
  url?: string;
  error?: string;
}

export async function createDownloadUrl(resourceId: number, fallbackDownloadUrl?: string): Promise<string> {
  const auth = getAuthState();
  if (!hasValidLocalAuth() || !auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const valid = await verifyTokenRemote();
  if (!valid) {
    throw new Error("认证已失效，请重新验证设备");
  }
  if (isStaticMode()) {
    if (!fallbackDownloadUrl) {
      throw new Error("静态模式下缺少下载地址");
    }
    return fallbackDownloadUrl;
  }

  try {
    const signed = await apiFetch<GinResourceResponse>(`/api/resource/?id=${resourceId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (signed.url) {
      return signed.url;
    }
    throw new Error(signed.error || "下载链接生成失败");
  } catch {
    // Fallback to existing Worker endpoint for compatibility.
    const result = await apiFetch<DownloadSignResponse>("/api/download-sign", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({
        resourceId,
      }),
    });

    if (!result.success || !result.url) {
      throw new Error(result.message || "下载链接生成失败");
    }

    return result.url;
  }
}
