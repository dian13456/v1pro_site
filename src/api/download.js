import { apiFetch } from "./client";
import { getAuthState } from "./auth";

export async function requestSignedDownload(productId, resourceType) {
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("登录状态失效，请重新验证设备");
  }

  return apiFetch("/api/download-sign", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      productId,
      resourceType,
    }),
  });
}
