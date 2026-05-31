import { FormEvent, useEffect, useState } from "react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onChange(draft.trim());
  };

  return (
    <div className="rounded-2xl border border-white/20 bg-white/60 px-4 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/50">
      <form className="flex items-center gap-3" onSubmit={handleSubmit}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="输入标题或简介进行筛选..."
          className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100"
        />
        <button
          type="submit"
          className="rounded-full bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
        >
          搜索
        </button>
      </form>
    </div>
  );
}
