import { useRef, useState, type DragEvent } from "react";

const FILE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.m4v";

export function isWebUsbImageFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png" || type === "image/jpeg" || type === "image/webp" || type === "image/gif") {
    return true;
  }
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export function isWebUsbVideoFile(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("video/")) {
    return true;
  }
  return /\.(mp4|webm|mov|m4v)$/i.test(file.name);
}

export function isWebUsbTransferFile(file: File): boolean {
  return isWebUsbImageFile(file) || isWebUsbVideoFile(file);
}

function pickTransferFile(list: FileList | null | undefined): File | null {
  if (!list || list.length === 0) return null;
  for (let i = 0; i < list.length; i += 1) {
    const file = list.item(i);
    if (file && isWebUsbTransferFile(file)) {
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
    handleFile(pickTransferFile(event.dataTransfer.files));
  };

  const zoneClass = [
    "mt-5 flex min-h-[238px] cursor-pointer flex-col items-center justify-center rounded-[16px] border-2 border-dashed px-5 py-8 text-center transition",
    inactive ? "cursor-not-allowed opacity-55" : "hover:border-[#ff9b75] hover:bg-[#fffaf7]",
    dragActive && !inactive
      ? "border-[#ff8a5c] bg-[#fff7f2]"
      : "border-[#dfe3ed] bg-[#fafbfe]",
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
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-2xl font-bold leading-none text-white shadow-[0_6px_16px_rgba(124,108,240,.2)]" aria-hidden="true">
        ↓
      </div>
      <p className="mt-4 text-[14px] font-extrabold text-[#2b3245]">
        {dragActive ? "松开即可上传" : "拖拽图片 / GIF / 视频到此处"}
      </p>
      <p className="mt-1 text-xs text-[#6f7890]">{hint}</p>
      <p className="mt-2 max-w-md text-[11px] leading-5 text-[#8a93a8]">
        支持 PNG、JPG、WebP、GIF、MP4（H.264）；视频按设备容量自适应，最高 30fps、5 倍速
      </p>
      {selectedFileName ? (
        <p className="mt-3 max-w-full truncate rounded-full bg-[#f0edff] px-3 py-1 text-xs font-semibold text-[#7c6cf0]">
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
          handleFile(pickTransferFile(event.target.files));
          event.target.value = "";
        }}
      />
    </div>
  );
}
