#!/usr/bin/env python3
"""Safely sync config and/or backend binary to the cloud server via SFTP.

Usage:
  set REMOTE_SYNC_PASSWORD=...
  python tools/sync_cloud.py              # config JSON only
  python tools/sync_cloud.py --restart      # config + restart API
  python tools/sync_cloud.py --binary     # config + jiadian-api binary
  python tools/sync_cloud.py --binary --restart

See tools/云服务器同步指南.md for full documentation.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError as exc:
    raise SystemExit("缺少 paramiko，请先运行：pip install -r tools/requirements.txt") from exc

ROOT = Path(__file__).resolve().parents[1]
HOST = os.getenv("REMOTE_SYNC_HOST", "124.221.5.162")
USER = os.getenv("REMOTE_SYNC_USER", "ubuntu")
PASSWORD = os.getenv("REMOTE_SYNC_PASSWORD", "").strip()
BASE = os.getenv("REMOTE_SYNC_BASE_PATH", "/opt/jiadian-hub/app").rstrip("/")
RESTART_CMD = os.getenv(
    "REMOTE_RESTART_CMD",
    "systemctl restart jiadian-api.service",
).strip()

CONFIG_PAIRS = [
    (ROOT / "src/data/resources.json", f"{BASE}/src/data/resources.json"),
    (ROOT / "src/data/columnTags.json", f"{BASE}/src/data/columnTags.json"),
    (ROOT / "backend/config/image_map.json", f"{BASE}/backend/config/image_map.json"),
    (ROOT / "backend/config/resource_map.json", f"{BASE}/backend/config/resource_map.json"),
]
BINARY_LOCAL = ROOT / "backend" / "jiadian-api"
BINARY_REMOTE = f"{BASE}/backend/jiadian-api"


def connect() -> paramiko.SSHClient:
    if not PASSWORD:
        raise RuntimeError("未设置 REMOTE_SYNC_PASSWORD 环境变量")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, username=USER, password=PASSWORD, timeout=15)
    return client


def ensure_dirs(client: paramiko.SSHClient, dirs: set[str]) -> None:
    for remote_dir in sorted(dirs):
        _, stdout, stderr = client.exec_command(f"mkdir -p '{remote_dir}'")
        stdout.read()
        err = stderr.read().decode("utf-8", "ignore").strip()
        if err:
            raise RuntimeError(f"创建远程目录失败 ({remote_dir}): {err}")


def sftp_upload(client: paramiko.SSHClient, pairs: list[tuple[Path, str]]) -> None:
    for local_path, remote_path in pairs:
        if not local_path.is_file():
            raise FileNotFoundError(f"本地文件不存在: {local_path}")
        sftp = client.open_sftp()
        try:
            sftp.put(str(local_path), remote_path)
        finally:
            sftp.close()
        print(f"已上传: {local_path.relative_to(ROOT)} -> {remote_path}")


def run_remote(client: paramiko.SSHClient, cmd: str) -> tuple[str, str]:
    _, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode("utf-8", "ignore").strip()
    err = stderr.read().decode("utf-8", "ignore").strip()
    return out, err


def main() -> int:
    parser = argparse.ArgumentParser(description="SFTP 同步云服务器（配置文件 / 后端二进制）")
    parser.add_argument("--binary", action="store_true", help="同时上传 backend/jiadian-api 二进制")
    parser.add_argument("--restart", action="store_true", help="同步后重启 jiadian-api.service")
    parser.add_argument("--verify", action="store_true", help="同步后检查服务与 HTTP 状态")
    args = parser.parse_args()

    upload_pairs = list(CONFIG_PAIRS)
    remote_dirs = {f"{BASE}/src/data", f"{BASE}/backend/config"}

    if args.binary:
        if not BINARY_LOCAL.is_file():
            raise SystemExit(f"本地二进制不存在，请先编译: {BINARY_LOCAL}")
        upload_pairs.append((BINARY_LOCAL, BINARY_REMOTE))
        remote_dirs.add(f"{BASE}/backend")

    print(f"连接云服务器: {USER}@{HOST}")
    client = connect()
    try:
        ensure_dirs(client, remote_dirs)
        sftp_upload(client, upload_pairs)

        if args.binary:
            run_remote(client, f"chmod +x '{BINARY_REMOTE}'")

        if args.restart:
            sudo_cmd = f"echo '{PASSWORD}' | sudo -S -p '' {RESTART_CMD}"
            print(f"执行重启: {RESTART_CMD}")
            out, err = run_remote(client, sudo_cmd)
            if out:
                print(out)
            if err:
                print(err)

        if args.verify or args.restart:
            status, _ = run_remote(client, "systemctl is-active jiadian-api.service")
            print(f"jiadian-api.service: {status or 'unknown'}")
            code, _ = run_remote(
                client,
                "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/api/verify-token",
            )
            print(f"本地 API /api/verify-token: {code or 'failed'}")
    finally:
        client.close()

    print("云服务器同步完成")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"同步失败: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
