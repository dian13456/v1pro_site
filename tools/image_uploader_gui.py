import json
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


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RESOURCES_PATH = PROJECT_ROOT / "src" / "data" / "resources.json"
IMAGE_MAP_PATH = PROJECT_ROOT / "backend" / "config" / "image_map.json"


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


class ImageUploaderGUI:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("V1PRO 图片上传与同步工具")
        self.root.geometry("760x560")
        self.root.minsize(720, 520)

        self.secret_id_var = tk.StringVar(value=os.getenv("IMAGE_COS_SECRET_ID", os.getenv("COS_SECRET_ID", "")))
        self.secret_key_var = tk.StringVar(value=os.getenv("IMAGE_COS_SECRET_KEY", os.getenv("COS_SECRET_KEY", "")))
        self.bucket_var = tk.StringVar(value=os.getenv("IMAGE_COS_BUCKET", "v1image-1311844229"))
        self.region_var = tk.StringVar(value=os.getenv("IMAGE_COS_REGION", "ap-guangzhou"))
        self.image_public_base_var = tk.StringVar(
            value=os.getenv("IMAGE_COS_PUBLIC_BASE", "https://v1image-1311844229.cos.ap-guangzhou.myqcloud.com")
        )

        self.image_path_var = tk.StringVar()
        self.id_var = tk.StringVar()
        self.title_var = tk.StringVar()
        self.desc_var = tk.StringVar()
        self.size_var = tk.StringVar(value="30MB")
        self.category_var = tk.StringVar(value="gif")
        self.download_var = tk.StringVar()
        self.random_code_var = tk.StringVar(value=random_code(8))

        self._build_ui()
        self.regenerate_random_code()

    def _build_ui(self):
        top = ttk.LabelFrame(self.root, text="COS 配置（图片桶）", padding=10)
        top.pack(fill=tk.X, padx=12, pady=(12, 8))
        top.columnconfigure(1, weight=1)
        top.columnconfigure(3, weight=1)

        ttk.Label(top, text="SecretId").grid(row=0, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.secret_id_var).grid(row=0, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="SecretKey").grid(row=0, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.secret_key_var, show="*").grid(row=0, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="Bucket").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.bucket_var).grid(row=1, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(top, text="Region").grid(row=1, column=2, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.region_var).grid(row=1, column=3, sticky="ew", pady=2)

        ttk.Label(top, text="图片公网前缀").grid(row=2, column=0, sticky="w", pady=2)
        ttk.Entry(top, textvariable=self.image_public_base_var).grid(row=2, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        resource = ttk.LabelFrame(self.root, text="素材信息", padding=10)
        resource.pack(fill=tk.X, padx=12, pady=(0, 8))
        resource.columnconfigure(1, weight=1)
        resource.columnconfigure(3, weight=1)

        ttk.Label(resource, text="图片文件").grid(row=0, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.image_path_var).grid(row=0, column=1, columnspan=2, sticky="ew", padx=(8, 8), pady=2)
        ttk.Button(resource, text="选择图片", command=self.choose_image).grid(row=0, column=3, sticky="ew", pady=2)

        ttk.Label(resource, text="资源 ID").grid(row=1, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.id_var, state="readonly").grid(row=1, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(resource, text="分类").grid(row=1, column=2, sticky="w", pady=2)
        ttk.Combobox(resource, textvariable=self.category_var, values=("gif", "driver", "firmware", "software", "manual"), state="readonly").grid(
            row=1, column=3, sticky="ew", pady=2
        )

        ttk.Label(resource, text="标题").grid(row=2, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.title_var).grid(row=2, column=1, sticky="ew", padx=(8, 12), pady=2)
        ttk.Label(resource, text="大小").grid(row=2, column=2, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.size_var).grid(row=2, column=3, sticky="ew", pady=2)

        ttk.Label(resource, text="描述").grid(row=3, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.desc_var).grid(row=3, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(resource, text="下载链接(可空，默认同图片桶)").grid(row=4, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.download_var).grid(row=4, column=1, columnspan=3, sticky="ew", padx=(8, 0), pady=2)

        ttk.Label(resource, text="随机码(自动生成)").grid(row=5, column=0, sticky="w", pady=2)
        ttk.Entry(resource, textvariable=self.random_code_var, state="readonly").grid(
            row=5, column=1, sticky="ew", padx=(8, 12), pady=2
        )
        ttk.Button(resource, text="重新生成", command=self.regenerate_random_code).grid(row=5, column=2, columnspan=2, sticky="ew", pady=2)

        actions = ttk.Frame(self.root)
        actions.pack(fill=tk.X, padx=12, pady=(0, 8))
        ttk.Button(actions, text="上传并同步显示", command=self.upload_and_sync).pack(side=tk.LEFT)
        ttk.Label(
            actions,
            text="说明：会更新 src/data/resources.json 和 backend/config/image_map.json",
        ).pack(side=tk.LEFT, padx=12)

        log_frame = ttk.LabelFrame(self.root, text="日志", padding=10)
        log_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 12))
        self.log_text = tk.Text(log_frame, height=14, wrap=tk.WORD)
        self.log_text.pack(fill=tk.BOTH, expand=True)

    def log(self, text: str):
        self.log_text.insert(tk.END, f"{text}\n")
        self.log_text.see(tk.END)
        self.root.update_idletasks()

    def choose_image(self):
        path = filedialog.askopenfilename(
            title="选择图片",
            filetypes=[("Image Files", "*.png;*.jpg;*.jpeg;*.webp;*.bmp")],
        )
        if path:
            self.image_path_var.set(path)
            if not self.title_var.get().strip():
                self.title_var.set(Path(path).stem)

    def regenerate_random_code(self):
        code = random_code(8)
        self.random_code_var.set(code)
        self.id_var.set(str(make_resource_id(code)))

    def _build_cos_client(self):
        if CosConfig is None or CosS3Client is None:
            raise RuntimeError("缺少依赖 qcloud_cos，请先运行：pip install -r tools/requirements.txt")
        secret_id = self.secret_id_var.get().strip()
        secret_key = self.secret_key_var.get().strip()
        region = self.region_var.get().strip()
        if not secret_id or not secret_key or not region:
            raise RuntimeError("COS 配置不完整（SecretId / SecretKey / Region）")
        config = CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key, Token=None, Scheme="https")
        return CosS3Client(config)

    def upload_and_sync(self):
        try:
            image_path = Path(self.image_path_var.get().strip())
            if not image_path.exists():
                raise RuntimeError("请先选择有效图片文件")

            title = self.title_var.get().strip()
            desc = self.desc_var.get().strip()
            if not title or not desc:
                raise RuntimeError("标题和描述不能为空")

            resources = load_json(RESOURCES_PATH, [])
            image_map = load_json(IMAGE_MAP_PATH, {})
            if not isinstance(resources, list) or not isinstance(image_map, dict):
                raise RuntimeError("配置文件格式异常，请检查 resources.json / image_map.json")

            rid = make_resource_id(self.random_code_var.get().strip())
            existing_ids = {item.get("id") for item in resources if isinstance(item, dict)}
            while rid in existing_ids:
                self.regenerate_random_code()
                rid = make_resource_id(self.random_code_var.get().strip())
            self.id_var.set(str(rid))

            ext = image_path.suffix.lower() or ".png"
            suffix = self.random_code_var.get().strip() or random_code(8)
            self.random_code_var.set(suffix)
            object_key = f"{suffix}{ext}"
            bucket = self.bucket_var.get().strip()
            if not bucket:
                raise RuntimeError("Bucket 不能为空")

            self.log(f"开始上传图片 -> COS: {bucket}/{object_key}")
            self.log(f"随机码: {suffix}")
            client = self._build_cos_client()
            with image_path.open("rb") as f:
                client.put_object(
                    Bucket=bucket,
                    Body=f,
                    Key=object_key,
                )
            self.log("图片上传成功")

            image_map[str(rid)] = object_key

            uploaded_at = datetime.now().astimezone().isoformat(timespec="seconds")
            size = self.size_var.get().strip() or "未知"
            category = self.category_var.get().strip() or "gif"
            download_url = self.download_var.get().strip()
            if not download_url:
                image_base = self.image_public_base_var.get().strip().rstrip("/")
                download_url = f"{image_base}/{object_key}" if image_base else object_key

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
            target["image"] = object_key
            target["download"] = download_url
            target["category"] = category
            target["materialType"] = "image"
            target["updatedAt"] = uploaded_at

            resources.sort(key=lambda x: int(x.get("id", 0)))
            save_json(RESOURCES_PATH, resources)
            save_json(IMAGE_MAP_PATH, image_map)
            self.log("已同步更新 resources.json 与 image_map.json")

            messagebox.showinfo(
                "完成",
                "上传并同步成功。\n\n若后端正在运行，请重启后端使 image_map 生效；\n若线上已部署，请把改动部署到服务器。",
            )
            self.regenerate_random_code()
        except Exception as e:
            self.log(f"[错误] {e}")
            messagebox.showerror("失败", str(e))

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    ImageUploaderGUI().run()
