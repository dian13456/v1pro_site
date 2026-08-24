export interface TransferTaskState {
  id: number;
  label: string;
  message: string;
  progress: number;
  status: "active" | "success" | "error";
  startedAt: number;
}

let currentTask: TransferTaskState | null = null;
let nextId = 1;
let dismissTimer: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function clearTimer(): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
}

export function subscribeTransferTask(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTransferTaskSnapshot(): TransferTaskState | null {
  return currentTask;
}

export function beginTransferTask(label: string, message = "正在准备素材…"): void {
  clearTimer();
  currentTask = {
    id: nextId++,
    label,
    message,
    progress: 0,
    status: "active",
    startedAt: Date.now(),
  };
  emit();
}

export function updateTransferTask(update: { message?: string; progress?: number }): void {
  if (!currentTask || currentTask.status !== "active") return;
  currentTask = {
    ...currentTask,
    ...(update.message ? { message: update.message } : {}),
    progress: update.progress == null
      ? currentTask.progress
      : Math.max(currentTask.progress, Math.min(100, Math.max(0, update.progress))),
  };
  emit();
}

export function completeTransferTask(message: string): void {
  if (!currentTask) return;
  currentTask = { ...currentTask, message, progress: 100, status: "success" };
  emit();
  clearTimer();
  dismissTimer = window.setTimeout(dismissTransferTask, 9000);
}

export function failTransferTask(message: string): void {
  if (!currentTask) return;
  currentTask = { ...currentTask, message, status: "error" };
  emit();
  clearTimer();
  dismissTimer = window.setTimeout(dismissTransferTask, 12000);
}

export function dismissTransferTask(): void {
  clearTimer();
  currentTask = null;
  emit();
}
