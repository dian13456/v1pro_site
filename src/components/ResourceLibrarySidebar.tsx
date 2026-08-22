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
    <section className="overflow-hidden rounded-[14px] border border-[#e6e9f2] bg-white dark:border-slate-800 dark:bg-slate-900">
      <h2 className="px-[18px] pb-2.5 pt-[18px] text-xs font-normal tracking-[1px] text-[#8a93a8] dark:text-slate-400">{title}</h2>
      <div className="pb-3.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              className={`relative flex w-full items-center gap-[9px] px-[18px] py-2 text-left text-[13.5px] transition ${
                active
                  ? "font-bold text-[#ff8a5c]"
                  : "text-[#4a5270] hover:bg-[#f6f7fd] hover:text-[#ff8a5c] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-[#ff9b78]"
              }`}
            >
              {active ? <span className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-gradient-to-b from-[#ff8a5c] to-[#7c6cf0]" /> : null}
              <span className="w-5 text-center text-[15px]">{option.icon || "◇"}</span>
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.note ? <span className="text-[11px] font-normal text-[#c2c8da] dark:text-slate-500">{option.note}</span> : null}
              {option.count != null ? <span className="text-[11px] font-normal text-[#c2c8da] dark:text-slate-500">{option.count}</span> : null}
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
  sortMode: ResourceSortMode | "random" | "following";
  onSortMode: (value: ResourceSortMode | "random" | "following") => void;
  followedUploaderCount?: number;
  showSortOptions?: boolean;
  columnTag: string;
  onColumnTag: (value: string) => void;
  columnOptions: Array<{ value: string; label: string }>;
}

export function ResourceLibrarySidebar(props: ResourceLibrarySidebarProps) {
  const count = (type: ResourceItem["materialType"]) => props.resources.filter((item) => item.materialType === type).length;
  return (
    <aside className="space-y-[14px]">
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
      {props.showSortOptions !== false ? (
        <FilterGroup
          title="特色栏目"
          value={props.sortMode}
          onChange={props.onSortMode}
          options={[
            { value: "following", label: "关注上传", count: props.followedUploaderCount || undefined, icon: "🔔" },
            { value: "hot", label: "热门排行", icon: "🔥" },
            { value: "random", label: "随机推荐", icon: "🎲" },
            { value: "weeklyTop", label: "周下载 TOP20", icon: "🏆" },
            { value: "latest", label: "最新上传", icon: "✦" },
          ]}
        />
      ) : null}
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
