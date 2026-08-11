import type { MaterialTypeFilter, ResourceItem } from "../types/resource";
import type { ResourceSortMode } from "../hooks/useResourceCatalog";
import type { DeviceFrameCapacity } from "../utils/resourceCapacity";

interface FilterOption<T extends string | number> {
  value: T;
  label: string;
  count?: number;
  note?: string;
  icon?: string;
}

function FilterGroup<T extends string | number>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <h2 className="px-5 pb-2 pt-4 text-xs font-semibold tracking-wide text-slate-400">{title}</h2>
      <div className="pb-3">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              className={`relative flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition ${
                active
                  ? "bg-orange-50 font-semibold text-orange-500 dark:bg-orange-500/10"
                  : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              {active ? <span className="absolute inset-y-0 left-0 w-0.5 bg-gradient-to-b from-orange-400 to-violet-500" /> : null}
              <span className="w-4 text-center">{option.icon || "◇"}</span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.note ? <span className="text-[11px] font-normal text-slate-400">{option.note}</span> : null}
              {option.count != null ? <span className="text-xs font-normal text-slate-400">{option.count}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface ResourceLibrarySidebarProps {
  resources: ResourceItem[];
  materialType: MaterialTypeFilter;
  onMaterialType: (value: MaterialTypeFilter) => void;
  capacity: "all" | DeviceFrameCapacity;
  onCapacity: (value: "all" | DeviceFrameCapacity) => void;
  sortMode: ResourceSortMode | "random";
  onSortMode: (value: ResourceSortMode | "random") => void;
  columnTag: string;
  onColumnTag: (value: string) => void;
  columnOptions: Array<{ value: string; label: string }>;
}

export function ResourceLibrarySidebar(props: ResourceLibrarySidebarProps) {
  const count = (type: ResourceItem["materialType"]) => props.resources.filter((item) => item.materialType === type).length;
  return (
    <aside className="space-y-4">
      <FilterGroup
        title="素材类型"
        value={props.materialType}
        onChange={props.onMaterialType}
        options={[
          { value: "all", label: "全部类型", count: props.resources.length, icon: "▰" },
          { value: "image", label: "图片素材", count: count("image"), icon: "▧" },
          { value: "gif", label: "GIF 素材", count: count("gif"), icon: "◇" },
          { value: "video", label: "视频素材", count: count("video"), icon: "▣" },
        ]}
      />
      <FilterGroup
        title="设备容量"
        value={props.capacity}
        onChange={props.onCapacity}
        options={[
          { value: "all", label: "全部容量", note: "任意设备", icon: "⬡" },
          { value: 77, label: "77 帧设备", note: "≈3.1s · 25fps", icon: "◇" },
          { value: 154, label: "154 帧设备", note: "≈6.2s · 25fps", icon: "◇" },
          { value: 308, label: "308 帧设备", note: "≈12.3s · 25fps", icon: "◇" },
        ]}
      />
      <FilterGroup
        title="特色栏目"
        value={props.sortMode}
        onChange={props.onSortMode}
        options={[
          { value: "hot", label: "热门排行", icon: "🔥" },
          { value: "random", label: "随机推荐", icon: "🎲" },
          { value: "weeklyTop", label: "周下载 TOP20", icon: "🏆" },
          { value: "latest", label: "最新上传", icon: "✦" },
        ]}
      />
      <FilterGroup
        title="专栏"
        value={props.columnTag}
        onChange={props.onColumnTag}
        options={props.columnOptions.map((option, index) => ({
          ...option,
          icon: index === 0 ? "▰" : ["🐱", "🐥", "🧚", "🎸", "🐉"][index % 5],
        }))}
      />
    </aside>
  );
}
