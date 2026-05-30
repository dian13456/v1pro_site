interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="rounded-2xl border border-white/20 bg-white/60 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/50">
      <label className="flex items-center gap-3">
        <span className="text-sm text-slate-500 dark:text-slate-300">搜索</span>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="输入标题或简介进行筛选..."
          className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
      </label>
    </div>
  );
}
