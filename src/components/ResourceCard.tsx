import { memo } from "react";
import type { ResourceItem } from "../types/resource";

interface ResourceCardProps {
  resource: ResourceItem;
  onDownload: (resource: ResourceItem) => void;
  downloading: boolean;
}

function ResourceCardComponent({ resource, onDownload, downloading }: ResourceCardProps) {
  const materialLabel = resource.materialType === "image" ? "图片素材" : "V1PRO素材包";
  return (
    <article className="group rounded-3xl border border-white/25 bg-white/55 p-4 shadow-[0_30px_45px_-28px_rgba(0,0,0,0.55)] backdrop-blur-xl transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_32px_60px_-26px_rgba(34,211,238,0.45)] dark:border-white/10 dark:bg-slate-900/45">
      <div className="mb-3 inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs text-white dark:bg-white dark:text-slate-900">
        {materialLabel}
      </div>
      <div className="rounded-[1.4rem] bg-black p-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition duration-300 group-hover:shadow-[inset_0_0_0_1px_rgba(56,189,248,0.45),0_0_26px_-10px_rgba(56,189,248,0.8)]">
        <div className="overflow-hidden rounded-[1rem] bg-slate-900" style={{ aspectRatio: "320 / 170" }}>
          <img
            src={resource.image}
            alt={resource.title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          />
        </div>
      </div>

      <button
        type="button"
        disabled={downloading}
        onClick={() => onDownload(resource)}
        className="mt-4 w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
      >
        {downloading ? "生成下载链接..." : "下载素材"}
      </button>
    </article>
  );
}

export const ResourceCard = memo(ResourceCardComponent);
