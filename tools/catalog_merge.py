"""Merge local and remote catalog JSON before cloud sync (avoid overwriting website shares)."""
from __future__ import annotations

import json
from pathlib import Path

try:
    import paramiko
except ImportError:  # pragma: no cover
    paramiko = None

ROOT = Path(__file__).resolve().parents[1]
RESOURCES_PATH = ROOT / "src/data/resources.json"
COLUMN_TAGS_PATH = ROOT / "src/data/columnTags.json"
IMAGE_MAP_PATH = ROOT / "backend/config/image_map.json"
RESOURCE_MAP_PATH = ROOT / "backend/config/resource_map.json"


def load_json(path: Path, default_value):
    if not path.exists():
        return default_value
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _resource_updated_at(item: dict) -> str:
    return str(item.get("updatedAt") or "")


def merge_resource_lists(local: list, remote: list) -> list:
    """Union by id; on conflict keep the entry with newer updatedAt."""
    by_id: dict[int, dict] = {}
    for item in (remote or []) + (local or []):
        if not isinstance(item, dict) or item.get("id") is None:
            continue
        rid = int(item["id"])
        current = by_id.get(rid)
        if current is None or _resource_updated_at(item) >= _resource_updated_at(current):
            by_id[rid] = item
    return sorted(by_id.values(), key=lambda x: int(x.get("id", 0)))


def merge_string_maps(local: dict, remote: dict) -> dict:
    merged = dict(remote or {})
    merged.update(local or {})
    return merged


def merge_column_tags(local: list, remote: list) -> list:
    by_id: dict[str, dict] = {}
    for item in (remote or []) + (local or []):
        if not isinstance(item, dict):
            continue
        tag_id = str(item.get("id") or "").strip()
        if not tag_id:
            continue
        by_id[tag_id] = item
    return list(by_id.values())


def catalog_pairs(base_path: str) -> list[tuple[Path, str]]:
    base_path = base_path.rstrip("/")
    return [
        (RESOURCES_PATH, f"{base_path}/src/data/resources.json"),
        (COLUMN_TAGS_PATH, f"{base_path}/src/data/columnTags.json"),
        (IMAGE_MAP_PATH, f"{base_path}/backend/config/image_map.json"),
        (RESOURCE_MAP_PATH, f"{base_path}/backend/config/resource_map.json"),
    ]


def pull_remote_catalog(client: paramiko.SSHClient, base_path: str) -> tuple[list, list, dict, dict]:
    remote_resources: list = []
    remote_tags: list = []
    remote_image_map: dict = {}
    remote_resource_map: dict = {}

    sftp = client.open_sftp()
    try:
        for local_path, remote_path in catalog_pairs(base_path):
            try:
                with sftp.open(remote_path, "r") as remote_file:
                    payload = json.load(remote_file)
            except FileNotFoundError:
                continue
            except OSError as exc:
                if getattr(exc, "errno", None) == 2:
                    continue
                raise
            if local_path == RESOURCES_PATH and isinstance(payload, list):
                remote_resources = payload
            elif local_path == COLUMN_TAGS_PATH and isinstance(payload, list):
                remote_tags = payload
            elif local_path == IMAGE_MAP_PATH and isinstance(payload, dict):
                remote_image_map = payload
            elif local_path == RESOURCE_MAP_PATH and isinstance(payload, dict):
                remote_resource_map = payload
    finally:
        sftp.close()

    return remote_resources, remote_tags, remote_image_map, remote_resource_map


def merge_local_with_remote(base_path: str, client: paramiko.SSHClient) -> int:
    """Pull server catalog, merge into local files. Returns count of resources added from server."""
    local_resources = load_json(RESOURCES_PATH, [])
    local_tags = load_json(COLUMN_TAGS_PATH, [])
    local_image_map = load_json(IMAGE_MAP_PATH, {})
    local_resource_map = load_json(RESOURCE_MAP_PATH, {})

    remote_resources, remote_tags, remote_image_map, remote_resource_map = pull_remote_catalog(
        client, base_path
    )

    if not isinstance(local_resources, list):
        local_resources = []
    if not isinstance(local_tags, list):
        local_tags = []
    if not isinstance(local_image_map, dict):
        local_image_map = {}
    if not isinstance(local_resource_map, dict):
        local_resource_map = {}

    before = len(local_resources)
    merged_resources = merge_resource_lists(local_resources, remote_resources)
    merged_tags = merge_column_tags(local_tags, remote_tags)
    merged_image_map = merge_string_maps(local_image_map, remote_image_map)
    merged_resource_map = merge_string_maps(local_resource_map, remote_resource_map)

    save_json(RESOURCES_PATH, merged_resources)
    save_json(COLUMN_TAGS_PATH, merged_tags)
    save_json(IMAGE_MAP_PATH, merged_image_map)
    save_json(RESOURCE_MAP_PATH, merged_resource_map)

    return len(merged_resources) - before
