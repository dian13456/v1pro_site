#!/usr/bin/env python3
"""Patch server nginx + backend .env for CORS and large image uploads."""
from __future__ import annotations

import os
import re
import sys

import paramiko

HOST = os.getenv("REMOTE_SYNC_HOST", "124.221.5.162")
USER = os.getenv("REMOTE_SYNC_USER", "ubuntu")
PASSWORD = os.getenv("REMOTE_SYNC_PASSWORD", "").strip()
NGINX_SITE = "/etc/nginx/sites-enabled/jiadian-api"
ENV_PATH = "/opt/jiadian-hub/app/backend/.env"
CORS_VALUE = "https://jadot.cn,https://www.jadot.cn"
BODY_SIZE = "20m"


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


def patch_nginx_config(text: str) -> str:
    if "client_max_body_size" in text:
        return re.sub(r"client_max_body_size\s+\S+;", f"client_max_body_size {BODY_SIZE};", text)
    location_block = f"    client_max_body_size {BODY_SIZE};\n\n    location / {{"
    if "    location / {" not in text:
        raise RuntimeError("nginx 配置格式不符合预期，未找到 location /")
    return text.replace("    location / {", location_block)


def main() -> int:
    if not PASSWORD:
        print("未设置 REMOTE_SYNC_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(hostname=HOST, username=USER, password=PASSWORD, timeout=15)
    try:
        out, _ = remote_exec(client, f"echo '{PASSWORD}' | sudo -S -p '' cat {NGINX_SITE}")
        if not out.strip():
            raise RuntimeError("无法读取 nginx 配置")
        patched = patch_nginx_config(out)
        tmp = "/home/ubuntu/jiadian-api.nginx"
        sftp = client.open_sftp()
        with sftp.open(tmp, "w") as f:
            f.write(patched)
        sftp.close()
        remote_exec(
            client,
            f"echo '{PASSWORD}' | sudo -S -p '' install -m 644 {tmp} {NGINX_SITE}",
        )
        remote_exec(client, f"echo '{PASSWORD}' | sudo -S -p '' nginx -t")
        remote_exec(client, f"echo '{PASSWORD}' | sudo -S -p '' systemctl reload nginx")
        print("nginx 已更新 client_max_body_size", BODY_SIZE)

        out, _ = remote_exec(client, f"cat {ENV_PATH}")
        new_env = upsert_env_line(out, "CORS_ALLOW_ORIGIN", CORS_VALUE)
        env_tmp = "/home/ubuntu/backend.env.upload"
        sftp = client.open_sftp()
        with sftp.open(env_tmp, "w") as f:
            f.write(new_env)
        sftp.close()
        remote_exec(
            client,
            f"echo '{PASSWORD}' | sudo -S -p '' install -m 600 {env_tmp} {ENV_PATH}",
        )
        print("CORS_ALLOW_ORIGIN =", CORS_VALUE)

        remote_exec(client, f"echo '{PASSWORD}' | sudo -S -p '' systemctl restart jiadian-api.service")
        status, _ = remote_exec(client, "systemctl is-active jiadian-api.service")
        print("jiadian-api.service:", status)

        _, headers = remote_exec(
            client,
            "curl -sS -D - -o /dev/null -X OPTIONS "
            "'http://127.0.0.1:8080/api/user-image/share' "
            "-H 'Origin: https://jadot.cn' "
            "-H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin",
        )
        print("CORS check (jadot.cn):", headers.strip() or "(empty)")
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
