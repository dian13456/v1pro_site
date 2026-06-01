import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import type { DownloadStatsSnapshot } from "../types/downloadStats";

interface DownloadStatsResponse {
  success?: boolean;
  weekKey?: string;
  totalCounts?: Record<string, number>;
  weeklyCounts?: Record<string, number>;
}

export interface ResourceDownloadStats {
  weekKey: string;
  totalCounts: Record<number, number>;
  weeklyCounts: Record<number, number>;
}

/** 前端展示倍数（不影响服务端真实统计） */
export const DOWNLOAD_COUNT_DISPLAY_MULTIPLIER = 2;
export const MAX_DOWNLOADS_PER_HOUR = 50;
export const MAX_DOWNLOADS_PER_DAY = 100;

export function displayDownloadCount(count: number): number {
  return Math.max(0, Math.floor(count)) * DOWNLOAD_COUNT_DISPLAY_MULTIPLIER;
}

const LOCAL_TOTAL_COUNTS_KEY = "jiadian_hub_download_total_counts";
const LOCAL_WEEKLY_COUNTS_KEY = "jiadian_hub_download_weekly_counts";
const LOCAL_WEEK_KEY = "jiadian_hub_download_week_key";

interface DeviceDownloadWindow {
  hourKey: string;
  dayKey: string;
  hourCount: number;
  dayCount: number;
}

function deviceWindowStorageKey(serial: string): string {
  return `jiadian_hub_device_download_${serial}`;
}

function currentHourKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`;
}

function currentDayKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toNumberId(value: number | string): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function currentWeekKey(date = new Date()): string {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function normalizeCounts(raw: Record<string, number> | undefined): Record<number, number> {
  const result: Record<number, number> = {};
  for (const [key, count] of Object.entries(raw || {})) {
    const id = toNumberId(key);
    if (id !== null && Number.isFinite(count) && count >= 0) {
      result[id] = Math.floor(count);
    }
  }
  return result;
}

function readLocalDownloadStats(): ResourceDownloadStats {
  const weekKey = localStorage.getItem(LOCAL_WEEK_KEY) || currentWeekKey();
  const currentWeek = currentWeekKey();
  if (weekKey !== currentWeek) {
    localStorage.setItem(LOCAL_WEEK_KEY, currentWeek);
    localStorage.setItem(LOCAL_WEEKLY_COUNTS_KEY, JSON.stringify({}));
  }

  try {
    const totalRaw = localStorage.getItem(LOCAL_TOTAL_COUNTS_KEY);
    const weeklyRaw = localStorage.getItem(LOCAL_WEEKLY_COUNTS_KEY);
    return {
      weekKey: currentWeek,
      totalCounts: normalizeCounts(totalRaw ? (JSON.parse(totalRaw) as Record<string, number>) : {}),
      weeklyCounts: normalizeCounts(weeklyRaw ? (JSON.parse(weeklyRaw) as Record<string, number>) : {}),
    };
  } catch {
    return {
      weekKey: currentWeek,
      totalCounts: {},
      weeklyCounts: {},
    };
  }
}

function readDeviceWindow(serial: string): DeviceDownloadWindow {
  const now = new Date();
  const hourKey = currentHourKey(now);
  const dayKey = currentDayKey(now);
  try {
    const raw = localStorage.getItem(deviceWindowStorageKey(serial));
    if (!raw) {
      return { hourKey, dayKey, hourCount: 0, dayCount: 0 };
    }
    const parsed = JSON.parse(raw) as DeviceDownloadWindow;
    return {
      hourKey: parsed.hourKey === hourKey ? hourKey : hourKey,
      dayKey: parsed.dayKey === dayKey ? dayKey : dayKey,
      hourCount: parsed.hourKey === hourKey ? Math.max(0, Number(parsed.hourCount) || 0) : 0,
      dayCount: parsed.dayKey === dayKey ? Math.max(0, Number(parsed.dayCount) || 0) : 0,
    };
  } catch {
    return { hourKey, dayKey, hourCount: 0, dayCount: 0 };
  }
}

function writeDeviceWindow(serial: string, window: DeviceDownloadWindow): void {
  localStorage.setItem(deviceWindowStorageKey(serial), JSON.stringify(window));
}

function getDeviceDownloadLimitMessage(window: DeviceDownloadWindow): string | null {
  if (window.hourCount >= MAX_DOWNLOADS_PER_HOUR) {
    return `每小时最多下载${MAX_DOWNLOADS_PER_HOUR}次，请稍后再试`;
  }
  if (window.dayCount >= MAX_DOWNLOADS_PER_DAY) {
    return `每天最多下载${MAX_DOWNLOADS_PER_DAY}次，请明天再试`;
  }
  return null;
}

export function recordLocalDeviceDownload(serial: string, resourceId: number): DownloadStatsSnapshot {
  const stats = readLocalDownloadStats();
  const window = readDeviceWindow(serial);
  const limitMessage = getDeviceDownloadLimitMessage(window);
  if (limitMessage) {
    throw new Error(limitMessage);
  }

  window.hourCount += 1;
  window.dayCount += 1;
  writeDeviceWindow(serial, window);
  stats.totalCounts[resourceId] = (stats.totalCounts[resourceId] || 0) + 1;
  stats.weeklyCounts[resourceId] = (stats.weeklyCounts[resourceId] || 0) + 1;
  writeLocalDownloadStats(stats);

  return {
    weekKey: stats.weekKey,
    totalCount: stats.totalCounts[resourceId] || 0,
    weeklyCount: stats.weeklyCounts[resourceId] || 0,
    hourlyCount: window.hourCount,
    dailyCount: window.dayCount,
  };
}

function writeLocalDownloadStats(stats: ResourceDownloadStats): void {
  const totalPayload: Record<string, number> = {};
  const weeklyPayload: Record<string, number> = {};
  for (const [id, count] of Object.entries(stats.totalCounts)) {
    totalPayload[id] = count;
  }
  for (const [id, count] of Object.entries(stats.weeklyCounts)) {
    weeklyPayload[id] = count;
  }
  localStorage.setItem(LOCAL_WEEK_KEY, stats.weekKey);
  localStorage.setItem(LOCAL_TOTAL_COUNTS_KEY, JSON.stringify(totalPayload));
  localStorage.setItem(LOCAL_WEEKLY_COUNTS_KEY, JSON.stringify(weeklyPayload));
}

export async function fetchResourceDownloads(): Promise<ResourceDownloadStats> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    return readLocalDownloadStats();
  }

  const payload = await apiFetch<DownloadStatsResponse>("/api/resource-downloads", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${getAuthState()?.token || ""}`,
    },
  });

  return {
    weekKey: payload.weekKey || currentWeekKey(),
    totalCounts: normalizeCounts(payload.totalCounts),
    weeklyCounts: normalizeCounts(payload.weeklyCounts),
  };
}
