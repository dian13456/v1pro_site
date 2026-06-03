#!/usr/bin/env python3
"""Strip COS public URLs from src/data/resources.json, keeping object keys only."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RESOURCES_PATH = PROJECT_ROOT / "src" / "data" / "resources.json"


def strip_public_object_url(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    if not text.lower().startswith(("http://", "https://")):
        return text.lstrip("/")
    path = unquote(urlparse(text).path.lstrip("/"))
    return path


def main() -> int:
    if not RESOURCES_PATH.is_file():
        raise SystemExit(f"文件不存在: {RESOURCES_PATH}")

    resources = json.loads(RESOURCES_PATH.read_text(encoding="utf-8"))
    if not isinstance(resources, list):
        raise SystemExit("resources.json 格式异常")

    changed = 0
    for item in resources:
        if not isinstance(item, dict):
            continue
        image_raw = str(item.get("image") or "")
        download_raw = str(item.get("download") or "")
        image_key = strip_public_object_url(image_raw)
        download_key = strip_public_object_url(download_raw) or image_key
        if image_raw != image_key:
            item["image"] = image_key
            changed += 1
        if download_raw != download_key:
            item["download"] = download_key
            changed += 1

    RESOURCES_PATH.write_text(
        json.dumps(resources, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"已处理 {len(resources)} 条，更新字段 {changed} 处 -> {RESOURCES_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
