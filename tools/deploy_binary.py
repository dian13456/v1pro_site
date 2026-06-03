#!/usr/bin/env python3
"""Deploy jiadian-api or config JSON via /home/ubuntu + sudo install."""
from __future__ import annotations

import argparse
import os
import posixpath
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
HOST = os.getenv("REMOTE_SYNC_HOST", "124.221.5.162")
USER = os.getenv("REMOTE_SYNC_USER", "ubuntu")
PASSWORD = os.getenv("REMOTE_SYNC_PASSWORD", "").strip()
BASE = os.getenv("REMOTE_SYNC_BASE_PATH", "/opt/jiadian-hub/app").rstrip("/")
RESTART_CMD = os.getenv(
    "REMOTE_RESTART_CMD",
    "systemctl restart jiadian-api.service",
).strip()
LOCAL_BINARY = ROOT / "backend" / "jiadian-api"
REMOTE_BIN = f"{BASE}/backend/jiadian-api"
QUOTA_FILES = [
    (ROOT / "backend/config/ai_image_credits.json", f"{BASE}/backend/config/ai_image_credits.json"),
    (ROOT / "backend/config/ai_image_share_counts.json", f"{BASE}/backend/config/ai_image_share_counts.json"),
]


def remote_exec(client: paramiko.SSHClient, command: str) -> tuple[str, str]:
    _, stdout, stderr = client.exec_command(command)
    return stdout.read().decode("utf-8", "ignore").strip(), stderr.read().decode("utf-8", "ignore").strip()


def sftp_put_via_sudo(
    client: paramiko.SSHClient,
    local_path: Path,
    remote_path: str,
    password: str,
    *,
    mode: str = "644",
) -> None:
    staging_path = f"/home/ubuntu/{posixpath.basename(remote_path)}.upload"
    remote_dir = posixpath.dirname(remote_path)
    sftp = client.open_sftp()
    try:
        sftp.put(str(local_path), staging_path)
    finally:
        sftp.close()
    remote_exec(client, f"echo '{password}' | sudo -S -p '' mkdir -p '{remote_dir}'")
    _, err = remote_exec(
        client,
        f"echo '{password}' | sudo -S -p '' install -m {mode} '{staging_path}' '{remote_path}'",
    )
    if err and "password" not in err.lower():
        raise RuntimeError(f"远程写入失败 ({remote_path}): {err}")


def deploy_binary(client: paramiko.SSHClient, password: str, restart: bool) -> None:
    if not LOCAL_BINARY.is_file():
        raise FileNotFoundError(f"本地二进制不存在: {LOCAL_BINARY}")
    sftp_put_via_sudo(client, LOCAL_BINARY, REMOTE_BIN, password, mode="755")
    print(f"已部署: {REMOTE_BIN}")
    if restart:
        remote_exec(client, f"echo '{password}' | sudo -S -p '' {RESTART_CMD}")
        status, _ = remote_exec(client, "systemctl is-active jiadian-api.service")
        print(f"jiadian-api.service: {status}")


def deploy_quota(client: paramiko.SSHClient, password: str, restart: bool) -> None:
    for local_path, remote_path in QUOTA_FILES:
        if not local_path.is_file():
            raise FileNotFoundError(f"本地文件不存在: {local_path}")
        sftp_put_via_sudo(client, local_path, remote_path, password)
        print(f"已上传: {local_path.relative_to(ROOT)} -> {remote_path}")
    if restart:
        remote_exec(client, f"echo '{password}' | sudo -S -p '' {RESTART_CMD}")
        print("已重启 jiadian-api.service")


def main() -> int:
    parser = argparse.ArgumentParser(description="Deploy backend binary or quota JSON to cloud server")
    parser.add_argument("--binary", action="store_true", help="部署 jiadian-api 二进制")
    parser.add_argument("--quota", action="store_true", help="同步 ai_image_credits / share_counts")
    parser.add_argument("--restart", action="store_true", help="完成后重启 API")
    args = parser.parse_args()
    if not args.binary and not args.quota:
        args.binary = True
    if not PASSWORD:
        print("未设置 REMOTE_SYNC_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, username=USER, password=PASSWORD, timeout=15)
    try:
        if args.binary:
            deploy_binary(client, PASSWORD, args.restart)
        if args.quota:
            deploy_quota(client, PASSWORD, args.restart)
    finally:
        client.close()
    print("完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
