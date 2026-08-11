import { useEffect, useState } from "react";
import type { ResourceItem } from "../types/resource";
import { createImageUrl } from "../services/imageService";
import {
  formatMediaDuration,
  resourceMetricsFromCatalog,
  smallestCompatibleCapacity,
} from "../utils/resourceCapacity";

const PREVIEW_BACKGROUNDS = [
  "from-cyan-200 to-sky-300",
  "from-lime-200 to-emerald-200",
  "from-orange-200 to-rose-300",
  "from-fuchsia-200 to-violet-200",
  "from-indigo-200 to-blue-300",
];

function materialLabel(resource: ResourceItem): string {
  if (resource.materialType === "video") return "视频";
  if (resource.materialType === "gif") return "GIF";
  return "图片";
}

export function CompactResourceCard({
  resource,
  downloadCount,
  onOpen,
}: {
  resource: ResourceItem;
  downloadCount: number;
  onOpen: (resource: ResourceItem) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const metrics = resourceMetricsFromCatalog(resource);
  const capacity = smallestCompatibleCapacity(resource, metrics, 25);
  const duration = formatMediaDuration(metrics.durationSec);

  useEffect(() => {
    let active = true;
    void createImageUrl(resource.id, resource.image || resource.download)
      .then((result) => {
        if (active) setPreviewUrl(result.url || "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [resource.download, resource.id, resource.image]);

  return (
    <button
      type="button"
      onClick={() => onOpen(resource)}
      className="group overflow-hidden rounded-[14px] border border-[#e6e9f2] bg-white text-left transition duration-150 hover:-translate-y-1 hover:shadow-[0_10px_24px_rgba(43,50,69,.10)]"
    >
      <div className={`relative aspect-square overflow-hidden bg-gradient-to-br ${PREVIEW_BACKGROUNDS[resource.id % PREVIEW_BACKGROUNDS.length]}`}>
        {previewUrl ? (
          <img src={previewUrl} alt={resource.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-5xl opacity-80">
            {resource.materialType === "video" ? "🎬" : resource.materialType === "gif" ? "🔁" : "🖼️"}
          </div>
        )}
        <span className={`absolute left-2.5 top-2.5 rounded-[10px] px-[9px] py-[3px] text-[10.5px] font-bold tracking-wide text-white ${resource.materialType === "image" ? "bg-violet-500/90" : resource.materialType === "gif" ? "bg-[#ff8a5c]/95" : "bg-[#3ecf8e]/95"}`}>
          {materialLabel(resource)}
        </span>
        {duration || capacity ? (
          <span className="absolute bottom-2.5 right-2.5 rounded-[9px] bg-black/45 px-2 py-0.5 text-[10.5px] text-white">
            {duration ? `◷ ${duration}` : ""}{duration && capacity ? " · " : ""}{capacity ? `${capacity}帧` : ""}
          </span>
        ) : null}
      </div>
      <div className="px-[13px] pb-[13px] pt-[11px]">
        <h3 className="truncate text-[13.5px] font-semibold text-[#2b3245]">{resource.title || resource.description}</h3>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-[#8a93a8]">
          <span className="max-w-[70%] truncate rounded-lg bg-[#eef1fb] px-2 py-0.5 text-[#5b6390]">{resource.columnTag || resource.author || "其他"}</span>
          <span>⬇ {downloadCount}</span>
        </div>
      </div>
    </button>
  );
}
