#!/usr/bin/env python3
"""Deploy a Vite build to Tencent COS with browser-safe metadata."""

from __future__ import annotations

import argparse
import hashlib
import mimetypes
import os
from pathlib import Path

from qcloud_cos import CosConfig, CosS3Client
from qcloud_cos.cos_exception import CosServiceError


NO_CACHE = "no-cache, no-store, must-revalidate"
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
SHORT_CACHE = "public, max-age=86400"


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def content_type(path: Path) -> str:
    overrides = {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".wasm": "application/wasm",
    }
    return overrides.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def cache_control(key: str) -> str:
    if key == "index.html" or key.endswith(".html") or key in {"CNAME", "version.json"}:
        return NO_CACHE
    if key.startswith("assets/"):
        return IMMUTABLE_CACHE
    return SHORT_CACHE


def file_md5(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def remote_matches(client: CosS3Client, bucket: str, key: str, path: Path) -> bool:
    try:
        remote = client.head_object(Bucket=bucket, Key=key)
    except CosServiceError as error:
        if error.get_status_code() == 404:
            return False
        raise

    remote_etag = str(remote.get("ETag", "")).strip('"').lower()
    return (
        remote_etag == file_md5(path)
        and int(remote.get("Content-Length", -1)) == path.stat().st_size
        and remote.get("Cache-Control", "") == cache_control(key)
        and remote.get("Content-Type", "").lower() == content_type(path).lower()
    )


def upload_file(client: CosS3Client, bucket: str, root: Path, path: Path) -> None:
    key = path.relative_to(root).as_posix()
    if remote_matches(client, bucket, key, path):
        print(f"skipped {key} (unchanged)")
        return

    with path.open("rb") as body:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType=content_type(path),
            CacheControl=cache_control(key),
        )

    remote = client.head_object(Bucket=bucket, Key=key)
    if int(remote.get("Content-Length", -1)) != path.stat().st_size:
        raise RuntimeError(f"COS size verification failed for {key}")
    print(f"uploaded {key} ({path.stat().st_size} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", type=Path, default=Path("dist"))
    args = parser.parse_args()

    root = args.dist.resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"Build output is missing: {index}")

    bucket = required_env("COS_BUCKET")
    region = required_env("COS_REGION")
    client = CosS3Client(
        CosConfig(
            Region=region,
            SecretId=required_env("COS_SECRET_ID"),
            SecretKey=required_env("COS_SECRET_KEY"),
            Scheme="https",
        )
    )

    files = sorted(path for path in root.rglob("*") if path.is_file() and path != index)
    for path in files:
        upload_file(client, bucket, root, path)

    # Publish the entry document last so it never points at assets that are not uploaded yet.
    upload_file(client, bucket, root, index)
    print(f"deployed {len(files) + 1} files to cos://{bucket}/")


if __name__ == "__main__":
    main()
