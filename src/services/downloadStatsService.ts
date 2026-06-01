import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

interface DownloadStatsResponse {
  success?: boolean;
  weekKey?: string;
  totalCounts?: Record<string, number>;
  weeklyCounts?: Record<string, number>;
}

interface DownloadRecordResponse {
  success?: boolean;
  weekKey?: string;
  totalCount?: number;
  weeklyCount?: number;
}

export interface ResourceDownloadStats {
  weekKey: string;
  totalCounts: Record<number, number>;
  weeklyCounts: Record<number, number>;
}

const LOCAL_TOTAL_COUNTS_KEY = "jiadian_hub_download_total_counts";
const LOCAL_WEEKLY_COUNTS_KEY = "jiadian_hub_download_weekly_counts";
const LOCAL_WEEK_KEY = "jiadian_hub_download_week_key";

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

export async function recordResourceDownload(
  resourceId: number
): Promise<{ totalCount: number; weeklyCount: number; weekKey: string }> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    const stats = readLocalDownloadStats();
    stats.totalCounts[resourceId] = (stats.totalCounts[resourceId] || 0) + 1;
    stats.weeklyCounts[resourceId] = (stats.weeklyCounts[resourceId] || 0) + 1;
    writeLocalDownloadStats(stats);
    return {
      totalCount: stats.totalCounts[resourceId] || 0,
      weeklyCount: stats.weeklyCounts[resourceId] || 0,
      weekKey: stats.weekKey,
    };
  }

  const payload = await apiFetch<DownloadRecordResponse>("/api/resource-download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getAuthState()?.token || ""}`,
    },
    body: JSON.stringify({ resourceId: String(resourceId) }),
  });

  return {
    totalCount: Math.max(0, Number(payload.totalCount || 0)),
    weeklyCount: Math.max(0, Number(payload.weeklyCount || 0)),
    weekKey: payload.weekKey || currentWeekKey(),
  };
}
