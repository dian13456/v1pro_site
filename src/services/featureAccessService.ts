import { useEffect, useState } from "react";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

export interface DeviceFeatureAccess {
  enabled: boolean;
  grandfathered: boolean;
  registeredAt: number;
  activatedAt?: number;
}

const ACCESS_CHANGED_EVENT = "jiadian-feature-access-changed";
const cache = new Map<string, DeviceFeatureAccess>();
const inflight = new Map<string, Promise<DeviceFeatureAccess>>();

function currentAuth() {
  const auth = getAuthState();
  if (!auth?.serial || !auth.token || !hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  return auth;
}

function publish(serial: string, access: DeviceFeatureAccess) {
  cache.set(serial, access);
  window.dispatchEvent(new CustomEvent(ACCESS_CHANGED_EVENT, { detail: { serial, access } }));
  return access;
}

export async function fetchDeviceFeatureAccess(force = false): Promise<DeviceFeatureAccess> {
  const auth = currentAuth();
  if (isStaticMode()) {
    return publish(auth.serial, { enabled: true, grandfathered: true, registeredAt: 0 });
  }
  if (!force && cache.has(auth.serial)) return cache.get(auth.serial) as DeviceFeatureAccess;
  if (!force && inflight.has(auth.serial)) return inflight.get(auth.serial) as Promise<DeviceFeatureAccess>;

  const request = apiFetch<{ success: boolean; access: DeviceFeatureAccess; message?: string }>(
    "/api/profile/feature-access",
    { method: "GET", headers: { Authorization: `Bearer ${auth.token}` } },
  )
    .then((payload) => {
      if (!payload.success || !payload.access) throw new Error(payload.message || "设备权限读取失败");
      return publish(auth.serial, payload.access);
    })
    .finally(() => inflight.delete(auth.serial));
  inflight.set(auth.serial, request);
  return request;
}

export async function activateDeviceFeatures(code: string): Promise<DeviceFeatureAccess> {
  const auth = currentAuth();
  if (isStaticMode()) {
    if (code.trim() !== "1234") throw new Error("激活码不正确");
    return publish(auth.serial, { enabled: true, grandfathered: false, registeredAt: Date.now(), activatedAt: Date.now() });
  }
  const payload = await apiFetch<{ success: boolean; access: DeviceFeatureAccess; message?: string }>(
    "/api/profile/feature-access/activate",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    },
  );
  if (!payload.success || !payload.access) throw new Error(payload.message || "激活失败");
  return publish(auth.serial, payload.access);
}

export async function requireDeviceFeatureAccess(): Promise<void> {
  const access = await fetchDeviceFeatureAccess();
  if (!access.enabled) {
    throw new Error("请先到个人中心输入激活码，激活下载与传输功能");
  }
}

export function useDeviceFeatureAccess(): { access: DeviceFeatureAccess | null; loading: boolean } {
  const serial = getAuthState()?.serial || "";
  const [access, setAccess] = useState<DeviceFeatureAccess | null>(() => cache.get(serial) || null);
  const [loading, setLoading] = useState(() => Boolean(serial) && !cache.has(serial));

  useEffect(() => {
    if (!serial) {
      setAccess(null);
      setLoading(false);
      return;
    }
    let active = true;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ serial: string; access: DeviceFeatureAccess }>).detail;
      if (detail?.serial === serial) setAccess(detail.access);
    };
    window.addEventListener(ACCESS_CHANGED_EVENT, onChanged);
    setLoading(!cache.has(serial));
    void fetchDeviceFeatureAccess()
      .then((next) => active && setAccess(next))
      .catch(() => active && setAccess(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      window.removeEventListener(ACCESS_CHANGED_EVENT, onChanged);
    };
  }, [serial]);

  return { access, loading };
}
