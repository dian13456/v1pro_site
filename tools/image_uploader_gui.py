import json
import io
import os
import secrets
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, unquote, urlparse
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

try:
    from qcloud_cos import CosConfig, CosS3Client
except Exception:  # pragma: no cover - runtime dependency check
    CosConfig = None
    CosS3Client = None

try:
    from PIL import Image
except Exception:  # pragma: no cover - runtime dependency check
    Image = None

try:
    import paramiko
except Exception:  # pragma: no cover - runtime dependency check
    paramiko = None


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RESOURCES_PATH = PROJECT_ROOT / "src" / "data" / "resources.json"
COLUMN_TAGS_PATH = PROJECT_ROOT / "src" / "data" / "columnTags.json"
IMAGE_MAP_PATH = PROJECT_ROOT / "backend" / "config" / "image_map.json"
RESOURCE_MAP_PATH = PROJECT_ROOT / "backend" / "config" / "resource_map.json"
AI_IMAGE_CREDITS_PATH = PROJECT_ROOT / "backend" / "config" / "ai_image_credits.json"
AI_IMAGE_SHARES_PATH = PROJECT_ROOT / "backend" / "config" / "ai_image_share_counts.json"

DEFAULT_AI_CREDITS = 100
AI_CREDIT_COST_PER_GENERATION = 1
MAX_AI_SHARES_PER_DEVICE = 50


def load_json(path: Path, default_value):
    if not path.exists():
        return default_value
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_credits_store() -> dict:
    store = load_json(AI_IMAGE_CREDITS_PATH, {"balances": {}})
    if not isinstance(store, dict):
        return {"balances": {}}
    balances = store.get("balances")
    if not isinstance(balances, dict):
        store["balances"] = {}
    return store


def save_credits_store(store: dict) -> None:
    if not isinstance(store.get("balances"), dict):
        store["balances"] = {}
    save_json(AI_IMAGE_CREDITS_PATH, store)


def load_share_store() -> dict:
    store = load_json(AI_IMAGE_SHARES_PATH, {"counts": {}})
    if not isinstance(store, dict):
        return {"counts": {}}
    counts = store.get("counts")
    if not isinstance(counts, dict):
        store["counts"] = {}
    return store


def save_share_store(store: dict) -> None:
    if not isinstance(store.get("counts"), dict):
        store["counts"] = {}
    save_json(AI_IMAGE_SHARES_PATH, store)


def normalize_serial(raw: str) -> str:
    return (raw or "").strip().upper()


def credit_balance(store: dict, serial: str) -> int:
    serial = normalize_serial(serial)
    if not serial:
        return DEFAULT_AI_CREDITS
    balances = store.get("balances") or {}
    if serial not in balances:
        return DEFAULT_AI_CREDITS
    value = int(balances.get(serial, DEFAULT_AI_CREDITS))
    return max(0, value)


def share_count(store: dict, serial: str) -> int:
    serial = normalize_serial(serial)
    if not serial:
        return 0
    counts = store.get("counts") or {}
    value = int(counts.get(serial, 0))
    return max(0, value)


def remaining_shares(used: int, limit: int = MAX_AI_SHARES_PER_DEVICE) -> int:
    return max(0, limit - max(0, used))


def load_column_tags() -> list[dict]:
    default_tags = [
        {"id": "yuexin-miao", "label": "月薪喵", "keywords": ["月薪喵", "月薪"]},
        {"id": "doro", "label": "doro", "keywords": ["doro"]},
        {"id": "feibi", "label": "菲比", "keywords": ["菲比"]},
    ]
    tags = load_json(COLUMN_TAGS_PATH, default_tags)
    if not isinstance(tags, list):
        return default_tags
    return tags


def save_column_tags(tags: list[dict]) -> None:
    save_json(COLUMN_TAGS_PATH, tags)


def make_column_id(label: str, existing_ids: set[str]) -> str:
    import hashlib

    digest = hashlib.sha1(label.encode("utf-8")).hexdigest()[:10]
    candidate = f"col-{digest}"
    suffix = 1
    while candidate in existing_ids:
        candidate = f"col-{digest}-{suffix}"
        suffix += 1
    return candidate


def parse_keywords(raw: str, fallback_label: str) -> list[str]:
    keywords = [part.strip() for part in raw.replace("，", ",").split(",") if part.strip()]
    if keywords:
        return keywords
    return [fallback_label] if fallback_label else []


def random_code(length: int = 8) -> str:
    # 生成 URL 友好的随机短码，避免对象名冲突和缓存命中旧图。
    return secrets.token_hex(max(1, length // 2))[:length]


def make_resource_id(code: str) -> int:
    """
    资源 ID = 上传时间(yyMMddHHmmss) + 随机码衍生 4 位数字。
    例如：2605310120304821
    """
    timestamp_part = datetime.now().strftime("%y%m%d%H%M%S")
    random_part = str(int((code or "0")[:4], 16) % 10000).zfill(4)
    return int(f"{timestamp_part}{random_part}")


def make_object_key(code: str, ext: str, prefix: str) -> str:
    """
    对象名 = 前缀 + 当前时间(yyyyMMddHHmmss) + 随机码 + 扩展名
    例如：img_20260531153025_a1b2c3d4.jpg
    """
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    normalized_ext = (ext or "").lower() or ".bin"
    return f"{prefix}_{timestamp}_{code}{normalized_ext}"


def extract_gif_first_frame_jpeg_bytes(gif_path: Path) -> bytes:
    if Image is None:
        raise RuntimeError("缺少依赖 Pillow，请先运行：pip install -r tools/requirements.txt")
    with Image.open(gif_path) as img:
        img.seek(0)
        frame = img.convert("RGB")
        output = io.BytesIO()
        frame.save(output, format="JPEG", quality=92, optimize=True)
        return output.getvalue()


def resolve_ffmpeg_path() -> str | None:
    env_ffmpeg = os.getenv("FFMPEG_PATH", "").strip()
    if env_ffmpeg:
        candidate = Path(env_ffmpeg)
        if candidate.exists():
            return str(candidate)

    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg

    local_app_data = os.getenv("LOCALAPPDATA", "").strip()
    if local_app_data:
        winget_root = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        if winget_root.exists():
            for candidate in sorted(winget_root.glob("**/ffmpeg.exe"), reverse=True):
                if candidate.is_file():
                    return str(candidate)
    return None


def extract_video_first_frame_jpeg_bytes(video_path: Path) -> bytes:
    ffmpeg = resolve_ffmpeg_path()
    if not ffmpeg:
        raise RuntimeError(
            "未检测到 ffmpeg，视频无封面时无法自动提取第一帧。"
            "请安装 ffmpeg、重启程序，或设置环境变量 FFMPEG_PATH 指向 ffmpeg.exe。"
        )

    cmd = [
        ffmpeg,
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video_path),
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, check=True)
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or b"").decode("utf-8", "ignore").strip()
        raise RuntimeError(f"视频封面提取失败：{err or 'ffmpeg 执行失败'}") from exc

    if not result.stdout:
        raise RuntimeError("视频封面提取失败：未读取到第一帧图像数据")
    return result.stdout


def parse_media_paths(raw: str) -> list[Path]:
    parts = [item.strip() for item in (raw or "").split(" | ") if item.strip()]
    return [Path(p) for p in parts]


def format_file_size(num_bytes: int) -> str:
    if num_bytes < 1024:
        return f"{num_bytes}B"
    if num_bytes < 1024 * 1024:
        return f"{num_bytes / 1024:.1f}KB"
    if num_bytes < 1024 * 1024 * 1024:
        return f"{num_bytes / (1024 * 1024):.1f}MB"
    return f"{num_bytes / (1024 * 1024 * 1024):.2f}GB"


def build_cos_public_url(base: str, object_key: str) -> str:
    normalized_base = base.strip().rstrip("/")
    if not normalized_base:
        return object_key
    return f"{normalized_base}/{quote(object_key, safe='/')}"


def strip_public_object_url(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    if not text.lower().startswith(("http://", "https://")):
        return text.lstrip("/")
    return unquote(urlparse(text).path.lstrip("/"))


class ImageUploaderGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("V1PRO 素材上传与同步工具")
        self.root.geometry("880x700")
        self.root.minsize(820, 620)

        self.secret_id_var = tk.StringVar(value=os.getenv("COS_SECRET_ID", ""))
        self.secret_key_var = tk.StringVar(value=os.getenv("COS_SECRET_KEY", ""))

        self.bucket_var = tk.StringVar(value=os.getenv("IMAGE_COS_BUCKET", "v1image-1311844229"))
        self.region_var = tk.StringVar(value=os.getenv("IMAGE_COS_REGION", "ap-guangzhou"))
        self.image_public_base_var = tk.StringVar(
            value=os.getenv("IMAGE_COS_PUBLIC_BASE", "https://v1image-1311844229.cos.ap-guangzhou.myqcloud.com")
        )
        self.video_bucket_var = tk.StringVar(value=os.getenv("VIDEO_COS_BUCKET", "video-1311844229"))
        self.video_region_var = tk.StringVar(value=os.getenv("VIDEO_COS_REGION", "ap-guangzhou"))
        self.video_public_base_var = tk.StringVar(
            value=os.getenv("VIDEO_COS_PUBLIC_BASE", "https://video-1311844229.cos.ap-guangzhou.myqcloud.com")
        )
        self.video_cover_bucket_var = tk.StringVar(
            value=os.getenv("VIDEO_COVER_COS_BUCKET", "video-cover-1311844229")
        )
        self.video_cover_region_var = tk.StringVar(
            value=os.getenv("VIDEO_COVER_COS_REGION", os.getenv("IMAGE_COS_REGION", "ap-guangzhou"))
        )
        self.video_cover_public_base_var = tk.StringVar(
            value=os.getenv(
                "VIDEO_COVER_COS_PUBLIC_BASE",
                "https://video-cover-1311844229.cos.ap-guangzhou.myqcloud.com",
            )
        )
        self.gif_bucket_var = tk.StringVar(value=os.getenv("GIF_COS_BUCKET", "gif-1311844229"))
        self.gif_region_var = tk.StringVar(value=os.getenv("GIF_COS_REGION", "ap-guangzhou"))
        self.gif_public_base_var = tk.StringVar(
            value=os.getenv("GIF_COS_PUBLIC_BASE", "https://gif-1311844229.cos.ap-guangzhou.myqcloud.com")
        )
        self.gif_cover_bucket_var = tk.StringVar(value=os.getenv("GIF_COVER_COS_BUCKET", "gif-cover-1311844229"))
        self.gif_cover_region_var = tk.StringVar(value=os.getenv("GIF_COVER_COS_REGION", "ap-guangzhou"))
        self.gif_cover_public_base_var = tk.StringVar(
            value=os.getenv("GIF_COVER_COS_PUBLIC_BASE", "https://gif-cover-1311844229.cos.ap-guangzhou.myqcloud.com")
        )
        self.software_bucket_var = tk.StringVar(value=os.getenv("SOFTWARE_COS_BUCKET", "v1pro-1311844229"))
        self.software_region_var = tk.StringVar(value=os.getenv("SOFTWARE_COS_REGION", "ap-guangzhou"))
        self.software_public_base_var = tk.StringVar(
            value=os.getenv(
                "SOFTWARE_COS_PUBLIC_BASE",
                "https://v1pro-1311844229.cos.ap-guangzhou.myqcloud.com",
            )
        )

        self.material_type_var = tk.StringVar(value="image")
        self.media_path_var = tk.StringVar()
        self.cover_path_var = tk.StringVar()
        self.id_var = tk.StringVar()
        self.title_var = tk.StringVar()
        self.desc_var = tk.StringVar()
        self.author_var = tk.StringVar()
        self.column_tag_var = tk.StringVar(value="")
        self.column_tag_id_by_label: dict[str, str] = {"": ""}
        self.new_column_label_var = tk.StringVar()
        self.new_column_keywords_var = tk.StringVar()
        self.size_var = tk.StringVar(value="未知")
        self.category_var = tk.StringVar(value="gif")
        self.download_var = tk.StringVar()
        self.cover_url_var = tk.StringVar()
        self.random_code_var = tk.StringVar(value=random_code(8))
        self.auto_sync_var = tk.BooleanVar(value=True)
        self.remote_host_var = tk.StringVar(value=os.getenv("REMOTE_SYNC_HOST", "124.221.5.162"))
        self.remote_user_var = tk.StringVar(value=os.getenv("REMOTE_SYNC_USER", "ubuntu"))
        self.remote_password_var = tk.StringVar(value=os.getenv("REMOTE_SYNC_PASSWORD", ""))
        self.remote_base_path_var = tk.StringVar(value=os.getenv("REMOTE_SYNC_BASE_PATH", "/opt/jiadian-hub/app"))
        self.remote_restart_var = tk.BooleanVar(value=False)
        self.remote_restart_cmd_var = tk.StringVar(
            value=os.getenv("REMOTE_RESTART_CMD", "echo 'PASSWORD' | sudo -S -p '' systemctl restart jiadian-api.service")
        )
        self.delete_resource_ids: list[int] = []
        self.delete_filter_var = tk.StringVar(value="image")
        self.quota_serial_var = tk.StringVar()
        self.quota_credits_var = tk.StringVar(value=str(DEFAULT_AI_CREDITS))
        self.quota_share_used_var = tk.StringVar(value="0")
        self.quota_share_limit_var = tk.StringVar(value=str(MAX_AI_SHARES_PER_DEVICE))
        self.quota_share_remaining_var = tk.StringVar(value=str(MAX_AI_SHARES_PER_DEVICE))
        self.quota_filter_var = tk.StringVar()

        self._build_ui()
        self.regenerate_random_code()
        self.refresh_column_tag_manager()
        self.refresh_delete_resource_list()
        self.refresh_quota_list()
        self.material_type_var.trace_add("write", lambda *_: self._on_material_type_change())

    def _build_ui(self):
        notebook = ttk.Notebook(self.root)
        notebook.pack(fill=tk.BOTH, expand=True, padx=12, pady=12)

        upload_tab = ttk.Frame(notebook, padding=2)
        cos_tab = ttk.Frame(notebook, padding=2)
        column_tab = ttk.Frame(notebook, padding=2)
        delete_tab = ttk.Frame(notebook, padding=2)
        quota_tab = ttk.Frame(notebook, padding=2)
        notebook.add(upload_tab, text="上传与同步")
        notebook.add(cos_tab, text="COS配置")
        notebook.add(column_tab, text="专栏管理")
        notebook.add(delete_tab, text="删除资源")
        notebook.add(quota_tab, text="设备配额")

        top = ttk.LabelFrame(cos_tab, text="COS 配置（单独处理图片/视频/GIF）", padding=10)
        top.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)
        top.columnconfigure(1, weight=1)
        top.columnconfigure(3, weight=1)

        ttk.Label(top, text="SecretId").grid(row=0, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.secret_id_var).grid(row=0, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="SecretKey").grid(row=0, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.secret_key_var, show="*").grid(row=0, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="图片 Bucket").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.bucket_var).grid(row=1, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="图片 Region").grid(row=1, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.region_var).grid(row=1, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="图片公网前缀").grid(row=2, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.image_public_base_var).grid(row=2, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(top, text="视频 Bucket").grid(row=3, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.video_bucket_var).grid(row=3, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="视频 Region").grid(row=3, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.video_region_var).grid(row=3, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="视频公网前缀").grid(row=4, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.video_public_base_var).grid(row=4, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(top, text="视频封面 Bucket").grid(row=5, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.video_cover_bucket_var).grid(row=5, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="视频封面 Region").grid(row=5, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.video_cover_region_var).grid(row=5, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="视频封面公网前缀").grid(row=6, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.video_cover_public_base_var).grid(
            row=6, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2
        )

        ttk.Label(top, text="GIF Bucket").grid(row=7, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.gif_bucket_var).grid(row=7, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="GIF Region").grid(row=7, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.gif_region_var).grid(row=7, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="GIF公网前缀").grid(row=8, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.gif_public_base_var).grid(row=8, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(top, text="GIF封面 Bucket").grid(row=9, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.gif_cover_bucket_var).grid(row=9, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="GIF封面 Region").grid(row=9, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.gif_cover_region_var).grid(row=9, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="GIF封面公网前缀").grid(row=10, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.gif_cover_public_base_var).grid(
            row=10, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2
        )

        ttk.Label(top, text="软件 Bucket").grid(row=11, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.software_bucket_var).grid(row=11, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="软件 Region").grid(row=11, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.software_region_var).grid(row=11, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="软件公网前缀").grid(row=12, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.software_public_base_var).grid(
            row=12, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2
        )

        resource = ttk.LabelFrame(upload_tab, text="素材信息", padding=10)
        resource.pack(fill=tk.X, padx=0, pady=(0, 8))
        resource.columnconfigure(1, weight=1)
        resource.columnconfigure(3, weight=1)

        ttk.Label(resource, text="素材类型").grid(row=0, column=0, sticky="w", pady=2)
        ttk.Combobox(
            resource,
            textvariable=self.material_type_var,
            values=("image", "video", "gif", "software"),
            state="readonly",
        ).grid(row=0, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(resource, text="分类").grid(row=0, column=2, sticky="w", pady=2)
        ttk.Combobox(resource, textvariable=self.category_var, values=("gif", "driver", "firmware", "software", "manual"), state="readonly").grid(
            row=0, column=3, sticky="ew", pady=2
        )

        ttk.Label(resource, text="主文件（支持多选）").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.media_path_var).grid(row=1, column=1, columnspan=2, sticky="ew", padx=(8, 8), pady=2)
        ttk.Button(resource, text="选择文件", command=self.choose_media).grid(row=1, column=3, sticky="ew", pady=2)

        ttk.Label(resource, text="视频/GIF/软件封面(可选)").grid(row=2, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.cover_path_var).grid(row=2, column=1, columnspan=2, sticky="ew", padx=(8, 8), pady=2)
        ttk.Button(resource, text="选择封面", command=self.choose_cover).grid(row=2, column=3, sticky="ew", pady=2)

        ttk.Label(resource, text="资源 ID").grid(row=3, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.id_var, state="readonly").grid(row=3, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(resource, text="大小").grid(row=3, column=2, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.size_var).grid(row=3, column=3, sticky="ew", pady=2)

        ttk.Label(resource, text="标题").grid(row=4, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.title_var).grid(row=4, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(resource, text="描述").grid(row=4, column=2, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.desc_var).grid(row=4, column=3, sticky="ew", pady=2)

        ttk.Label(resource, text="上传人(作者，可选，仅填写时前端显示)").grid(row=5, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.author_var).grid(row=5, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(resource, text="专栏标签(可选)").grid(row=6, column=0, sticky="w", pady=2)
        self.column_tag_combo = ttk.Combobox(
            resource,
            textvariable=self.column_tag_var,
            values=("",),
            state="readonly",
        )
        self.column_tag_combo.grid(row=6, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(resource, text="可在「专栏管理」页新增").grid(row=6, column=2, columnspan=2, sticky="w", pady=2)

        ttk.Label(resource, text="下载链接(可空，默认按素材类型生成)").grid(row=7, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.download_var).grid(row=7, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(resource, text="封面链接(视频/GIF且不上传封面时可填)").grid(row=8, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.cover_url_var).grid(row=8, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(resource, text="随机码(自动生成)").grid(row=9, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.random_code_var, state="readonly").grid(
            row=9, column=1, sticky="ew", padx=(8, 12), pady=2
        )
        ttk.Button(resource, text="重新生成", command=self.regenerate_random_code).grid(row=9, column=2, columnspan=2, sticky="ew", pady=2)

        actions = ttk.Frame(upload_tab)
        actions.pack(fill=tk.X, padx=0, pady=(0, 8))
        ttk.Button(actions, text="上传并同步显示", command=self.upload_and_sync).pack(side=tk.LEFT)
        ttk.Label(
            actions,
            text="说明：图片仅更新 image_map；视频/GIF/软件更新 resource_map；软件封面写入 image_map。",
        ).pack(side=tk.LEFT, padx=12)

        sync_frame = ttk.LabelFrame(upload_tab, text="云服务器自动同步（可选）", padding=10)
        sync_frame.pack(fill=tk.X, padx=0, pady=(0, 8))
        sync_frame.columnconfigure(1, weight=1)
        sync_frame.columnconfigure(3, weight=1)

        ttk.Checkbutton(sync_frame, text="上传后自动同步到云服务器", variable=self.auto_sync_var).grid(
            row=0, column=0, columnspan=4, sticky="w", pady=(0, 4)
        )
        ttk.Label(sync_frame, text="主机").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(sync_frame, textvariable=self.remote_host_var).grid(row=1, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(sync_frame, text="用户").grid(row=1, column=2, sticky="w", pady=2)
        ttk.Entry(sync_frame, textvariable=self.remote_user_var).grid(row=1, column=3, sticky="ew", pady=2)

        ttk.Label(sync_frame, text="密码").grid(row=2, column=0, sticky="w", pady=2)
        ttk.Entry(sync_frame, textvariable=self.remote_password_var, show="*").grid(
            row=2, column=1, sticky="ew", padx=(8, 12), pady=2
        )
        ttk.Label(sync_frame, text="远程项目根目录").grid(row=2, column=2, sticky="w", pady=2)
        ttk.Entry(sync_frame, textvariable=self.remote_base_path_var).grid(row=2, column=3, sticky="ew", pady=2)

        ttk.Checkbutton(sync_frame, text="同步后执行重启命令", variable=self.remote_restart_var).grid(
            row=3, column=0, columnspan=2, sticky="w", pady=2
        )
        ttk.Label(sync_frame, text="重启命令").grid(row=4, column=0, sticky="w", pady=2)
        ttk.Entry(sync_frame, textvariable=self.remote_restart_cmd_var).grid(
            row=4, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2
        )

        column_frame = ttk.LabelFrame(column_tab, text="专栏标签管理", padding=10)
        column_frame.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)
        column_frame.columnconfigure(1, weight=1)

        ttk.Label(
            column_frame,
            text="新增专栏后写入 src/data/columnTags.json。前端会从 API 读取；勾选云同步后也会上传到服务器。",
        ).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 8))

        ttk.Label(column_frame, text="专栏名称").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(column_frame, textvariable=self.new_column_label_var).grid(
            row=1, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=2
        )

        ttk.Label(column_frame, text="匹配关键词").grid(row=2, column=0, sticky="w", pady=2)
        ttk.Entry(column_frame, textvariable=self.new_column_keywords_var).grid(
            row=2, column=1, columnspan=2, sticky="ew", padx=(8, 0), pady=2
        )
        ttk.Label(column_frame, text="多个关键词用逗号分隔，留空则默认使用专栏名称").grid(
            row=3, column=0, columnspan=3, sticky="w", pady=(0, 8)
        )

        column_actions = ttk.Frame(column_frame)
        column_actions.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(0, 8))
        ttk.Button(column_actions, text="添加专栏", command=self.add_column_tag).pack(side=tk.LEFT)
        ttk.Button(column_actions, text="删除选中", command=self.delete_selected_column_tag).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(column_actions, text="刷新列表", command=self.refresh_column_tag_manager).pack(side=tk.LEFT, padx=(8, 0))

        self.column_listbox = tk.Listbox(column_frame, height=12, exportselection=False)
        self.column_listbox.grid(row=5, column=0, columnspan=3, sticky="nsew", pady=(0, 8))
        column_frame.rowconfigure(5, weight=1)

        delete_frame = ttk.LabelFrame(delete_tab, text="资源删除（会同时清理映射）", padding=10)
        delete_frame.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)
        delete_frame.columnconfigure(0, weight=1)

        delete_hint = (
            "列表显示: ID | 类型 | 标题\n"
            "删除时会同步清理 resources.json、image_map.json、resource_map.json。"
        )
        ttk.Label(delete_frame, text=delete_hint).pack(anchor="w", pady=(0, 8))

        filter_frame = ttk.Frame(delete_frame)
        filter_frame.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(filter_frame, text="分类筛选").pack(side=tk.LEFT)
        self.delete_filter_combo = ttk.Combobox(
            filter_frame,
            textvariable=self.delete_filter_var,
            state="readonly",
            values=("image", "video", "gif", "v1pro-pack", "all"),
            width=14,
        )
        self.delete_filter_combo.pack(side=tk.LEFT, padx=(8, 0))
        self.delete_filter_combo.bind("<<ComboboxSelected>>", lambda _e: self.refresh_delete_resource_list())
        ttk.Label(filter_frame, text="（默认 image=图片素材）").pack(side=tk.LEFT, padx=(8, 0))

        list_wrapper = ttk.Frame(delete_frame)
        list_wrapper.pack(fill=tk.BOTH, expand=True)
        list_wrapper.columnconfigure(0, weight=1)
        list_wrapper.rowconfigure(0, weight=1)

        self.delete_listbox = tk.Listbox(
            list_wrapper,
            selectmode=tk.EXTENDED,
            activestyle="none",
            exportselection=False,
        )
        self.delete_listbox.grid(row=0, column=0, sticky="nsew")

        delete_scroll = ttk.Scrollbar(list_wrapper, orient=tk.VERTICAL, command=self.delete_listbox.yview)
        delete_scroll.grid(row=0, column=1, sticky="ns")
        self.delete_listbox.configure(yscrollcommand=delete_scroll.set)

        delete_actions = ttk.Frame(delete_frame)
        delete_actions.pack(fill=tk.X, pady=(8, 0))
        ttk.Button(delete_actions, text="刷新列表", command=self.refresh_delete_resource_list).pack(side=tk.LEFT)
        ttk.Button(delete_actions, text="删除选中资源", command=self.delete_selected_resources).pack(side=tk.LEFT, padx=(8, 0))

        quota_frame = ttk.LabelFrame(quota_tab, text="按 SN 管理 AI 积分与分享次数", padding=10)
        quota_frame.pack(fill=tk.BOTH, expand=True, padx=0, pady=0)
        quota_frame.columnconfigure(1, weight=1)

        ttk.Label(
            quota_frame,
            text=(
                f"积分默认 {DEFAULT_AI_CREDITS}，每次 AI 生图消耗 {AI_CREDIT_COST_PER_GENERATION}；"
                f"分享上限 {MAX_AI_SHARES_PER_DEVICE} 次/设备（上限在代码中固定）。"
                "修改后需同步到云服务器并重启 API 才在线上生效。"
            ),
            wraplength=820,
        ).grid(row=0, column=0, columnspan=4, sticky="w", pady=(0, 8))

        ttk.Label(quota_frame, text="设备 SN").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(quota_frame, textvariable=self.quota_serial_var).grid(
            row=1, column=1, sticky="ew", padx=(8, 12), pady=2
        )
        ttk.Button(quota_frame, text="查询", command=self.lookup_quota_sn).grid(row=1, column=2, sticky="ew", pady=2)
        ttk.Button(quota_frame, text="从服务器拉取", command=self.pull_quota_from_server).grid(row=1, column=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(quota_frame, text="AI 积分").grid(row=2, column=0, sticky="w", pady=2)
        ttk.Entry(quota_frame, textvariable=self.quota_credits_var).grid(row=2, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(quota_frame, text="已分享次数").grid(row=2, column=2, sticky="w", pady=2)
        ttk.Entry(quota_frame, textvariable=self.quota_share_used_var).grid(row=2, column=3, sticky="ew", pady=2)

        ttk.Label(quota_frame, text="分享上限").grid(row=3, column=0, sticky="w", pady=2)
        ttk.Entry(quota_frame, textvariable=self.quota_share_limit_var, state="readonly").grid(
            row=3, column=1, sticky="ew", padx=(8, 12), pady=2
        )
        ttk.Label(quota_frame, text="剩余分享").grid(row=3, column=2, sticky="w", pady=2)
        ttk.Entry(quota_frame, textvariable=self.quota_share_remaining_var, state="readonly").grid(row=3, column=3, sticky="ew", pady=2)

        quota_actions = ttk.Frame(quota_frame)
        quota_actions.grid(row=4, column=0, columnspan=4, sticky="ew", pady=(8, 8))
        ttk.Button(quota_actions, text="保存到本地", command=self.save_quota_local).pack(side=tk.LEFT)
        ttk.Button(quota_actions, text="保存并同步云服务器", command=self.save_quota_and_sync).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(quota_actions, text="重置分享次数为 0", command=self.reset_share_for_sn).pack(side=tk.LEFT, padx=(8, 0))
        ttk.Button(quota_actions, text="刷新列表", command=self.refresh_quota_list).pack(side=tk.LEFT, padx=(8, 0))

        filter_row = ttk.Frame(quota_frame)
        filter_row.grid(row=5, column=0, columnspan=4, sticky="ew", pady=(0, 8))
        ttk.Label(filter_row, text="列表筛选 SN").pack(side=tk.LEFT)
        ttk.Entry(filter_row, textvariable=self.quota_filter_var, width=24).pack(side=tk.LEFT, padx=(8, 8))
        ttk.Button(filter_row, text="应用筛选", command=self.refresh_quota_list).pack(side=tk.LEFT)

        list_wrapper = ttk.Frame(quota_frame)
        list_wrapper.grid(row=6, column=0, columnspan=4, sticky="nsew")
        list_wrapper.columnconfigure(0, weight=1)
        list_wrapper.rowconfigure(0, weight=1)
        quota_frame.rowconfigure(6, weight=1)

        columns = ("serial", "credits", "share_used", "share_remaining")
        self.quota_tree = ttk.Treeview(list_wrapper, columns=columns, show="headings", height=14)
        self.quota_tree.heading("serial", text="设备 SN")
        self.quota_tree.heading("credits", text="AI 积分")
        self.quota_tree.heading("share_used", text="已分享")
        self.quota_tree.heading("share_remaining", text="剩余分享")
        self.quota_tree.column("serial", width=180, anchor="w")
        self.quota_tree.column("credits", width=90, anchor="center")
        self.quota_tree.column("share_used", width=90, anchor="center")
        self.quota_tree.column("share_remaining", width=90, anchor="center")
        self.quota_tree.grid(row=0, column=0, sticky="nsew")
        self.quota_tree.bind("<<TreeviewSelect>>", self._on_quota_select)

        quota_scroll = ttk.Scrollbar(list_wrapper, orient=tk.VERTICAL, command=self.quota_tree.yview)
        quota_scroll.grid(row=0, column=1, sticky="ns")
        self.quota_tree.configure(yscrollcommand=quota_scroll.set)

        log_frame = ttk.LabelFrame(upload_tab, text="日志", padding=10)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=0, pady=(0, 0))
        self.log_text = tk.Text(log_frame, height=14, wrap=tk.WORD)
        self.log_text.pack(fill=tk.BOTH, expand=True)

    def log(self, text: str):
        self.log_text.insert(tk.END, f"{text}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()

    def refresh_column_tag_choices(self):
        tags = load_column_tags()
        labels = [""] + [str(item.get("label", "")).strip() for item in tags if str(item.get("label", "")).strip()]
        self.column_tag_id_by_label = {"": ""}
        for item in tags:
            label = str(item.get("label", "")).strip()
            tag_id = str(item.get("id", "")).strip()
            if label and tag_id:
                self.column_tag_id_by_label[label] = tag_id
        self.column_tag_combo["values"] = labels
        if self.column_tag_var.get() not in labels:
            self.column_tag_var.set("")

    def refresh_column_tag_manager(self):
        self.refresh_column_tag_choices()
        self.column_listbox.delete(0, tk.END)
        for item in load_column_tags():
            label = str(item.get("label", "")).strip()
            tag_id = str(item.get("id", "")).strip()
            keywords = item.get("keywords") or []
            keyword_text = "、".join(str(keyword) for keyword in keywords)
            self.column_listbox.insert(tk.END, f"{label} | {tag_id} | {keyword_text}")

    def get_selected_column_tag_id(self) -> str:
        label = self.column_tag_var.get().strip()
        return self.column_tag_id_by_label.get(label, "")

    def add_column_tag(self):
        label = self.new_column_label_var.get().strip()
        if not label:
            messagebox.showerror("失败", "请填写专栏名称")
            return

        tags = load_column_tags()
        existing_labels = {str(item.get("label", "")).strip() for item in tags}
        if label in existing_labels:
            messagebox.showerror("失败", f"专栏「{label}」已存在")
            return

        keywords = parse_keywords(self.new_column_keywords_var.get(), label)
        existing_ids = {str(item.get("id", "")).strip() for item in tags if str(item.get("id", "")).strip()}
        tag_id = make_column_id(label, existing_ids)
        tags.append({"id": tag_id, "label": label, "keywords": keywords})
        save_column_tags(tags)
        self.new_column_label_var.set("")
        self.new_column_keywords_var.set("")
        self.refresh_column_tag_manager()
        self.column_tag_var.set(label)
        self.log(f"已新增专栏: {label} ({tag_id})")

    def delete_selected_column_tag(self):
        selection = self.column_listbox.curselection()
        if not selection:
            messagebox.showerror("失败", "请先选择要删除的专栏")
            return

        tags = load_column_tags()
        index = selection[0]
        if index < 0 or index >= len(tags):
            return

        target = tags[index]
        label = str(target.get("label", "")).strip() or target.get("id", "")
        if not messagebox.askyesno("确认删除", f"确定删除专栏「{label}」？"):
            return

        tags.pop(index)
        save_column_tags(tags)
        self.refresh_column_tag_manager()
        self.log(f"已删除专栏: {label}")

    def choose_media(self):
        material_type = self.material_type_var.get().strip()
        if material_type == "video":
            filetypes = [("Video Files", "*.mp4;*.mov;*.m4v;*.avi;*.mkv;*.webm;*.flv")]
            title = "选择视频文件（可多选）"
        elif material_type == "gif":
            filetypes = [("GIF Files", "*.gif")]
            title = "选择 GIF 文件（可多选）"
        elif material_type == "software":
            filetypes = [("Setup / EXE", "*.exe"), ("All Files", "*.*")]
            title = "选择软件安装包（可多选）"
        else:
            filetypes = [("Image Files", "*.png;*.jpg;*.jpeg;*.webp;*.bmp")]
            title = "选择图片文件（可多选）"

        if material_type == "gif":
            paths = filedialog.askopenfilenames(title=title, filetypes=filetypes)
            if paths:
                self.media_path_var.set(" | ".join(paths))
                first_name = Path(paths[0]).stem
                self.title_var.set(first_name)
                self.desc_var.set(first_name)
            return

        paths = filedialog.askopenfilenames(title=title, filetypes=filetypes)
        if paths:
            self.media_path_var.set(" | ".join(paths))
            first_path = Path(paths[0])
            first_name = first_path.name if material_type == "software" else first_path.stem
            if material_type == "software":
                self.title_var.set(first_name)
                self.desc_var.set(f"{first_path.stem} 安装包")
                self.size_var.set(format_file_size(first_path.stat().st_size))
            else:
                if not self.title_var.get().strip():
                    self.title_var.set(first_name)
                if not self.desc_var.get().strip():
                    self.desc_var.set(first_name)

    def choose_cover(self):
        material_type = self.material_type_var.get().strip()
        title = "选择软件封面" if material_type == "software" else "选择视频或GIF封面"
        path = filedialog.askopenfilename(
            title=title,
            filetypes=[("Image Files", "*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif")],
        )
        if path:
            self.cover_path_var.set(path)

    def regenerate_random_code(self):
        code = random_code(8)
        self.random_code_var.set(code)
        self.id_var.set(str(make_resource_id(code)))

    def _on_material_type_change(self):
        material_type = self.material_type_var.get().strip()
        if material_type == "video":
            self.size_var.set("未知")
        elif material_type == "gif":
            self.category_var.set("gif")
            if not self.size_var.get().strip() or self.size_var.get().strip() == "未知":
                self.size_var.set("30MB")
        elif material_type == "software":
            self.category_var.set("software")
            if not self.size_var.get().strip():
                self.size_var.set("未知")
        elif not self.size_var.get().strip():
            self.size_var.set("30MB")

    def _build_cos_client(self, region: str):
        if CosConfig is None or CosS3Client is None:
            raise RuntimeError("缺少依赖 qcloud_cos，请先运行：pip install -r tools/requirements.txt")
        secret_id = self.secret_id_var.get().strip()
        secret_key = self.secret_key_var.get().strip()
        if not secret_id or not secret_key or not region:
            raise RuntimeError("COS 配置不完整（SecretId / SecretKey / Region）")
        config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key, Token=None, Scheme="https")
        return CosS3Client(config)

    def _sync_remote_files(self):
        if paramiko is None:
            raise RuntimeError("缺少依赖 paramiko，请先运行：pip install -r tools/requirements.txt")

        host = self.remote_host_var.get().strip()
        user = self.remote_user_var.get().strip()
        password = self.remote_password_var.get().strip()
        base_path = self.remote_base_path_var.get().strip().rstrip("/")
        if not host or not user or not password or not base_path:
            raise RuntimeError("云同步配置不完整（主机/用户/密码/远程路径）")

        upload_pairs = [
            (RESOURCES_PATH, f"{base_path}/src/data/resources.json"),
            (COLUMN_TAGS_PATH, f"{base_path}/src/data/columnTags.json"),
            (IMAGE_MAP_PATH, f"{base_path}/backend/config/image_map.json"),
            (RESOURCE_MAP_PATH, f"{base_path}/backend/config/resource_map.json"),
        ]
        self.log(f"开始同步云服务器：{user}@{host}")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(hostname=host, username=user, password=password, timeout=10)
        try:
            remote_dirs = {
                f"{base_path}/src/data",
                f"{base_path}/backend/config",
            }
            for remote_dir in sorted(remote_dirs):
                _, stdout, stderr = client.exec_command(f"mkdir -p '{remote_dir}'")
                _ = stdout.read()
                err = stderr.read().decode("utf-8", "ignore").strip()
                if err:
                    raise RuntimeError(f"创建远程目录失败: {err}")

            sftp = client.open_sftp()
            try:
                for local_path, remote_path in upload_pairs:
                    sftp.put(str(local_path), remote_path)
                    self.log(f"已上传到云服务器: {remote_path}")
            finally:
                sftp.close()

            if self.remote_restart_var.get():
                cmd = self.remote_restart_cmd_var.get().strip()
                if not cmd:
                    raise RuntimeError("已勾选重启，但重启命令为空")
                self.log(f"执行重启命令: {cmd}")
                _, stdout, stderr = client.exec_command(cmd)
                out = stdout.read().decode("utf-8", "ignore").strip()
                err = stderr.read().decode("utf-8", "ignore").strip()
                if out:
                    self.log(f"重启输出: {out}")
                if err:
                    self.log(f"重启输出(错误): {err}")
        finally:
            client.close()
        self.log("云服务器同步完成")

    def _preflight_remote_sync(self):
        if paramiko is None:
            raise RuntimeError("缺少依赖 paramiko，请先运行：pip install -r tools/requirements.txt")

        host = self.remote_host_var.get().strip()
        user = self.remote_user_var.get().strip()
        password = self.remote_password_var.get().strip()
        base_path = self.remote_base_path_var.get().strip().rstrip("/")
        if not host or not user or not password or not base_path:
            raise RuntimeError("云同步配置不完整（主机/用户/密码/远程路径）")

        self.log(f"开始云服务器预检：{user}@{host}")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(hostname=host, username=user, password=password, timeout=10)
        try:
            remote_dirs = (
                f"{base_path}/src/data",
                f"{base_path}/backend/config",
            )
            for remote_dir in remote_dirs:
                _, stdout, stderr = client.exec_command(f"mkdir -p '{remote_dir}'")
                _ = stdout.read()
                err = stderr.read().decode("utf-8", "ignore").strip()
                if err:
                    raise RuntimeError(f"云服务器预检失败，目录不可写: {err}")

            # 可选检查：若勾选了重启，提前确认 systemd 服务存在且状态可读。
            if self.remote_restart_var.get():
                _, stdout, stderr = client.exec_command("systemctl status jiadian-api.service >/dev/null 2>&1; echo $?")
                code_text = stdout.read().decode("utf-8", "ignore").strip()
                err = stderr.read().decode("utf-8", "ignore").strip()
                if err:
                    raise RuntimeError(f"云服务器预检失败（服务状态检查）: {err}")
                if code_text not in {"0", "3", "4"}:
                    raise RuntimeError("云服务器预检失败：无法确认 jiadian-api.service 状态")
        finally:
            client.close()
        self.log("云服务器预检通过")

    def refresh_delete_resource_list(self):
        resources = load_json(RESOURCES_PATH, [])
        if not isinstance(resources, list):
            resources = []
        selected_filter = self.delete_filter_var.get().strip() or "image"
        resources_sorted = sorted(
            [
                item
                for item in resources
                if isinstance(item, dict)
                and (
                    selected_filter == "all"
                    or str(item.get("materialType", "")).strip() == selected_filter
                )
            ],
            key=lambda x: int(x.get("id", 0)),
            reverse=True,
        )
        self.delete_resource_ids = []
        self.delete_listbox.delete(0, tk.END)
        for item in resources_sorted:
            rid = int(item.get("id", 0))
            title = str(item.get("title", "")).strip() or "(无标题)"
            material_type = str(item.get("materialType", "")).strip() or "-"
            self.delete_resource_ids.append(rid)
            self.delete_listbox.insert(tk.END, f"{rid} | {material_type} | {title}")

    def delete_selected_resources(self):
        selected_indices = list(self.delete_listbox.curselection())
        if not selected_indices:
            messagebox.showwarning("提示", "请先选择要删除的资源。")
            return

        selected_ids = [self.delete_resource_ids[i] for i in selected_indices if i < len(self.delete_resource_ids)]
        if not selected_ids:
            messagebox.showwarning("提示", "未识别到有效资源 ID。")
            return

        preview = "、".join(str(x) for x in selected_ids[:6])
        if len(selected_ids) > 6:
            preview += "..."
        confirmed = messagebox.askyesno("确认删除", f"确定删除 {len(selected_ids)} 条资源？\nID: {preview}")
        if not confirmed:
            return

        resources = load_json(RESOURCES_PATH, [])
        image_map = load_json(IMAGE_MAP_PATH, {})
        resource_map = load_json(RESOURCE_MAP_PATH, {})
        if not isinstance(resources, list) or not isinstance(image_map, dict) or not isinstance(resource_map, dict):
            messagebox.showerror("失败", "配置文件格式异常，请检查 resources.json / image_map.json / resource_map.json")
            return

        selected_set = {int(x) for x in selected_ids}
        original_count = len(resources)
        resources = [item for item in resources if not (isinstance(item, dict) and int(item.get("id", 0)) in selected_set)]
        removed_count = original_count - len(resources)
        for rid in selected_set:
            image_map.pop(str(rid), None)
            resource_map.pop(str(rid), None)

        save_json(RESOURCES_PATH, resources)
        save_json(IMAGE_MAP_PATH, image_map)
        save_json(RESOURCE_MAP_PATH, resource_map)
        self.log(f"删除资源 {removed_count} 条，已同步更新本地 JSON 映射")
        if self.auto_sync_var.get():
            self._sync_remote_files()
        self.refresh_delete_resource_list()
        messagebox.showinfo("完成", f"删除完成，共 {removed_count} 条。")

    def _parse_quota_int(self, raw: str, field_name: str, minimum: int = 0) -> int:
        text = (raw or "").strip()
        if not text:
            raise RuntimeError(f"{field_name} 不能为空")
        try:
            value = int(text)
        except ValueError as exc:
            raise RuntimeError(f"{field_name} 必须是整数") from exc
        if value < minimum:
            raise RuntimeError(f"{field_name} 不能小于 {minimum}")
        return value

    def _update_quota_remaining_display(self, used: int) -> None:
        remaining = remaining_shares(used, MAX_AI_SHARES_PER_DEVICE)
        self.quota_share_remaining_var.set(str(remaining))

    def _load_quota_fields_for_serial(self, serial: str) -> None:
        serial = normalize_serial(serial)
        if not serial:
            raise RuntimeError("请先填写设备 SN")
        credits_store = load_credits_store()
        share_store = load_share_store()
        credits = credit_balance(credits_store, serial)
        used = share_count(share_store, serial)
        self.quota_serial_var.set(serial)
        self.quota_credits_var.set(str(credits))
        self.quota_share_used_var.set(str(used))
        self.quota_share_limit_var.set(str(MAX_AI_SHARES_PER_DEVICE))
        self._update_quota_remaining_display(used)

    def lookup_quota_sn(self) -> None:
        try:
            self._load_quota_fields_for_serial(self.quota_serial_var.get())
            self.log(f"已查询 SN={normalize_serial(self.quota_serial_var.get())} 的配额")
        except Exception as exc:
            messagebox.showerror("查询失败", str(exc))

    def refresh_quota_list(self) -> None:
        credits_store = load_credits_store()
        share_store = load_share_store()
        serials = set()
        for key in (credits_store.get("balances") or {}).keys():
            serials.add(normalize_serial(str(key)))
        for key in (share_store.get("counts") or {}).keys():
            serials.add(normalize_serial(str(key)))
        serials.discard("")

        keyword = self.quota_filter_var.get().strip().upper()
        if keyword:
            serials = {serial for serial in serials if keyword in serial}

        self.quota_tree.delete(*self.quota_tree.get_children())
        for serial in sorted(serials):
            credits = credit_balance(credits_store, serial)
            used = share_count(share_store, serial)
            remaining = remaining_shares(used, MAX_AI_SHARES_PER_DEVICE)
            self.quota_tree.insert(
                "",
                "end",
                iid=serial,
                values=(serial, credits, used, remaining),
            )
        self.log(f"设备配额列表已刷新，共 {len(serials)} 条")

    def _on_quota_select(self, _event=None) -> None:
        selected = self.quota_tree.selection()
        if not selected:
            return
        try:
            self._load_quota_fields_for_serial(selected[0])
        except Exception as exc:
            messagebox.showerror("加载失败", str(exc))

    def _persist_quota_local(self) -> tuple[str, int, int]:
        serial = normalize_serial(self.quota_serial_var.get())
        if not serial:
            raise RuntimeError("请先填写设备 SN")
        credits = self._parse_quota_int(self.quota_credits_var.get(), "AI 积分", minimum=0)
        share_used = self._parse_quota_int(self.quota_share_used_var.get(), "已分享次数", minimum=0)
        if share_used > MAX_AI_SHARES_PER_DEVICE:
            raise RuntimeError(f"已分享次数不能超过上限 {MAX_AI_SHARES_PER_DEVICE}")

        credits_store = load_credits_store()
        share_store = load_share_store()
        credits_store.setdefault("balances", {})[serial] = credits
        share_store.setdefault("counts", {})[serial] = share_used
        save_credits_store(credits_store)
        save_share_store(share_store)
        self._update_quota_remaining_display(share_used)
        self.refresh_quota_list()
        self.log(f"已保存 SN={serial}：积分 {credits}，已分享 {share_used}")
        return serial, credits, share_used

    def save_quota_local(self) -> None:
        try:
            serial, credits, share_used = self._persist_quota_local()
            messagebox.showinfo(
                "完成",
                f"已保存到本地配置文件。\nSN: {serial}\n积分: {credits}\n已分享: {share_used}",
            )
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc))

    def save_quota_and_sync(self) -> None:
        try:
            serial, credits, share_used = self._persist_quota_local()
        except Exception as exc:
            messagebox.showerror("保存失败", str(exc))
            return
        try:
            restart = self.remote_restart_var.get()
            if not messagebox.askyesno(
                "确认同步",
                f"已保存 SN={serial}（积分 {credits}，已分享 {share_used}）。\n"
                "将上传到云服务器"
                + ("并执行重启命令。" if restart else "（未勾选重启，需手动重启 API 后线上才生效）"),
            ):
                return
            self._sync_quota_files(restart=restart)
            messagebox.showinfo("完成", "配额已同步到云服务器。")
        except Exception as exc:
            self.log(f"[错误] 同步配额失败: {exc}")
            messagebox.showerror("同步失败", str(exc))

    def _remote_quota_paths(self) -> tuple[str, str]:
        base_path = self.remote_base_path_var.get().strip().rstrip("/")
        if not base_path:
            raise RuntimeError("远程项目根目录不能为空")
        return (
            f"{base_path}/backend/config/ai_image_credits.json",
            f"{base_path}/backend/config/ai_image_share_counts.json",
        )

    def pull_quota_from_server(self) -> None:
        if paramiko is None:
            messagebox.showerror("失败", "缺少依赖 paramiko，请先运行：pip install -r tools/requirements.txt")
            return
        host = self.remote_host_var.get().strip()
        user = self.remote_user_var.get().strip()
        password = self.remote_password_var.get().strip()
        if not host or not user or not password:
            messagebox.showerror("失败", "请先在「上传与同步」页填写云服务器连接信息")
            return
        remote_credits, remote_shares = self._remote_quota_paths()
        try:
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            client.connect(hostname=host, username=user, password=password, timeout=10)
            try:
                sftp = client.open_sftp()
                try:
                    for remote_path, local_path, default in (
                        (remote_credits, AI_IMAGE_CREDITS_PATH, {"balances": {}}),
                        (remote_shares, AI_IMAGE_SHARES_PATH, {"counts": {}}),
                    ):
                        try:
                            sftp.get(remote_path, str(local_path))
                            self.log(f"已从服务器下载: {remote_path}")
                        except FileNotFoundError:
                            save_json(local_path, default)
                            self.log(f"服务器不存在 {remote_path}，已创建本地空配置")
                        except OSError as exc:
                            if getattr(exc, "errno", None) == 2:
                                save_json(local_path, default)
                                self.log(f"服务器不存在 {remote_path}，已创建本地空配置")
                            else:
                                raise
                finally:
                    sftp.close()
            finally:
                client.close()
            self.refresh_quota_list()
            if self.quota_serial_var.get().strip():
                self.lookup_quota_sn()
            messagebox.showinfo("完成", "已从云服务器拉取配额配置到本地。")
        except Exception as exc:
            self.log(f"[错误] 拉取配额失败: {exc}")
            messagebox.showerror("拉取失败", str(exc))

    def _sync_quota_files(self, restart: bool = False) -> None:
        if paramiko is None:
            raise RuntimeError("缺少依赖 paramiko，请先运行：pip install -r tools/requirements.txt")
        host = self.remote_host_var.get().strip()
        user = self.remote_user_var.get().strip()
        password = self.remote_password_var.get().strip()
        base_path = self.remote_base_path_var.get().strip().rstrip("/")
        if not host or not user or not password or not base_path:
            raise RuntimeError("云同步配置不完整（主机/用户/密码/远程路径）")

        remote_credits, remote_shares = self._remote_quota_paths()
        upload_pairs = [
            (AI_IMAGE_CREDITS_PATH, remote_credits),
            (AI_IMAGE_SHARES_PATH, remote_shares),
        ]
        for local_path, _remote_path in upload_pairs:
            if not local_path.is_file():
                save_json(local_path, {"balances": {}} if "credits" in local_path.name else {"counts": {}})

        self.log(f"开始同步设备配额：{user}@{host}")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(hostname=host, username=user, password=password, timeout=10)
        try:
            _, stdout, stderr = client.exec_command(f"mkdir -p '{base_path}/backend/config'")
            _ = stdout.read()
            err = stderr.read().decode("utf-8", "ignore").strip()
            if err:
                raise RuntimeError(f"创建远程目录失败: {err}")

            sftp = client.open_sftp()
            try:
                for local_path, remote_path in upload_pairs:
                    sftp.put(str(local_path), remote_path)
                    self.log(f"已上传配额文件: {remote_path}")
            finally:
                sftp.close()

            if restart:
                cmd = self.remote_restart_cmd_var.get().strip()
                if not cmd:
                    raise RuntimeError("已请求重启，但重启命令为空")
                self.log(f"执行重启命令: {cmd}")
                _, stdout, stderr = client.exec_command(cmd)
                out = stdout.read().decode("utf-8", "ignore").strip()
                err = stderr.read().decode("utf-8", "ignore").strip()
                if out:
                    self.log(f"重启输出: {out}")
                if err:
                    self.log(f"重启输出(错误): {err}")
        finally:
            client.close()
        self.log("设备配额同步完成")

    def reset_share_for_sn(self) -> None:
        serial = normalize_serial(self.quota_serial_var.get())
        if not serial:
            messagebox.showerror("失败", "请先填写设备 SN")
            return
        if not messagebox.askyesno("确认重置", f"确定将 SN={serial} 的已分享次数重置为 0 吗？"):
            return
        self.quota_share_used_var.set("0")
        self._update_quota_remaining_display(0)
        try:
            share_store = load_share_store()
            share_store.setdefault("counts", {})[serial] = 0
            save_share_store(share_store)
            self.refresh_quota_list()
            self.log(f"已重置 SN={serial} 的分享次数")
            messagebox.showinfo("完成", "分享次数已重置为 0（仅本地）。如需线上生效请点「保存并同步云服务器」。")
        except Exception as exc:
            messagebox.showerror("失败", str(exc))

    def upload_and_sync(self):
        try:
            material_type = self.material_type_var.get().strip() or "image"
            media_paths = parse_media_paths(self.media_path_var.get().strip())
            if not media_paths:
                raise RuntimeError("请先选择有效主文件")

            is_batch = len(media_paths) > 1
            title_input = self.title_var.get().strip()
            desc_input = self.desc_var.get().strip()
            author_input = self.author_var.get().strip()
            column_tag_input = self.get_selected_column_tag_id()
            if not is_batch and material_type != "gif" and (not title_input or not desc_input):
                raise RuntimeError("标题和描述不能为空")
            if is_batch and material_type == "gif" and (self.cover_path_var.get().strip() or self.cover_url_var.get().strip()):
                self.log("批量 GIF 模式已忽略手动封面设置，将自动提取每个 GIF 第一帧。")

            resources = load_json(RESOURCES_PATH, [])
            image_map = load_json(IMAGE_MAP_PATH, {})
            resource_map = load_json(RESOURCE_MAP_PATH, {})
            if not isinstance(resources, list) or not isinstance(image_map, dict) or not isinstance(resource_map, dict):
                raise RuntimeError("配置文件格式异常，请检查 resources.json / image_map.json / resource_map.json")

            existing_ids = {item.get("id") for item in resources if isinstance(item, dict)}
            uploaded_ids: list[int] = []
            cover_path_raw = self.cover_path_var.get().strip()
            cover_url_fallback = self.cover_url_var.get().strip()
            shared_download_url = strip_public_object_url(self.download_var.get().strip())

            if material_type == "video":
                if cover_path_raw and not Path(cover_path_raw).exists():
                    raise RuntimeError("选择的视频封面文件不存在")
                if self.auto_sync_var.get():
                    self._preflight_remote_sync()

            for media_path in media_paths:
                if not media_path.exists():
                    self.log(f"[跳过] 文件不存在: {media_path}")
                    continue

                suffix = random_code(8)
                rid = make_resource_id(suffix)
                while rid in existing_ids:
                    suffix = random_code(8)
                    rid = make_resource_id(suffix)
                existing_ids.add(rid)
                self.id_var.set(str(rid))
                self.random_code_var.set(suffix)
                self.log(f"随机码: {suffix}")

                image_key = ""
                download_url = shared_download_url

                if material_type == "video":
                    video_bucket = self.video_bucket_var.get().strip()
                    video_region = self.video_region_var.get().strip()
                    if not video_bucket:
                        raise RuntimeError("视频 Bucket 不能为空")
                    cover_bucket = self.video_cover_bucket_var.get().strip()
                    cover_region = self.video_cover_region_var.get().strip()
                    if not cover_bucket:
                        raise RuntimeError("视频封面 Bucket 不能为空")

                    auto_cover_bytes = None
                    if not cover_path_raw and not cover_url_fallback:
                        self.log("未提供视频封面，先尝试自动提取第一帧...")
                        auto_cover_bytes = extract_video_first_frame_jpeg_bytes(media_path)

                    video_ext = media_path.suffix.lower() or ".mp4"
                    video_key = make_object_key(suffix, video_ext, "vid")
                    self.log(f"开始上传视频 -> COS: {video_bucket}/{video_key}")
                    video_client = self._build_cos_client(video_region)
                    with media_path.open("rb") as f:
                        video_client.put_object(Bucket=video_bucket, Body=f, Key=video_key)
                    self.log("视频上传成功")
                    resource_map[str(rid)] = video_key

                    if cover_path_raw:
                        cover_path = Path(cover_path_raw)
                        if not cover_path.exists():
                            raise RuntimeError("选择的视频封面文件不存在")
                        cover_code = random_code(8)
                        cover_ext = cover_path.suffix.lower() or ".jpg"
                        image_key = make_object_key(cover_code, cover_ext, "cover")
                        self.log(f"开始上传视频封面 -> COS: {cover_bucket}/{image_key}")
                        cover_client = self._build_cos_client(cover_region)
                        with cover_path.open("rb") as f:
                            cover_client.put_object(Bucket=cover_bucket, Body=f, Key=image_key)
                        self.log("视频封面上传成功")
                        image_map[str(rid)] = image_key
                    elif cover_url_fallback:
                        image_key = cover_url_fallback
                        image_map.pop(str(rid), None)
                    else:
                        cover_code = random_code(8)
                        image_key = make_object_key(cover_code, ".jpg", "cover")
                        self.log(f"未提供视频封面，自动提取第一帧并上传 -> {cover_bucket}/{image_key}")
                        cover_client = self._build_cos_client(cover_region)
                        cover_client.put_object(Bucket=cover_bucket, Body=auto_cover_bytes, Key=image_key)
                        image_map[str(rid)] = image_key

                    if not download_url:
                        download_url = video_key

                elif material_type == "gif":
                    gif_bucket = self.gif_bucket_var.get().strip()
                    gif_region = self.gif_region_var.get().strip()
                    if not gif_bucket:
                        raise RuntimeError("GIF Bucket 不能为空")
                    gif_ext = media_path.suffix.lower() or ".gif"
                    gif_key = make_object_key(suffix, gif_ext, "gif")
                    self.log(f"开始上传GIF -> COS: {gif_bucket}/{gif_key}")
                    gif_client = self._build_cos_client(gif_region)
                    with media_path.open("rb") as f:
                        gif_client.put_object(Bucket=gif_bucket, Body=f, Key=gif_key)
                    self.log("GIF上传成功")
                    resource_map[str(rid)] = gif_key

                    if not is_batch and cover_path_raw:
                        cover_path = Path(cover_path_raw)
                        if not cover_path.exists():
                            raise RuntimeError("选择的GIF封面文件不存在")
                        cover_code = random_code(8)
                        cover_ext = cover_path.suffix.lower() or ".jpg"
                        image_key = make_object_key(cover_code, cover_ext, "gif_cover")
                        cover_bucket = self.gif_cover_bucket_var.get().strip()
                        cover_region = self.gif_cover_region_var.get().strip()
                        if not cover_bucket:
                            raise RuntimeError("GIF封面 Bucket 不能为空")
                        self.log(f"开始上传GIF封面 -> COS: {cover_bucket}/{image_key}")
                        cover_client = self._build_cos_client(cover_region)
                        with cover_path.open("rb") as f:
                            cover_client.put_object(Bucket=cover_bucket, Body=f, Key=image_key)
                        self.log("GIF封面上传成功")
                        image_map[str(rid)] = image_key
                    elif not is_batch and cover_url_fallback:
                        image_key = cover_url_fallback
                        image_map.pop(str(rid), None)
                    else:
                        cover_code = random_code(8)
                        image_key = make_object_key(cover_code, ".jpg", "gif_cover")
                        cover_bucket = self.gif_cover_bucket_var.get().strip()
                        cover_region = self.gif_cover_region_var.get().strip()
                        if not cover_bucket:
                            raise RuntimeError("GIF封面 Bucket 不能为空")
                        self.log(f"自动提取第一帧并上传封面 -> {cover_bucket}/{image_key}")
                        cover_client = self._build_cos_client(cover_region)
                        cover_bytes = extract_gif_first_frame_jpeg_bytes(media_path)
                        cover_client.put_object(Bucket=cover_bucket, Body=cover_bytes, Key=image_key)
                        image_map[str(rid)] = image_key

                    if not download_url:
                        download_url = gif_key

                elif material_type == "software":
                    if media_path.suffix.lower() != ".exe":
                        raise RuntimeError(f"软件安装包必须是 .exe 文件: {media_path.name}")

                    software_bucket = self.software_bucket_var.get().strip()
                    software_region = self.software_region_var.get().strip()
                    if not software_bucket:
                        raise RuntimeError("软件 Bucket 不能为空")

                    software_key = media_path.name
                    self.log(f"开始上传软件 -> COS: {software_bucket}/{software_key}")
                    software_client = self._build_cos_client(software_region)
                    with media_path.open("rb") as f:
                        software_client.put_object(Bucket=software_bucket, Body=f, Key=software_key)
                    self.log("软件上传成功")
                    resource_map[str(rid)] = software_key

                    if cover_path_raw:
                        cover_path = Path(cover_path_raw)
                        if not cover_path.exists():
                            raise RuntimeError("选择的软件封面文件不存在")
                        cover_code = random_code(8)
                        cover_ext = cover_path.suffix.lower() or ".png"
                        image_key = make_object_key(cover_code, cover_ext, "sw_cover")
                        image_bucket = self.bucket_var.get().strip()
                        image_region = self.region_var.get().strip()
                        if not image_bucket:
                            raise RuntimeError("图片 Bucket 不能为空（用于软件封面）")
                        self.log(f"开始上传软件封面 -> COS: {image_bucket}/{image_key}")
                        cover_client = self._build_cos_client(image_region)
                        with cover_path.open("rb") as f:
                            cover_client.put_object(Bucket=image_bucket, Body=f, Key=image_key)
                        self.log("软件封面上传成功")
                        image_map[str(rid)] = image_key
                    elif cover_url_fallback:
                        image_key = cover_url_fallback
                        image_map.pop(str(rid), None)
                    else:
                        image_key = "1.png"

                    if not download_url:
                        download_url = software_key

                else:
                    image_bucket = self.bucket_var.get().strip()
                    image_region = self.region_var.get().strip()
                    if not image_bucket:
                        raise RuntimeError("图片 Bucket 不能为空")
                    image_ext = media_path.suffix.lower() or ".png"
                    image_key = make_object_key(suffix, image_ext, "img")
                    self.log(f"开始上传图片 -> COS: {image_bucket}/{image_key}")
                    image_client = self._build_cos_client(image_region)
                    with media_path.open("rb") as f:
                        image_client.put_object(Bucket=image_bucket, Body=f, Key=image_key)
                    self.log("图片上传成功")
                    image_map[str(rid)] = image_key
                    resource_map.pop(str(rid), None)
                    if not download_url:
                        download_url = image_key

                uploaded_at = datetime.now().astimezone().isoformat(timespec="seconds")
                if material_type == "software":
                    size = format_file_size(media_path.stat().st_size)
                    category = "software"
                    stored_material_type = "v1pro-pack"
                    filename = media_path.stem
                    title = media_path.name if is_batch else (title_input or media_path.name)
                    desc = f"{media_path.stem} 安装包" if is_batch else (desc_input or f"{media_path.stem} 安装包")
                else:
                    size = self.size_var.get().strip() or ("30MB" if material_type in ("image", "gif") else "未知")
                    category = self.category_var.get().strip() or "gif"
                    stored_material_type = material_type
                    filename = media_path.stem
                    title = filename if is_batch or material_type == "gif" else title_input
                    desc = filename if is_batch or material_type == "gif" else desc_input

                target = {"id": rid}
                target["title"] = title
                target["description"] = desc
                if author_input:
                    target["author"] = author_input
                if column_tag_input:
                    target["columnTag"] = column_tag_input
                target["size"] = size
                target["image"] = image_key
                target["download"] = download_url
                target["category"] = category
                target["materialType"] = stored_material_type
                target["updatedAt"] = uploaded_at
                resources.append(target)
                uploaded_ids.append(rid)
                self.log(f"新增资源 ID={rid}（{filename}）")

            if not uploaded_ids:
                raise RuntimeError("没有可上传的有效文件")

            resources.sort(key=lambda x: int(x.get("id", 0)))
            save_json(RESOURCES_PATH, resources)
            save_json(IMAGE_MAP_PATH, image_map)
            save_json(RESOURCE_MAP_PATH, resource_map)
            self.log("已同步更新 resources.json / image_map.json / resource_map.json")
            if self.auto_sync_var.get():
                self._sync_remote_files()
            self.refresh_delete_resource_list()

            if is_batch:
                messagebox.showinfo("完成", f"批量上传成功，共 {len(uploaded_ids)} 条。")
            else:
                messagebox.showinfo(
                    "完成",
                    "上传并同步成功。\n\n已更新本地映射；若勾选自动同步，已推送到云服务器。",
                )
            self.regenerate_random_code()
        except Exception as e:
            self.log(f"[错误] {e}")
            messagebox.showerror("失败", str(e))

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    ImageUploaderGUI().run()
