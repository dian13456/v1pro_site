import { useI18n } from "../i18n";
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
  const { t } = useI18n();
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
          <h2 className="text-sm font-bold text-[#2b3245] dark:text-white">{t("相册清单", "Album list")}</h2>
          <p className="mt-0.5 text-[11px] text-slate-400">{t("已选择 {count} 个素材", "{count} items selected", { count: resources.length })}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={transferring}
          aria-label={t("退出相册模式", "Exit album mode")}
          className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-lg leading-none text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
        >
          ×
        </button>
      </div>

      <div className="p-4">
        <div className="mb-2 text-[11px] font-semibold text-slate-500 dark:text-slate-300">{t("目标设备容量", "Target device capacity")}</div>
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
              {frames} {t("帧", "frames")}</button>
          ))}
        </div>

        <label className="mt-4 block">
          <span className="mb-2 block text-[11px] font-semibold text-slate-500 dark:text-slate-300">{t("图片切换延时", "Image duration")}</span>
          <select
            value={switchDelayMs}
            disabled={transferring}
            onChange={(event) => onSwitchDelayChange(Number(event.target.value))}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-[#2b3245] outline-none transition focus:border-[#ff8a5c] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value={500}>{t("0.5 秒", "0.5 s")}</option>
            <option value={1000}>{t("1 秒", "1 s")}</option>
            <option value={2000}>{t("2 秒", "2 s")}</option>
            <option value={3000}>{t("3 秒", "3 s")}</option>
            <option value={5000}>{t("5 秒", "5 s")}</option>
            <option value={10000}>{t("10 秒", "10 s")}</option>
          </select>
          <span className="mt-1.5 block text-[10px] leading-relaxed text-slate-400">{t("每张图片在设备上的停留时间。", "How long each image stays on the device screen.")}</span>
        </label>

        <label className="mt-3 block">
          <span className="mb-2 block text-[11px] font-semibold text-slate-500 dark:text-slate-300">{t("切换动画", "Transition")}</span>
          <select
            value={transition}
            disabled={transferring}
            onChange={(event) => onTransitionChange(event.target.value as AlbumTransition)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-[#2b3245] outline-none transition focus:border-[#ff8a5c] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            <option value="none">{t("无动画", "None")}</option>
            <option value="fade">{t("淡入淡出", "Fade")}</option>
            <option value="slide-left">{t("向左滑动", "Slide left")}</option>
          </select>
          {transitionFrames > 0 ? (
            <span className="mt-1.5 block text-[10px] text-slate-400">{t("动画占用 {frames} 帧，已计入容量。", "Transitions use {frames} frames, included in capacity.", { frames: transitionFrames })}</span>
          ) : null}
        </label>

        <div className="mt-4 rounded-xl bg-[#f7f8fc] p-3 dark:bg-slate-800/80">
          <div className="flex items-end justify-between gap-2">
            <div>
              <span className={`text-xl font-bold ${overflowFrames > 0 ? "text-rose-500" : "text-[#2b3245] dark:text-white"}`}>{knownFrames}</span>
              <span className="text-xs text-slate-400"> / {capacity} {t("帧", "frames")}</span>
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
            <p className="mt-2 text-[11px] leading-relaxed text-rose-500">{t("已超出 {frames} 帧，请移除素材或选择更大容量。", "Over capacity by {frames} frames. Remove media or select a larger capacity.", { frames: overflowFrames })}</p>
          ) : (
            <p className="mt-2 text-[11px] text-slate-400">{t("剩余 {remaining} 帧 · 图片停留占用 {images} 帧", "{remaining} frames remaining · Image duration uses {images} frames", { remaining: capacity - knownFrames, images: materialFrames })}</p>
          )}
          {unknownCount > 0 ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">{t("有 {count} 个素材缺少帧数，暂未计入容量。", "{count} items have no frame count and are not included in the capacity total yet.", { count: unknownCount })}</p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">{t("已选素材", "Selected media")}</span>
          {resources.length > 0 ? (
            <button type="button" disabled={transferring} onClick={onClear} className="text-[11px] font-semibold text-rose-400 transition hover:text-rose-500 disabled:opacity-40">{t("清空", "Clear")}</button>
          ) : null}
        </div>

        <div className="mt-2 max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {entries.map(({ resource, frames }, index) => (
            <div key={resource.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white p-2 dark:border-slate-700 dark:bg-slate-800">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#fff2ec] text-[11px] font-bold text-[#ff7448] dark:bg-orange-500/15">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[#2b3245] dark:text-white">{resource.title || resource.description}</div>
                <div className="mt-0.5 text-[10px] text-slate-400">{t(materialLabel(resource))} · {t(frames == null ? "待计算" : `${frames} 帧`)}</div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(resource.id)}
                disabled={transferring}
                aria-label={t(`移除 ${resource.title || resource.description}`)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
              >
                ×
              </button>
            </div>
          ))}
          {resources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-xs leading-relaxed text-slate-400 dark:border-slate-700">
              {t("点击左侧素材卡片", "Click media cards on the left")}<br />{t("添加到相册清单", "to add them to the album")}</div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={resources.length === 0 || overflowFrames > 0 || transferring}
          title={t("选择设备并传输", "Choose a device and transfer")}
          onClick={onTransfer}
          className="mt-4 w-full rounded-xl bg-[#32b879] px-4 py-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(50,184,121,.25)] transition hover:bg-[#299f69] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {t(transferring
            ? `正在传输${transferProgress == null ? "…" : ` ${Math.round(transferProgress)}%`}`
            : `选择并传输 · ${resources.length} 个素材`)}
        </button>
        {transferring && transferProgress != null ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-full rounded-full bg-[#32b879] transition-[width] duration-200" style={{ width: `${Math.max(0, Math.min(100, transferProgress))}%` }} />
          </div>
        ) : null}
        {transferStatus ? (
          <p className={`mt-2 text-[11px] leading-relaxed ${transferProgress === 100 ? "text-[#299f69]" : "text-slate-400"}`}>{t(transferStatus)}</p>
        ) : null}
      </div>
    </aside>
  );
}
