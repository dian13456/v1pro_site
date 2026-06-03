#!/usr/bin/env python3
"""Restore catalog entries for COS objects orphaned after sync_cloud overwrite."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESOURCES_PATH = ROOT / "src/data/resources.json"
IMAGE_MAP_PATH = ROOT / "backend/config/image_map.json"

RESTORES = [
    {
        "id": 2606031756219117,
        "object_key": "img_20260603175621_4aad4446.jpg",
        "updated_at": "2026-06-03T17:56:21+08:00",
        "size": "222KB",
    },
    {
        "id": 2606031757102124,
        "object_key": "img_20260603175710_084c8474.jpg",
        "updated_at": "2026-06-03T17:57:10+08:00",
        "size": "223KB",
    },
    {
        "id": 2606031757176698,
        "object_key": "img_20260603175717_dd7a1e80.jpg",
        "updated_at": "2026-06-03T17:57:17+08:00",
        "size": "189KB",
    },
    {
        "id": 2606031757246675,
        "object_key": "img_20260603175724_1a130485.jpg",
        "updated_at": "2026-06-03T17:57:24+08:00",
        "size": "151KB",
    },
    {
        "id": 2606031806326739,
        "object_key": "img_20260603180632_1a534fef.jpg",
        "updated_at": "2026-06-03T18:06:32+08:00",
        "size": "201KB",
    },
    {
        "id": 2606032002564267,
        "object_key": "img_20260603200256_10ab363f.jpg",
        "updated_at": "2026-06-03T20:02:57+08:00",
        "size": "406KB",
        "author": "网站分享",
    },
    {
        "id": 2606032003346535,
        "object_key": "img_20260603200334_8eb7b0f7.jpg",
        "updated_at": "2026-06-03T20:03:34+08:00",
        "size": "406KB",
        "author": "网站分享",
    },
    {
        "id": 2606032004088436,
        "object_key": "img_20260603200408_bd346841.jpg",
        "updated_at": "2026-06-03T20:04:08+08:00",
        "size": "485KB",
        "author": "网站分享",
    },
    {
        "id": 2606032004469899,
        "object_key": "img_20260603200446_26abccab.jpg",
        "updated_at": "2026-06-03T20:04:46+08:00",
        "size": "383KB",
        "author": "网站分享",
    },
    {
        "id": 2606032005214783,
        "object_key": "img_20260603200521_aeef10c1.jpg",
        "updated_at": "2026-06-03T20:05:22+08:00",
        "size": "403KB",
        "author": "网站分享",
    },
]

AUTHOR = "微笑"
SERIAL = "E339E3397D9EBD701461ABCD"


def main() -> int:
    resources = json.loads(RESOURCES_PATH.read_text(encoding="utf-8"))
    image_map = json.loads(IMAGE_MAP_PATH.read_text(encoding="utf-8"))
    existing_ids = {int(item["id"]) for item in resources if isinstance(item, dict) and "id" in item}

    added = 0
    for item in RESTORES:
        rid = item["id"]
        key = item["object_key"]
        if rid in existing_ids:
            print(f"skip existing id={rid}")
            continue
        resources.append(
            {
                "id": rid,
                "title": "AI 生成图片",
                "description": "AI 生成图片（已恢复入库）",
                "author": item.get("author", AUTHOR),
                "size": item["size"],
                "image": key,
                "download": key,
                "category": "gif",
                "materialType": "image",
                "updatedAt": item["updated_at"],
            }
        )
        image_map[str(rid)] = key
        existing_ids.add(rid)
        added += 1
        print(f"restored id={rid} key={key}")

    resources.sort(key=lambda x: int(x.get("id", 0)))
    RESOURCES_PATH.write_text(json.dumps(resources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    IMAGE_MAP_PATH.write_text(json.dumps(image_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"done: added {added}, total resources {len(resources)}")
    print(f"serial={SERIAL} author={AUTHOR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
