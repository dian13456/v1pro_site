import { useRef, useState, type DragEvent } from "react";

const FILE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif";

export function isWebUsbImageFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png" || type === "image/jpeg" || type === "image/webp" || type === "image/gif") {
    return true;
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function pickImageFile(list: FileList | null | undefined): File | null {
  if (!list || list.length === 0) return null;
  for (let i = 0; i < list.length; i += 1) {
    const file = list.item(i);
    if (file && isWebUsbImageFile(file)) {
      return file;
    }
  }
  return null;
}

interface WebUsbDropZoneProps {
  disabled?: boolean;
  busy?: boolean;
  connected?: boolean;
  selectedFileName?: string | null;
  onFile: (file: File) => void;
  onInvalidFile?: () => void;
}

export function WebUsbDropZone({
  disabled = false,
  busy = false,
  connected = false,
  selectedFileName,
  onFile,
  onInvalidFile,
}: WebUsbDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const inactive = disabled || busy;
  const hint = connected
    ? "松开鼠标即可开始编码并传输"
    : "请先连接设备；拖入后将尝试连接并传输";

  const handleFile = (file: File | null) => {
    if (!file) {
      onInvalidFile?.();
      return;
    }
    onFile(file);
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (inactive) return;
    setDragActive(true);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (inactive) return;
    event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (inactive) return;
    handleFile(pickImageFile(event.dataTransfer.files));
  };

  const zoneClass = [
    "mt-4 flex min-h-[168px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 py-8 text-center transition",
    inactive ? "cursor-not-allowed opacity-55" : "hover:border-violet-400/80 hover:bg-violet-50/40 dark:hover:bg-violet-500/5",
    dragActive && !inactive
      ? "border-violet-500 bg-violet-50/70 dark:border-violet-400 dark:bg-violet-500/10"
      : "border-white/40 bg-white/35 dark:border-white/15 dark:bg-slate-950/30",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={zoneClass}
      role="button"
      tabIndex={inactive ? -1 : 0}
      aria-disabled={inactive}
      onClick={() => {
        if (!inactive) inputRef.current?.click();
      }}
      onKeyDown={(event) => {
        if (inactive) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="text-3xl leading-none text-violet-500/80" aria-hidden="true">
        ↓
      </div>
      <p className="mt-3 text-sm font-medium text-slate-800 dark:text-slate-100">
        {dragActive ? "松开即可上传" : "拖拽图片 / GIF 到此处"}
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{hint}</p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">支持 PNG、JPG、WebP、GIF · 点击也可选择文件</p>
      {selectedFileName ? (
        <p className="mt-3 max-w-full truncate text-xs font-medium text-violet-700 dark:text-violet-200">
          当前：{selectedFileName}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={FILE_ACCEPT}
        disabled={inactive}
        onChange={(event) => {
          handleFile(pickImageFile(event.target.files));
          event.target.value = "";
        }}
      />
    </div>
  );
}
