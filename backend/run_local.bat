@echo off
cd /d "%~dp0"

if not exist .env (
  echo [提示] 未找到 backend\.env，请先复制 .env.example 并填入 COS 密钥。
  echo.
)

set PORT=18080
if not defined JWT_SECRET set JWT_SECRET=jiadian_local_dev_secret_2026
if not defined ALLOWED_DEVICES set ALLOWED_DEVICES=0483:66AA,2E3C:5753
if not defined CORS_ALLOW_ORIGIN set CORS_ALLOW_ORIGIN=http://localhost:5173

echo 启动本地后端: http://127.0.0.1:%PORT%
echo 若 8080 被其他程序占用，请始终使用 18080 联调。
echo.

go run .
