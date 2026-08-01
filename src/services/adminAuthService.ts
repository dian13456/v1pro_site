import { apiFetch } from "./httpClient";

const ADMIN_SESSION_KEY = "jiadian_admin_session_token";
const LEGACY_ADMIN_SESSION_KEY = "jiadian_activity_admin_token";

export function getAdminToken(): string {
  const current = sessionStorage.getItem(ADMIN_SESSION_KEY)?.trim();
  if (current) {
    return current;
  }
  const legacy = sessionStorage.getItem(LEGACY_ADMIN_SESSION_KEY)?.trim();
  if (legacy) {
    sessionStorage.setItem(ADMIN_SESSION_KEY, legacy);
    sessionStorage.removeItem(LEGACY_ADMIN_SESSION_KEY);
    return legacy;
  }
  return "";
}

export function isAdminLoggedIn(): boolean {
  return getAdminToken() !== "";
}

export function clearAdminSession(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(LEGACY_ADMIN_SESSION_KEY);
}

export async function loginAdmin(password: string): Promise<void> {
  const payload = await apiFetch<{ success: boolean; token?: string; message?: string }>("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: password.trim() }),
  });
  if (!payload.success || !payload.token) {
    throw new Error(payload.message || "登录失败");
  }
  sessionStorage.setItem(ADMIN_SESSION_KEY, payload.token.trim());
  sessionStorage.removeItem(LEGACY_ADMIN_SESSION_KEY);
}
