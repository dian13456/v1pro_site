import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { LocalAlbumTransferItem } from "../services/localAlbumGfm1Service";

const FILE_ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.m4v";
const MAX_ALBUM_ITEMS = 64;

interface AlbumItem extends LocalAlbumTransferItem {
  id: string;
  previewUrl: string;
}

function isVideo(file: File): boolean {
  return file.type.toLowerCase().startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
}

function isGif(file: File): boolean {
  return file.type.toLowerCase() === "image/gif" || /\.gif$/i.test(file.name);
}

function isSupported(file: File): boolean {
  const type = file.type.toLowerCase();
  return type.startsWith("image/") || type.startsWith("video/") || /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/i.test(file.name);
}

function materialLabel(file: File): string {
  if (isVideo(file)) return "视频";
  if (isGif(file)) return "GIF";
  return "图片";
}

function newItemId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function WebUsbAlbumComposer({
  busy,
  canTransfer,
  capacityFrames,
  onTransfer,
  onNotice,
}: {
  busy: boolean;
  canTransfer: boolean;
  capacityFrames?: number | null;
  onTransfer: (items: LocalAlbumTransferItem[]) => Promise<void> | void;
  onNotice?: (message: string, error?: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [draggedId, setDraggedId] = useState("");

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId],
  );

  const addFiles = (files: Iterable<File>) => {
    if (busy) return;
    const incoming = Array.from(files);
    const supported = incoming.filter(isSupported);
    const available = Math.max(0, MAX_ALBUM_ITEMS - items.length);
    const accepted = supported.slice(0, available).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      return {
        id: newItemId(),
        file,
        previewUrl,
        holdMs: isVideo(file) || isGif(file) ? 500 : 3000,
      };
    });
    if (accepted.length) {
      setItems((current) => [...current, ...accepted]);
      setSelectedId((current) => current || accepted[0].id);
    }
    const rejected = incoming.length - accepted.length;
    onNotice?.(
      rejected > 0
        ? `已添加 ${accepted.length} 个素材，忽略 ${rejected} 个不支持或超出数量的文件。`
        : `已添加 ${accepted.length} 个素材，可拖动或使用箭头调整播放顺序。`,
      accepted.length === 0,
    );
  };

  const removeItem = (id: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current.delete(target.previewUrl);
      }
      const next = current.filter((item) => item.id !== id);
      setSelectedId((selected) => selected === id ? next[0]?.id || "" : selected);
      return next;
    });
  };

  const clearItems = () => {
    if (busy) return;
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      objectUrlsRef.current.delete(item.previewUrl);
    });
    setItems([]);
    setSelectedId("");
  };

  const moveItem = (id: string, delta: number) => {
    setItems((current) => {
      const from = current.findIndex((item) => item.id === id);
      const to = Math.max(0, Math.min(current.length - 1, from + delta));
      if (from < 0 || from === to) return current;
      const next = current.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const reorderBefore = (sourceId: string, targetId: string) => {
    setItems((current) => {
      const from = current.findIndex((item) => item.id === sourceId);
      let to = current.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0 || from === to) return current;
      const next = current.slice();
      const [item] = next.splice(from, 1);
      if (from < to) to -= 1;
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (!busy) addFiles(event.dataTransfer.files);
  };

  return (
    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
      <div className="min-w-0 rounded-[16px] border border-[#e2defe] bg-gradient-to-b from-[#fbfaff] to-[#f7f9ff] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-extrabold text-[#3f4660]">播放顺序</h3>
            <p className="mt-1 text-[11px] leading-5 text-[#8a93a8]">拖动素材排序，设备将按照清单循环播放。</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#f0edff] px-3 py-1.5 text-[11px] font-bold text-[#7c6cf0]">{items.length} 个素材</span>
            {items.length ? (
              <button type="button" disabled={busy} onClick={clearItems} className="rounded-full px-3 py-1.5 text-[11px] font-bold text-rose-400 transition hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40">清空</button>
            ) : null}
          </div>
        </div>

        <div
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          onClick={() => { if (!busy) inputRef.current?.click(); }}
          onKeyDown={(event) => {
            if (!busy && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragActive(true); }}
          onDragOver={(event) => { event.preventDefault(); if (!busy) { event.dataTransfer.dropEffect = "copy"; setDragActive(true); } }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
          }}
          onDrop={handleFileDrop}
          className={`mt-4 grid min-h-[118px] cursor-pointer place-items-center rounded-[14px] border-2 border-dashed px-4 py-5 text-center transition ${
            busy
              ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
              : dragActive
                ? "border-[#ff8a5c] bg-[#fff6f1]"
                : "border-[#d8d9ec] bg-white/75 hover:border-[#9d91ec] hover:bg-white"
          }`}
        >
          <div>
            <p className="text-[13px] font-extrabold text-[#4a5270]">{dragActive ? "松开即可加入相册" : "拖入图片、GIF 或视频，可一次选择多个"}</p>
            <p className="mt-1.5 text-[10.5px] leading-5 text-[#8a93a8]">PNG、JPG、WebP、GIF、MP4、WebM、MOV、M4V</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={FILE_ACCEPT}
            disabled={busy}
            className="hidden"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <div className="mt-3 max-h-[500px] space-y-2 overflow-y-auto pr-1">
          {items.map((item, index) => (
            <article
              key={item.id}
              draggable={!busy}
              onDragStart={(event) => {
                setDraggedId(item.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDraggedId("")}
              onDragOver={(event) => { if (draggedId) event.preventDefault(); }}
              onDrop={(event) => {
                if (!draggedId) return;
                event.preventDefault();
                event.stopPropagation();
                reorderBefore(draggedId, item.id);
                setDraggedId("");
              }}
              className={`grid grid-cols-[24px_76px_minmax(0,1fr)] items-center gap-2.5 rounded-[12px] border bg-white p-2.5 transition sm:grid-cols-[24px_88px_minmax(0,1fr)_auto] ${
                selectedItem?.id === item.id ? "border-[#b8aff5] shadow-sm" : "border-[#e8e9f1]"
              } ${draggedId === item.id ? "opacity-45" : ""}`}
            >
              <span className="cursor-grab select-none text-center text-base text-slate-300" title="拖动排序">⠿</span>
              <button type="button" onClick={() => setSelectedId(item.id)} className="overflow-hidden rounded-[8px] bg-black" aria-label={`预览 ${item.file.name}`}>
                {isVideo(item.file) ? (
                  <video src={item.previewUrl} muted playsInline preload="metadata" className="aspect-[16/9] w-full object-contain" />
                ) : (
                  <img src={item.previewUrl} alt="" className="aspect-[16/9] w-full object-contain" />
                )}
              </button>
              <div className="min-w-0">
                <p className="truncate text-[11.5px] font-bold text-[#3f4660]">{index + 1}. {item.file.name}</p>
                <p className="mt-1 text-[10px] text-[#9aa2b5]">{materialLabel(item.file)} · {isVideo(item.file) || isGif(item.file) ? "结束后停留" : "显示"}</p>
                <label className="mt-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-[#69728a]">
                  <input
                    type="number"
                    min="0.1"
                    max="65"
                    step="0.1"
                    disabled={busy}
                    value={(item.holdMs / 1000).toFixed(1)}
                    onChange={(event) => {
                      const holdMs = Math.round(Math.max(0.1, Math.min(65, Number(event.target.value) || 0.5)) * 1000);
                      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, holdMs } : entry));
                    }}
                    className="h-7 w-16 rounded-lg border border-[#dfe3ed] bg-[#fafbfe] px-2 outline-none focus:border-[#7c6cf0]"
                    aria-label={`${item.file.name} 停留秒数`}
                  /> 秒
                </label>
              </div>
              <div className="col-start-2 col-end-4 flex justify-end gap-1 sm:col-auto">
                <button type="button" disabled={busy || index === 0} onClick={() => moveItem(item.id, -1)} className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 text-xs text-slate-500 hover:border-[#7c6cf0] hover:text-[#7c6cf0] disabled:opacity-30" aria-label="上移">↑</button>
                <button type="button" disabled={busy || index === items.length - 1} onClick={() => moveItem(item.id, 1)} className="grid h-7 w-7 place-items-center rounded-full border border-slate-200 text-xs text-slate-500 hover:border-[#7c6cf0] hover:text-[#7c6cf0] disabled:opacity-30" aria-label="下移">↓</button>
                <button type="button" disabled={busy} onClick={() => removeItem(item.id)} className="grid h-7 w-7 place-items-center rounded-full border border-rose-100 text-xs text-rose-400 hover:bg-rose-50 disabled:opacity-30" aria-label="移除">×</button>
              </div>
            </article>
          ))}
          {!items.length ? (
            <div className="rounded-[12px] border border-dashed border-slate-200 bg-white/60 px-4 py-8 text-center text-[11px] text-slate-400">相册还是空的</div>
          ) : null}
        </div>
      </div>

      <aside className="min-w-0 rounded-[16px] border border-[#dfe7f2] bg-[#f8fbff] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-extrabold text-[#3f4660]">屏幕预览</h3>
            <p className="mt-1 text-[10.5px] text-[#8a93a8]">320 × 170 · 循环播放</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1.5 text-[10.5px] font-bold text-[#3974c8] shadow-sm">
            {capacityFrames ? `约 ${capacityFrames} 张画面` : "容量待读取"}
          </span>
        </div>
        <div className="mt-4 grid aspect-[320/170] place-items-center overflow-hidden rounded-[12px] border-4 border-[#2f3544] bg-black shadow-[0_10px_24px_rgba(43,50,69,.18)]">
          {selectedItem ? (
            isVideo(selectedItem.file) ? (
              <video key={selectedItem.id} src={selectedItem.previewUrl} controls muted playsInline preload="metadata" className="h-full w-full object-contain" />
            ) : (
              <img src={selectedItem.previewUrl} alt={`预览 ${selectedItem.file.name}`} className="h-full w-full object-contain" />
            )
          ) : (
            <span className="text-[11px] text-slate-500">添加素材后预览</span>
          )}
        </div>
        <p className="mt-3 truncate text-center text-[11px] font-semibold text-[#69728a]">
          {selectedItem ? `${items.indexOf(selectedItem) + 1} / ${items.length} · ${selectedItem.file.name}` : "0 / 0"}
        </p>
        <div className="mt-4 rounded-[12px] bg-white p-3 text-[10.5px] leading-5 text-[#7a849a] shadow-sm">
          视频采用兼容模式：320×170、20 FPS、仅取前 15 秒；空间不足时自动提高倍速。容量只按画面张数显示。
        </div>
        <button
          type="button"
          disabled={busy || !canTransfer || items.length === 0}
          onClick={() => void onTransfer(items.map(({ file, holdMs }) => ({ file, holdMs })))}
          className="mt-4 w-full rounded-[12px] bg-gradient-to-r from-[#32b879] to-[#22a8a2] px-4 py-3 text-[13px] font-extrabold text-white shadow-[0_8px_20px_rgba(50,184,121,.23)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? "正在转换并同步…" : `同步到设备 · ${items.length} 个素材`}
        </button>
        {!canTransfer ? <p className="mt-2 text-center text-[10.5px] text-amber-600">请先授权并选择 V1PRO 设备。</p> : null}
      </aside>
    </div>
  );
}
