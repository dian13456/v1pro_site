"""
图片人工复审 GUI — 连接后端 /api/admin/image-reviews 接口。

用法:
  python tools/image_review_gui.py

需在 backend/.env 中配置 REVIEW_ADMIN_TOKEN，并在下方填入相同 token。
"""

from __future__ import annotations

import io
import json
import threading
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

import tkinter as tk
from tkinter import messagebox, ttk

try:
    from PIL import Image, ImageTk
except Exception:  # pragma: no cover
    Image = None
    ImageTk = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "tools" / "image_review_gui_config.json"

ACTION_LABELS = {
    "share_ai": "AI 分享素材库",
    "share_user": "用户上传分享",
    "transfer": "传输到设备",
    "generate": "AI 生图",
}

STATUS_LABELS = {
    "pending": "待复核",
    "approved": "已通过",
    "rejected": "已拒绝",
}


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")


def format_time(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return "-"
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return raw


class ReviewApiClient:
    def __init__(self, api_base: str, admin_token: str) -> None:
        self.api_base = api_base.rstrip("/")
        self.admin_token = admin_token.strip()

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        url = f"{self.api_base}{path}"
        data = None
        headers = {
            "Accept": "application/json",
            "X-Review-Admin-Token": self.admin_token,
        }
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(detail)
                message = payload.get("message") or detail
            except json.JSONDecodeError:
                message = detail or f"HTTP {exc.code}"
            raise RuntimeError(message) from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"无法连接 API: {exc.reason}") from exc

        if not raw.strip():
            return {}
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise RuntimeError("接口返回格式异常")
        return payload

    def list_reviews(self, status: str = "pending") -> list[dict]:
        payload = self._request("GET", f"/api/admin/image-reviews?status={status}")
        items = payload.get("items")
        if not isinstance(items, list):
            return []
        return items

    def fetch_image_url(self, review_id: str) -> str:
        payload = self._request("GET", f"/api/admin/image-reviews/{review_id}/image")
        url = str(payload.get("imageUrl") or "").strip()
        if not url:
            raise RuntimeError("未获取到图片地址")
        return url

    def approve(self, review_id: str, note: str = "") -> dict:
        return self._request(
            "POST",
            f"/api/admin/image-reviews/{review_id}/approve",
            {"note": note},
        )

    def reject(self, review_id: str, note: str = "") -> dict:
        return self._request(
            "POST",
            f"/api/admin/image-reviews/{review_id}/reject",
            {"note": note},
        )


class ImageReviewGUI:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title("V1PRO 图片人工复审")
        self.root.geometry("1180x760")
        self.root.minsize(960, 640)

        config = load_json(
            CONFIG_PATH,
            {
                "api_base": "https://api.jadot.cn:8443",
                "admin_token": "",
                "status_filter": "pending",
            },
        )

        self.api_base_var = tk.StringVar(value=str(config.get("api_base") or "https://api.jadot.cn:8443"))
        self.token_var = tk.StringVar(value=str(config.get("admin_token") or ""))
        self.status_var = tk.StringVar(value=str(config.get("status_filter") or "pending"))
        self.note_var = tk.StringVar(value="")

        self.items: list[dict] = []
        self.selected_id: str | None = None
        self.preview_photo: ImageTk.PhotoImage | None = None
        self._loading = False

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    def _build_ui(self) -> None:
        top = ttk.Frame(self.root, padding=10)
        top.pack(fill="x")

        ttk.Label(top, text="API 地址").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.api_base_var, width=42).grid(row=0, column=1, sticky="we", padx=(6, 12))
        ttk.Label(top, text="Admin Token").grid(row=0, column=2, sticky="w")
        ttk.Entry(top, textvariable=self.token_var, width=28, show="*").grid(row=0, column=3, sticky="we", padx=(6, 12))
        ttk.Label(top, text="状态").grid(row=0, column=4, sticky="w")
        status_box = ttk.Combobox(
            top,
            textvariable=self.status_var,
            values=["pending", "approved", "rejected", "all"],
            width=12,
            state="readonly",
        )
        status_box.grid(row=0, column=5, sticky="w", padx=(6, 12))
        ttk.Button(top, text="刷新列表", command=self.refresh_list).grid(row=0, column=6, padx=(0, 6))
        ttk.Button(top, text="保存配置", command=self.save_config).grid(row=0, column=7)
        top.columnconfigure(1, weight=1)
        top.columnconfigure(3, weight=1)

        body = ttk.Panedwindow(self.root, orient="horizontal")
        body.pack(fill="both", expand=True, padx=10, pady=(0, 10))

        left = ttk.Frame(body, padding=(0, 0, 8, 0))
        body.add(left, weight=1)

        columns = ("time", "action", "serial", "label", "score")
        self.tree = ttk.Treeview(left, columns=columns, show="headings", height=24)
        self.tree.heading("time", text="提交时间")
        self.tree.heading("action", text="类型")
        self.tree.heading("serial", text="设备")
        self.tree.heading("label", text="IMS 标签")
        self.tree.heading("score", text="分数")
        self.tree.column("time", width=140, anchor="w")
        self.tree.column("action", width=120, anchor="w")
        self.tree.column("serial", width=110, anchor="w")
        self.tree.column("label", width=100, anchor="w")
        self.tree.column("score", width=50, anchor="center")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        right = ttk.Frame(body, padding=(8, 0, 0, 0))
        body.add(right, weight=2)

        self.preview_label = ttk.Label(right, text="选择左侧记录以预览图片", anchor="center")
        self.preview_label.pack(fill="both", expand=True)

        meta = ttk.LabelFrame(right, text="详情", padding=10)
        meta.pack(fill="x", pady=(10, 0))
        self.detail_text = tk.Text(meta, height=8, wrap="word")
        self.detail_text.pack(fill="x")
        self.detail_text.configure(state="disabled")

        note_row = ttk.Frame(right)
        note_row.pack(fill="x", pady=(10, 0))
        ttk.Label(note_row, text="复核备注").pack(side="left")
        ttk.Entry(note_row, textvariable=self.note_var).pack(side="left", fill="x", expand=True, padx=(8, 0))

        actions = ttk.Frame(right)
        actions.pack(fill="x", pady=(10, 0))
        self.approve_btn = ttk.Button(actions, text="通过并发布", command=self.approve_selected)
        self.approve_btn.pack(side="left")
        self.reject_btn = ttk.Button(actions, text="拒绝", command=self.reject_selected)
        self.reject_btn.pack(side="left", padx=(8, 0))
        ttk.Button(actions, text="重新加载图片", command=self.reload_preview).pack(side="left", padx=(8, 0))

        self.log_box = tk.Text(self.root, height=5, wrap="word")
        self.log_box.pack(fill="x", padx=10, pady=(0, 10))
        self.log("就绪。请先填写 Admin Token，再点击「刷新列表」。")

    def log(self, message: str) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_box.insert("end", f"[{timestamp}] {message}\n")
        self.log_box.see("end")

    def save_config(self) -> None:
        save_json(
            CONFIG_PATH,
            {
                "api_base": self.api_base_var.get().strip(),
                "admin_token": self.token_var.get().strip(),
                "status_filter": self.status_var.get().strip(),
            },
        )
        self.log("配置已保存")

    def _on_close(self) -> None:
        self.save_config()
        self.root.destroy()

    def _client(self) -> ReviewApiClient:
        token = self.token_var.get().strip()
        if not token:
            raise RuntimeError("请先填写 Admin Token（与 backend/.env 中 REVIEW_ADMIN_TOKEN 一致）")
        return ReviewApiClient(self.api_base_var.get().strip(), token)

    def refresh_list(self) -> None:
        if self._loading:
            return
        self._loading = True
        self.log("正在加载复核列表…")

        def worker() -> None:
            try:
                client = self._client()
                items = client.list_reviews(self.status_var.get().strip() or "pending")
                self.root.after(0, lambda: self._apply_list(items))
            except Exception as exc:  # noqa: BLE001
                self.root.after(0, lambda: self._show_error("加载失败", str(exc)))
            finally:
                self.root.after(0, lambda: setattr(self, "_loading", False))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_list(self, items: list[dict]) -> None:
        self.items = items
        self.tree.delete(*self.tree.get_children())
        for item in items:
            review_id = str(item.get("id") or "")
            action = ACTION_LABELS.get(str(item.get("action") or ""), str(item.get("action") or "-"))
            self.tree.insert(
                "",
                "end",
                iid=review_id,
                values=(
                    format_time(str(item.get("createdAt") or "")),
                    action,
                    str(item.get("serial") or "-"),
                    str(item.get("label") or "-"),
                    str(item.get("score") or "-"),
                ),
            )
        self.log(f"已加载 {len(items)} 条记录")
        if items:
            first_id = str(items[0].get("id") or "")
            if first_id:
                self.tree.selection_set(first_id)
                self.tree.focus(first_id)
                self._load_item(first_id)
        else:
            self.selected_id = None
            self.preview_label.configure(image="", text="暂无记录")
            self.preview_photo = None
            self._set_detail("")

    def _on_select(self, _event: tk.Event) -> None:
        selected = self.tree.selection()
        if not selected:
            return
        self._load_item(selected[0])

    def _find_item(self, review_id: str) -> dict | None:
        for item in self.items:
            if str(item.get("id") or "") == review_id:
                return item
        return None

    def _load_item(self, review_id: str) -> None:
        self.selected_id = review_id
        item = self._find_item(review_id)
        if not item:
            return

        action = str(item.get("action") or "")
        can_publish = action in ("share_ai", "share_user") and str(item.get("status") or "") == "pending"
        state = "normal" if can_publish else "disabled"
        self.approve_btn.configure(state=state)
        reject_state = "normal" if str(item.get("status") or "") == "pending" else "disabled"
        self.reject_btn.configure(state=reject_state)

        lines = [
            f"编号: {item.get('id', '-')}",
            f"状态: {STATUS_LABELS.get(str(item.get('status') or ''), str(item.get('status') or '-'))}",
            f"类型: {ACTION_LABELS.get(action, action or '-')}",
            f"设备: {item.get('serial', '-')}",
            f"作者: {item.get('author') or '-'}",
            f"标题: {item.get('title') or '-'}",
            f"描述/提示词: {item.get('prompt') or item.get('description') or '-'}",
            f"来源: {item.get('source') or '-'}",
            f"IMS: {item.get('label') or '-'} / {item.get('subLabel') or '-'} (分数 {item.get('score', '-')})",
            f"提交时间: {format_time(str(item.get('createdAt') or ''))}",
        ]
        if item.get("reviewNote"):
            lines.append(f"复核备注: {item.get('reviewNote')}")
        if not can_publish and str(item.get("status") or "") == "pending":
            lines.append("说明: 仅「分享素材库」类记录支持一键发布；其它类型请拒绝或线下处理。")
        self._set_detail("\n".join(lines))
        self.reload_preview()

    def _set_detail(self, text: str) -> None:
        self.detail_text.configure(state="normal")
        self.detail_text.delete("1.0", "end")
        self.detail_text.insert("1.0", text)
        self.detail_text.configure(state="disabled")

    def reload_preview(self) -> None:
        if not self.selected_id:
            return
        if Image is None or ImageTk is None:
            self.preview_label.configure(image="", text="缺少 Pillow，请 pip install Pillow")
            return

        review_id = self.selected_id

        def worker() -> None:
            try:
                client = self._client()
                image_url = client.fetch_image_url(review_id)
                req = urllib.request.Request(image_url, headers={"User-Agent": "V1PRO-ReviewGUI/1.0"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw = resp.read()
                img = Image.open(io.BytesIO(raw))
                img.thumbnail((640, 480), Image.Resampling.LANCZOS)
                photo = ImageTk.PhotoImage(img)
                self.root.after(0, lambda: self._show_preview(photo))
            except Exception as exc:  # noqa: BLE001
                self.root.after(
                    0,
                    lambda: self.preview_label.configure(image="", text=f"图片加载失败:\n{exc}"),
                )

        threading.Thread(target=worker, daemon=True).start()

    def _show_preview(self, photo: ImageTk.PhotoImage) -> None:
        self.preview_photo = photo
        self.preview_label.configure(image=photo, text="")

    def approve_selected(self) -> None:
        if not self.selected_id:
            return
        if not messagebox.askyesno("确认通过", "确定通过该图片并发布到素材库吗？"):
            return
        self._run_action("approve")

    def reject_selected(self) -> None:
        if not self.selected_id:
            return
        if not messagebox.askyesno("确认拒绝", "确定拒绝该图片吗？"):
            return
        self._run_action("reject")

    def _run_action(self, action: str) -> None:
        review_id = self.selected_id
        if not review_id:
            return
        note = self.note_var.get().strip()

        def worker() -> None:
            try:
                client = self._client()
                if action == "approve":
                    payload = client.approve(review_id, note)
                    message = payload.get("message") or "已通过"
                    if payload.get("resourceId"):
                        message += f" · 资源 #{payload.get('resourceId')}"
                else:
                    payload = client.reject(review_id, note)
                    message = payload.get("message") or "已拒绝"
                self.root.after(0, lambda: self._after_action(message))
            except Exception as exc:  # noqa: BLE001
                self.root.after(0, lambda: self._show_error("操作失败", str(exc)))

        self.log(f"正在{ '通过' if action == 'approve' else '拒绝' } {review_id}…")
        threading.Thread(target=worker, daemon=True).start()

    def _after_action(self, message: str) -> None:
        self.log(message)
        self.note_var.set("")
        self.refresh_list()

    def _show_error(self, title: str, message: str) -> None:
        self.log(f"[错误] {message}")
        messagebox.showerror(title, message)

    def run(self) -> None:
        self.root.mainloop()


if __name__ == "__main__":
    ImageReviewGUI().run()
