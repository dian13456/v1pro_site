import { CATEGORY_OPTIONS } from "../data/categories";
import type { ResourceCategory } from "../types/resource";

interface CategoryTabsProps {
  value: ResourceCategory;
  onChange: (value: ResourceCategory) => void;
}

export function CategoryTabs({ value, onChange }: CategoryTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORY_OPTIONS.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`rounded-full px-4 py-2 text-sm transition ${
              active
                ? "bg-slate-900 text-white shadow-[0_12px_26px_-16px_rgba(0,0,0,0.8)] dark:bg-white dark:text-slate-900"
                : "border border-white/25 bg-white/50 text-slate-700 backdrop-blur dark:border-white/15 dark:bg-slate-900/45 dark:text-slate-200"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
