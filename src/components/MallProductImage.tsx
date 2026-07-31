import { useState } from "react";

interface MallProductImageProps {
  imageUrl?: string;
  title: string;
  className?: string;
}

export function MallProductImage({ imageUrl, title, className = "h-40 w-full" }: MallProductImageProps) {
  const [failed, setFailed] = useState(false);
  const src = (imageUrl || "").trim();

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-dashed border-white/30 bg-white/40 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-400 ${className}`}
      >
        暂无商品图
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      className={`rounded-xl object-cover ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
