import type { ResourceItem } from "../types/resource";
import {
  albumRequiredFrames,
  albumTransitionExtraFrames,
  type AlbumTransition,
} from "../services/v1proWebResourceTransferService";
import {
  DEVICE_FRAME_CAPACITIES,
  requiredFramesForResource,
  resourceMetricsFromCatalog,
  type DeviceFrameCapacity,
} from "../utils/resourceCapacity";
import { useDeviceFeatureAccess } from "../services/featureAccessService";

const ALBUM_PREVIEW_FPS = 25;

function albumFrames(resource: ResourceItem): number | null {
  return requiredFramesForResource(
    resource,
    resourceMetricsFromCatalog(resource),
    ALBUM_PREVIEW_FPS,
  );
}

function materialLabel(resource: ResourceItem): string {
  if (resource.materialType === "video") return "视频";
  if (resource.materialType === "gif") return "GIF";
  return "图片";
}

export function AlbumSelectionPanel({
  resources,
  capacity,
  onCapacityChange,
  onRemove,
  onClear,
  onClose,
  switchDelayMs,
  onSwitchDelayChange,
  transition,
  onTransitionChange,
  onTransfer,
  transferring,
  transferProgress,
  transferStatus,
  className = "",
}: {
  resources: ResourceItem[];
  capacity: DeviceFrameCapacity;
  onCapacityChange: (capacity: DeviceFrameCapacity) => void;
  onRemove: (resourceId: number) => void;
  onClear: () => void;
  onClose: () => void;
  switchDelayMs: number;
  onSwitchDelayChange: (delayMs: number) => void;
  transition: AlbumTransition;
  onTransitionChange: (transition: AlbumTransition) => void;
  onTransfer: () => void;
  transferring: boolean;
  transferProgress: number | null;
  transferStatus: string;
  className?: string;
}) {
  const { access } = useDeviceFeatureAccess();
  const featureEnabled = access?.enabled === true;
  const entries = resources.map((resource) => ({
    resource,
    frames: albumFrames(resource),
  }));
  const materialFrames = resources.length;
  const transitionFrames = albumTransitionExtraFrames(resources.length, transition);
  const knownFrames = albumRequiredFrames(resources.length, switchDelayMs, transition);
  const unknownCount = entries.filter((entry) => entry.frames == null).length;
  const percent = capacity > 0 ? (knownFrames / capacity) * 100 : 0;
  const overflowFrames = Math.max(0, knownFrames - capacity);
  const progressWidth = Math.min(100, Math.max(0, percent));

  return (
    <aside className={`overflow-hidden rounded-2xl border border-[#e7eaf3] bg-white shadow-[0_18px_45px_rgba(43,50,69,.10)] dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      <div className="flex items-center justify-between border-b border-[#edf0f6] px-4 py-3.5 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-bold text-[#2b3245] dark:text-white">相册清单</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">已选择 {resources.length} 个素材</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={transferring}
          aria-label="退出相册模式"
          className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-lg leading-none text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
        >
          ×
        </button>
      </div>

      <div className="p-4">
        <div className="mb-2 text-[11px] font-semibold text-slate-500 dark:text-slate-300">目标设备容量</div>
        <div className="grid grid-cols-3 gap-1.5">
          {DEVICE_FRAME_CAPACITIES.map((frames) => (
            <button
              key={frames}
              type="button"
              onClick={() => onCapacityChange(frames)}
              disabled={transferring}
              className={`rounded-lg border px-1 py-2 text-xs font-semibold transition ${
                capacity === frames
                  ? "border-[#ff8a5c] bg-[#fff2ec] text-[#ff7448] dark:bg-orange-500/15"
                  : "border-slate-200 bg-slate-50 text-slate-500 hover:border-orange-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {frames} 帧
            </button>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block text-[11px] font-semibold text-slate-500 dark:text-slate-300">图片切换延时</span>
          <select
            value={switchDelayMs}
            disabled={transferring}
            onChange={(event) => onSwitchDelayChange(Number(event.target.value))}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-[#2b3245] outline-none transition focus:border-[#ff8a5c] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value={500}>0.5 秒</option>
            <option value={1000}>1 秒</option>
            <option value={2000}>2 秒</option>
            <option value={3000}>3 秒</option>
            <option value={5000}>5 秒</option>
            <option value={10000}>10 秒</option>
          </select>
          <span className="mt-1.5 block text-[10px] leading-relaxed text-slate-400">每张图片在设备上的停留时间。</span>
        </label>

        <label className="mt-3 block">
          <span className="mb-2 block text-[11px] font-semibold text-slate-500 dark:text-slate-300">切换动画</span>
          <select
            value={transition}
            disabled={transferring}
            onChange={(event) => onTransitionChange(event.target.value as AlbumTransition)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-[#2b3245] outline-none transition focus:border-[#ff8a5c] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="none">无动画</option>
            <option value="fade">淡入淡出</option>
            <option value="slide-left">向左滑动</option>
          </select>
          {transitionFrames > 0 ? (
            <span className="mt-1.5 block text-[10px] text-slate-400">动画占用 {transitionFrames} 帧，已计入容量。</span>
          ) : null}
        </label>

        <div className="mt-4 rounded-xl bg-[#f7f8fc] p-3 dark:bg-slate-800/80">
          <div className="flex items-end justify-between gap-2">
            <div>
              <span className={`text-xl font-bold ${overflowFrames > 0 ? "text-rose-500" : "text-[#2b3245] dark:text-white"}`}>{knownFrames}</span>
              <span className="text-xs text-slate-400"> / {capacity} 帧</span>
            </div>
            <span className={`text-sm font-bold ${overflowFrames > 0 ? "text-rose-500" : "text-[#ff7448]"}`}>{percent.toFixed(percent >= 10 ? 0 : 1)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div
              className={`h-full rounded-full transition-all duration-300 ${overflowFrames > 0 ? "bg-rose-500" : percent >= 85 ? "bg-amber-400" : "bg-gradient-to-r from-[#ff9a68] to-[#ff6f9c]"}`}
              style={{ width: `${progressWidth}%` }}
            />
          </div>
          {overflowFrames > 0 ? (
            <p className="mt-2 text-[11px] leading-relaxed text-rose-500">已超出 {overflowFrames} 帧，请移除素材或选择更大容量。</p>
          ) : (
            <p className="mt-2 text-[11px] text-slate-400">剩余 {capacity - knownFrames} 帧 · 图片停留占用 {materialFrames} 帧</p>
          )}
          {unknownCount > 0 ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">有 {unknownCount} 个素材缺少帧数，暂未计入容量。</p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">已选素材</span>
          {resources.length > 0 ? (
            <button type="button" disabled={transferring} onClick={onClear} className="text-[11px] font-semibold text-rose-400 transition hover:text-rose-500 disabled:opacity-40">清空</button>
          ) : null}
        </div>

        <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {entries.map(({ resource, frames }, index) => (
            <div key={resource.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#fff2ec] text-[11px] font-bold text-[#ff7448] dark:bg-orange-500/15">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[#2b3245] dark:text-white">{resource.title || resource.description}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">{materialLabel(resource)} · {frames == null ? "待计算" : `${frames} 帧`}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(resource.id)}
                disabled={transferring}
                aria-label={`移除 ${resource.title || resource.description}`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
              >
                ×
              </button>
            </div>
          ))}
          {resources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-xs leading-relaxed text-slate-400 dark:border-slate-700">
              点击左侧素材卡片<br />添加到相册清单
            </div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={resources.length === 0 || overflowFrames > 0 || transferring || !featureEnabled}
          title={featureEnabled ? "选择设备并传输" : "请先到个人中心输入激活码"}
          onClick={onTransfer}
          className="mt-4 w-full rounded-xl bg-[#32b879] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(50,184,121,.25)] transition hover:bg-[#299f69] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {transferring
            ? `正在传输${transferProgress == null ? "…" : ` ${Math.round(transferProgress)}%`}`
            : featureEnabled ? `选择并传输 · ${resources.length} 个素材` : "未激活"}
        </button>
        {transferring && transferProgress != null ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-[#32b879] transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, transferProgress))}%` }} />
          </div>
        ) : null}
        {transferStatus ? (
          <p className={`mt-2 text-[11px] leading-relaxed ${transferProgress === 100 ? "text-[#299f69]" : "text-slate-400"}`}>{transferStatus}</p>
        ) : null}
      </div>
    </aside>
  );
}
