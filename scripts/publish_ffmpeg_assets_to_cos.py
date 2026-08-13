"""Publish browser FFmpeg assets to the configured Tencent COS software bucket."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from qcloud_cos import CosConfig, CosS3Client, CosServiceError


CACHE_CONTROL = "public,max-age=31536000,immutable"
ASSETS = {
    "ffmpeg-core.js": "application/javascript; charset=utf-8",
    "ffmpeg-core.wasm": "application/wasm",
}
SITE_ORIGINS = ["https://www.jadot.cn", "https://jadot.cn"]


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def first_value(file_env: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = os.environ.get(key, "").strip() or file_env.get(key, "").strip()
        if value:
            return value
    return ""


def create_client(file_env: dict[str, str], bucket: str, region: str) -> CosS3Client:
    errors: list[str] = []
    for prefix in ("SOFTWARE_COS", "COS"):
        secret_id = first_value(file_env, f"{prefix}_SECRET_ID")
        secret_key = first_value(file_env, f"{prefix}_SECRET_KEY")
        if not secret_id or not secret_key:
            continue
        client = CosS3Client(
            CosConfig(Region=region, SecretId=secret_id, SecretKey=secret_key)
        )
        try:
            client.list_objects(Bucket=bucket, MaxKeys=1)
            if prefix != "SOFTWARE_COS":
                print("SOFTWARE_COS credentials unavailable; using COS credentials")
            return client
        except CosServiceError as error:
            errors.append(f"{prefix}: {error.get_error_code()}")
    raise RuntimeError("no usable COS credentials (" + ", ".join(errors) + ")")


def ensure_cors(client: CosS3Client, bucket: str) -> None:
    try:
        current = client.get_bucket_cors(Bucket=bucket)
        rules = list(current.get("CORSRule", []))
    except CosServiceError as error:
        if error.get_error_code() != "NoSuchCORSConfiguration":
            raise
        rules = []

    for rule in rules:
        origins = rule.get("AllowedOrigin", [])
        methods = rule.get("AllowedMethod", [])
        if "https://www.jadot.cn" in origins and "GET" in methods:
            return

    rules.append(
        {
            "ID": "v1pro-ffmpeg-browser",
            "AllowedOrigin": SITE_ORIGINS,
            "AllowedMethod": ["GET", "HEAD"],
            "AllowedHeader": ["*"],
            "ExposeHeader": ["Content-Length", "ETag", "x-cos-request-id"],
            "MaxAgeSeconds": 86400,
        }
    )
    client.put_bucket_cors(
        Bucket=bucket,
        CORSConfiguration={"CORSRule": rules},
    )


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=project_root / "public" / "ffmpeg")
    parser.add_argument("--env", type=Path, default=project_root / "backend" / ".env")
    parser.add_argument("--version", default="0.12.10-v1pro-1")
    args = parser.parse_args()

    file_env = read_env(args.env)
    bucket = first_value(file_env, "SOFTWARE_COS_BUCKET", "COS_BUCKET")
    region = first_value(file_env, "SOFTWARE_COS_REGION", "COS_REGION")
    if not all((bucket, region)):
        raise RuntimeError("missing SOFTWARE_COS_* or COS_* configuration")

    client = create_client(file_env, bucket, region)
    ensure_cors(client, bucket)

    version = args.version.strip("/")
    for name, content_type in ASSETS.items():
        source = args.source / name
        key = f"ffmpeg/{version}/{name}"
        with source.open("rb") as stream:
            client.put_object(
                Bucket=bucket,
                Key=key,
                Body=stream,
                ACL="public-read",
                ContentType=content_type,
                CacheControl=CACHE_CONTROL,
            )
        print(f"uploaded {key} ({source.stat().st_size} bytes)")

    print(f"asset base: https://{bucket}.cos.{region}.myqcloud.com/ffmpeg/{version}")


if __name__ == "__main__":
    main()
