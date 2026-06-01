export interface DownloadStatsSnapshot {
  weekKey?: string;
  totalCount: number;
  weeklyCount: number;
  hourlyCount?: number;
  dailyCount?: number;
}

export function parseDownloadStats(payload: unknown): DownloadStatsSnapshot | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const stats = (root.downloadStats as Record<string, unknown> | undefined) || root;
  const totalCount = Number(stats.totalCount);
  const weeklyCount = Number(stats.weeklyCount);
  if (!Number.isFinite(totalCount) && !Number.isFinite(weeklyCount)) {
    return null;
  }
  return {
    weekKey: typeof stats.weekKey === "string" ? stats.weekKey : undefined,
    totalCount: Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0,
    weeklyCount: Number.isFinite(weeklyCount) ? Math.max(0, Math.floor(weeklyCount)) : 0,
    hourlyCount:
      stats.hourlyCount !== undefined && Number.isFinite(Number(stats.hourlyCount))
        ? Math.max(0, Math.floor(Number(stats.hourlyCount)))
        : undefined,
    dailyCount:
      stats.dailyCount !== undefined && Number.isFinite(Number(stats.dailyCount))
        ? Math.max(0, Math.floor(Number(stats.dailyCount)))
        : undefined,
  };
}

export interface SignedDownloadResult {
  url: string;
  stats?: DownloadStatsSnapshot | null;
}
