#!/usr/bin/env python3
"""Enable Tencent IMS image moderation on cloud server."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.getenv("REMOTE_SYNC_HOST", "124.221.5.162")
USER = os.getenv("REMOTE_SYNC_USER", "ubuntu")
PASSWORD = os.getenv("REMOTE_SYNC_PASSWORD", "").strip()
ENV_PATH = "/opt/jiadian-hub/app/backend/.env"


def remote_exec(client: paramiko.SSHClient, cmd: str) -> tuple[str, str]:
    _, stdout, stderr = client.exec_command(cmd)
    return stdout.read().decode("utf-8", "ignore"), stderr.read().decode("utf-8", "ignore")


def upsert_env_line(content: str, key: str, value: str) -> str:
    lines = content.splitlines()
    prefix = f"{key}="
    replaced = False
    out: list[str] = []
    for line in lines:
        if line.startswith(prefix):
            out.append(f"{key}={value}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        if out and out[-1].strip():
            out.append("")
        out.append(f"{key}={value}")
    return "\n".join(out).rstrip() + "\n"


def main() -> int:
    if not PASSWORD:
        print("未设置 REMOTE_SYNC_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, username=USER, password=PASSWORD, timeout=15)
    try:
        out, _ = remote_exec(client, f"echo '{PASSWORD}' | sudo -S -p '' cat {ENV_PATH}")
        if not out.strip():
            raise RuntimeError(f"无法读取 {ENV_PATH}")

        new_env = upsert_env_line(out, "IMS_ENABLED", "true")
        new_env = upsert_env_line(new_env, "IMS_BIZ_TYPE", "upload")
        new_env = upsert_env_line(new_env, "IMS_AIGC_MODERATION_TYPE", "IMAGE")
        if "IMS_REGION=" not in new_env:
            new_env = upsert_env_line(new_env, "IMS_REGION", "ap-guangzhou")

        env_tmp = "/home/ubuntu/backend.env.ims"
        sftp = client.open_sftp()
        with sftp.open(env_tmp, "w") as f:
            f.write(new_env)
        sftp.close()
        remote_exec(
            client,
            f"echo '{PASSWORD}' | sudo -S -p '' install -m 600 {env_tmp} {ENV_PATH}",
        )
        print("已设置 IMS_ENABLED=true, IMS_BIZ_TYPE=upload")

        remote_exec(client, f"echo '{PASSWORD}' | sudo -S -p '' systemctl restart jiadian-api.service")
        status, _ = remote_exec(client, "systemctl is-active jiadian-api.service")
        print("jiadian-api.service:", status)

        logs, _ = remote_exec(
            client,
            f"echo '{PASSWORD}' | sudo -S -p '' journalctl -u jiadian-api.service --no-pager -n 20",
        )
        for line in logs.splitlines():
            if "IMS" in line or "moderation" in line.lower():
                print(line.encode("ascii", "backslashreplace").decode())
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
