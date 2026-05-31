import json
import io
import os
import secrets
from datetime import datetime
from pathlib import Path
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


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RESOURCES_PATH = PROJECT_ROOT / "src" / "data" / "resources.json"
IMAGE_MAP_PATH = PROJECT_ROOT / "backend" / "config" / "image_map.json"
RESOURCE_MAP_PATH = PROJECT_ROOT / "backend" / "config" / "resource_map.json"


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
            value=os.getenv("VIDEO_COVER_COS_BUCKET", os.getenv("IMAGE_COS_BUCKET", "v1image-1311844229"))
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

        self.material_type_var = tk.StringVar(value="image")
        self.media_path_var = tk.StringVar()
        self.cover_path_var = tk.StringVar()
        self.id_var = tk.StringVar()
        self.title_var = tk.StringVar()
        self.desc_var = tk.StringVar()
        self.size_var = tk.StringVar(value="未知")
        self.category_var = tk.StringVar(value="gif")
        self.download_var = tk.StringVar()
        self.cover_url_var = tk.StringVar()
        self.random_code_var = tk.StringVar(value=random_code(8))

        self._build_ui()
        self.regenerate_random_code()
        self.material_type_var.trace_add("write", lambda *_: self._on_material_type_change())

    def _build_ui(self):
        top = ttk.LabelFrame(self.root, text="COS 配置（单独处理图片/视频/GIF）", padding=10)
        top.pack(fill=tk.X, padx=12, pady=(12, 8))
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

        resource = ttk.LabelFrame(self.root, text="素材信息", padding=10)
        resource.pack(fill=tk.X, padx=12, pady=(0, 8))
        resource.columnconfigure(1, weight=1)
        resource.columnconfigure(3, weight=1)

        ttk.Label(resource, text="素材类型").grid(row=0, column=0, sticky="w", pady=2)
        ttk.Combobox(
            resource,
            textvariable=self.material_type_var,
            values=("image", "video", "gif"),
            state="readonly",
        ).grid(row=0, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(resource, text="分类").grid(row=0, column=2, sticky="w", pady=2)
        ttk.Combobox(resource, textvariable=self.category_var, values=("gif", "driver", "firmware", "software", "manual"), state="readonly").grid(
            row=0, column=3, sticky="ew", pady=2
        )

        ttk.Label(resource, text="主文件").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.media_path_var).grid(row=1, column=1, columnspan=2, sticky="ew", padx=(8, 8), pady=2)
        ttk.Button(resource, text="选择文件", command=self.choose_media).grid(row=1, column=3, sticky="ew", pady=2)

        ttk.Label(resource, text="视频/GIF封面文件(可选)").grid(row=2, column=0, sticky="w", pady=2)
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

        ttk.Label(resource, text="下载链接(可空，默认按素材类型生成)").grid(row=5, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.download_var).grid(row=5, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(resource, text="封面链接(视频/GIF且不上传封面时可填)").grid(row=6, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.cover_url_var).grid(row=6, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(resource, text="随机码(自动生成)").grid(row=7, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.random_code_var, state="readonly").grid(
            row=7, column=1, sticky="ew", padx=(8, 12), pady=2
        )
        ttk.Button(resource, text="重新生成", command=self.regenerate_random_code).grid(row=7, column=2, columnspan=2, sticky="ew", pady=2)

        actions = ttk.Frame(self.root)
        actions.pack(fill=tk.X, padx=12, pady=(0, 8))
        ttk.Button(actions, text="上传并同步显示", command=self.upload_and_sync).pack(side=tk.LEFT)
        ttk.Label(
            actions,
            text="说明：图片仅更新 image_map；视频/GIF更新 resource_map；封面按配置写入 image_map。",
        ).pack(side=tk.LEFT, padx=12)

        log_frame = ttk.LabelFrame(self.root, text="日志", padding=10)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 12))
        self.log_text = tk.Text(log_frame, height=14, wrap=tk.WORD)
        self.log_text.pack(fill=tk.BOTH, expand=True)

    def log(self, text: str):
        self.log_text.insert(tk.END, f"{text}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()

    def choose_media(self):
        material_type = self.material_type_var.get().strip()
        if material_type == "video":
            filetypes = [("Video Files", "*.mp4;*.mov;*.m4v;*.avi;*.mkv;*.webm;*.flv")]
            title = "选择视频文件"
        elif material_type == "gif":
            filetypes = [("GIF Files", "*.gif")]
            title = "选择 GIF 文件"
        else:
            filetypes = [("Image Files", "*.png;*.jpg;*.jpeg;*.webp;*.bmp")]
            title = "选择图片文件"
        path = filedialog.askopenfilename(title=title, filetypes=filetypes)
        if path:
            self.media_path_var.set(path)
            if not self.title_var.get().strip():
                self.title_var.set(Path(path).stem)

    def choose_cover(self):
        path = filedialog.askopenfilename(
            title="选择视频或GIF封面",
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

    def upload_and_sync(self):
        try:
            material_type = self.material_type_var.get().strip() or "image"
            media_path = Path(self.media_path_var.get().strip())
            if not media_path.exists():
                raise RuntimeError("请先选择有效主文件")

            title = self.title_var.get().strip()
            desc = self.desc_var.get().strip()
            if not title or not desc:
                raise RuntimeError("标题和描述不能为空")

            resources = load_json(RESOURCES_PATH, [])
            image_map = load_json(IMAGE_MAP_PATH, {})
            resource_map = load_json(RESOURCE_MAP_PATH, {})
            if not isinstance(resources, list) or not isinstance(image_map, dict) or not isinstance(resource_map, dict):
                raise RuntimeError("配置文件格式异常，请检查 resources.json / image_map.json / resource_map.json")

            rid = make_resource_id(self.random_code_var.get().strip())
            existing_ids = {item.get("id") for item in resources if isinstance(item, dict)}
            while rid in existing_ids:
                self.regenerate_random_code()
                rid = make_resource_id(self.random_code_var.get().strip())
            self.id_var.set(str(rid))

            suffix = self.random_code_var.get().strip() or random_code(8)
            self.random_code_var.set(suffix)
            self.log(f"随机码: {suffix}")

            image_key = ""
            download_url = self.download_var.get().strip()

            if material_type == "video":
                video_bucket = self.video_bucket_var.get().strip()
                video_region = self.video_region_var.get().strip()
                if not video_bucket:
                    raise RuntimeError("视频 Bucket 不能为空")
                video_ext = media_path.suffix.lower() or ".mp4"
                video_key = make_object_key(suffix, video_ext, "vid")
                self.log(f"开始上传视频 -> COS: {video_bucket}/{video_key}")
                video_client = self._build_cos_client(video_region)
                with media_path.open("rb") as f:
                    video_client.put_object(Bucket=video_bucket, Body=f, Key=video_key)
                self.log("视频上传成功")
                resource_map[str(rid)] = video_key

                cover_path_raw = self.cover_path_var.get().strip()
                cover_url_fallback = self.cover_url_var.get().strip()
                if cover_path_raw:
                    cover_path = Path(cover_path_raw)
                    if not cover_path.exists():
                        raise RuntimeError("选择的视频封面文件不存在")
                    cover_code = random_code(8)
                    cover_ext = cover_path.suffix.lower() or ".jpg"
                    image_key = make_object_key(cover_code, cover_ext, "cover")
                    cover_bucket = self.video_cover_bucket_var.get().strip()
                    cover_region = self.video_cover_region_var.get().strip()
                    if not cover_bucket:
                        raise RuntimeError("视频封面 Bucket 不能为空")
                    self.log(f"开始上传视频封面 -> COS: {cover_bucket}/{image_key}")
                    cover_client = self._build_cos_client(cover_region)
                    with cover_path.open("rb") as f:
                        cover_client.put_object(Bucket=cover_bucket, Body=f, Key=image_key)
                    self.log("视频封面上传成功")
                    image_map[str(rid)] = image_key
                else:
                    if not cover_url_fallback:
                        raise RuntimeError("视频素材请上传封面图，或填写封面链接")
                    image_key = cover_url_fallback
                    image_map.pop(str(rid), None)

                if not download_url:
                    video_base = self.video_public_base_var.get().strip().rstrip("/")
                    download_url = f"{video_base}/{video_key}" if video_base else video_key
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

                cover_path_raw = self.cover_path_var.get().strip()
                cover_url_fallback = self.cover_url_var.get().strip()
                if cover_path_raw:
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
                elif cover_url_fallback:
                    image_key = cover_url_fallback
                    image_map.pop(str(rid), None)
                else:
                    cover_code = random_code(8)
                    image_key = make_object_key(cover_code, ".jpg", "gif_cover")
                    cover_bucket = self.gif_cover_bucket_var.get().strip()
                    cover_region = self.gif_cover_region_var.get().strip()
                    if not cover_bucket:
                        raise RuntimeError("GIF封面 Bucket 不能为空")
                    self.log(f"未提供封面，自动提取GIF第一帧并上传 -> {cover_bucket}/{image_key}")
                    cover_client = self._build_cos_client(cover_region)
                    cover_bytes = extract_gif_first_frame_jpeg_bytes(media_path)
                    cover_client.put_object(Bucket=cover_bucket, Body=cover_bytes, Key=image_key)
                    image_map[str(rid)] = image_key

                if not download_url:
                    gif_base = self.gif_public_base_var.get().strip().rstrip("/")
                    download_url = f"{gif_base}/{gif_key}" if gif_base else gif_key
            else:
                image_bucket = self.bucket_var.get().strip()
                image_region = self.region_var.get().strip()
                if not image_bucket:
                    raise RuntimeError("图片 Bucket 不能为空")
                image_ext = media_path.suffix.lower() or (".gif" if material_type == "gif" else ".png")
                object_prefix = "gif" if material_type == "gif" else "img"
                image_key = make_object_key(suffix, image_ext, object_prefix)
                upload_label = "GIF" if material_type == "gif" else "图片"
                self.log(f"开始上传{upload_label} -> COS: {image_bucket}/{image_key}")
                image_client = self._build_cos_client(image_region)
                with media_path.open("rb") as f:
                    image_client.put_object(Bucket=image_bucket, Body=f, Key=image_key)
                self.log(f"{upload_label}上传成功")
                image_map[str(rid)] = image_key
                resource_map.pop(str(rid), None)
                if not download_url:
                    image_base = self.image_public_base_var.get().strip().rstrip("/")
                    download_url = f"{image_base}/{image_key}" if image_base else image_key

            uploaded_at = datetime.now().astimezone().isoformat(timespec="seconds")
            size = self.size_var.get().strip() or "未知"
            category = self.category_var.get().strip() or "gif"

            target = None
            for item in resources:
                if item.get("id") == rid:
                    target = item
                    break

            if target is None:
                target = {"id": rid}
                resources.append(target)
                self.log(f"新增资源 ID={rid}")
            else:
                self.log(f"更新资源 ID={rid}")

            target["title"] = title
            target["description"] = desc
            target["size"] = size
            target["image"] = image_key
            target["download"] = download_url
            target["category"] = category
            target["materialType"] = material_type
            target["updatedAt"] = uploaded_at

            resources.sort(key=lambda x: int(x.get("id", 0)))
            save_json(RESOURCES_PATH, resources)
            save_json(IMAGE_MAP_PATH, image_map)
            save_json(RESOURCE_MAP_PATH, resource_map)
            self.log("已同步更新 resources.json / image_map.json / resource_map.json")

            messagebox.showinfo(
                "完成",
                "上传并同步成功。\n\n若后端正在运行，请重启后端使 map 生效；\n若线上已部署，请把改动部署到服务器。",
            )
            self.regenerate_random_code()
        except Exception as e:
            self.log(f"[错误] {e}")
            messagebox.showerror("失败", str(e))

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    ImageUploaderGUI().run()
