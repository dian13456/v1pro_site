#!/usr/bin/env python3
"""Build and sync dist/ to COS static website bucket."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosClientError, CosServiceError

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "backend" / ".env"
DIST_DIR = ROOT / "dist"
DEFAULT_BUCKET = "my-website-1311844229"
DEFAULT_REGION = "ap-guangzhou"


def load_env(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    if not path.is_file():
        return data
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def build_frontend() -> None:
    env = os.environ.copy()
    env.setdefault("VITE_BASE_PATH", "/")
    env.setdefault("VITE_API_BASE", "https://api.jadot.cn:8443")
    env.setdefault("VITE_STATIC_MODE", "false")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    subprocess.run([npm, "run", "build"], cwd=ROOT, env=env, check=True)


def iter_dist_files(dist_dir: Path) -> list[tuple[Path, str]]:
    pairs: list[tuple[Path, str]] = []
    for path in sorted(dist_dir.rglob("*")):
        if not path.is_file():
            continue
        key = path.relative_to(dist_dir).as_posix()
        pairs.append((path, key))
    return pairs


def list_remote_keys(client: CosS3Client, bucket: str) -> set[str]:
    keys: set[str] = set()
    marker = ""
    while True:
        resp = client.list_objects(Bucket=bucket, Prefix="", Marker=marker, MaxKeys=1000)
        for item in resp.get("Contents") or []:
            keys.add(item["Key"])
        if resp.get("IsTruncated") == "true":
            marker = resp.get("NextMarker") or ""
        else:
            break
    return keys


def cache_control_for_key(key: str) -> str | None:
    if key == "index.html":
        return "no-cache"
    if key.startswith("assets/"):
        return "public, max-age=31536000, immutable"
    return None


def sync_dist(
    client: CosS3Client,
    bucket: str,
    dist_dir: Path,
    *,
    delete: bool,
) -> tuple[int, int]:
    if not dist_dir.is_dir():
        raise SystemExit(f"dist 目录不存在: {dist_dir}，请先 npm run build")

    local_pairs = iter_dist_files(dist_dir)
    if not local_pairs:
        raise SystemExit("dist 目录为空")

    uploaded = 0
    for local_path, key in local_pairs:
        extra: dict[str, str] = {}
        cache = cache_control_for_key(key)
        if cache:
            extra["CacheControl"] = cache
        client.upload_file(
            Bucket=bucket,
            LocalFilePath=str(local_path),
            Key=key,
            **extra,
        )
        uploaded += 1
        print(f"uploaded: {key}")

    deleted = 0
    if delete:
        local_keys = {key for _, key in local_pairs}
        remote_keys = list_remote_keys(client, bucket)
        for key in sorted(remote_keys - local_keys):
            client.delete_object(Bucket=bucket, Key=key)
            deleted += 1
            print(f"deleted: {key}")

    return uploaded, deleted


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy frontend dist/ to COS website bucket")
    parser.add_argument("--bucket", default=os.getenv("WEBSITE_COS_BUCKET", DEFAULT_BUCKET))
    parser.add_argument("--region", default=os.getenv("WEBSITE_COS_REGION", DEFAULT_REGION))
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--no-delete", action="store_true")
    args = parser.parse_args()

    env = load_env(ENV_PATH)
    secret_id = os.getenv("COS_SECRET_ID") or env.get("COS_SECRET_ID", "")
    secret_key = os.getenv("COS_SECRET_KEY") or env.get("COS_SECRET_KEY", "")
    if not secret_id or not secret_key:
        print("缺少 COS_SECRET_ID / COS_SECRET_KEY（backend/.env 或环境变量）", file=sys.stderr)
        return 1

    if not args.skip_build:
        print("building frontend...")
        build_frontend()

    config = CosConfig(Region=args.region, SecretId=secret_id, SecretKey=secret_key, Scheme="https")
    client = CosS3Client(config)

    try:
        uploaded, deleted = sync_dist(
            client,
            args.bucket,
            DIST_DIR,
            delete=not args.no_delete,
        )
    except (CosClientError, CosServiceError) as exc:
        print(f"COS 上传失败: {exc}", file=sys.stderr)
        return 1

    website = f"https://{args.bucket}.cos-website.{args.region}.myqcloud.com"
    print(f"done: uploaded={uploaded}, deleted={deleted}")
    print(f"website: {website}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
