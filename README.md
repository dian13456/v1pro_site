# 佳点 HUB 资源中心

高端风格产品资源下载站，接入 WebUSB 设备认证（VID `0x0483` / PID `0x66AA`），并通过 Cloudflare Worker 完成序列号鉴权与签名下载。

## 技术栈

- React + Vite
- TailwindCSS
- Cloudflare Worker

## 已实现功能

- 设备认证页面：点击“验证设备”调用 `navigator.usb.requestDevice()`
- VID/PID 校验：仅允许 `0483/66AA`
- 唯一认证：读取 `device.serialNumber` 后请求 `POST /api/auth`
- token 持久化：`localStorage` 存储并在页面访问时校验
- 产品展示：Apple/Nothing/Linear 风格卡片布局
- 资源下载保护：下载前再次检查设备状态与 token，有效后请求签名链接
- Worker 签名下载：60 秒有效链接
- 视觉效果：毛玻璃、渐变、滚动动画、暗黑模式、响应式布局

## 目录结构

```txt
src/
├─ pages
├─ components
├─ assets
├─ api
├─ styles
worker/
└─ src
```

## 前端启动

```bash
# 安装依赖
npm install

# 开发
npm run dev

# 构建
npm run build
```

本地联调建议（避免 `/api/auth` 报“请求失败”）：

1. 启动 Worker（默认 `http://127.0.0.1:8787`）
2. 再启动前端（`http://localhost:5173`）

前端开发服务器已内置 `/api` 代理到 Worker 开发地址，可通过环境变量覆盖：

```env
VITE_DEV_WORKER_URL=http://127.0.0.1:8787
VITE_GIN_API_URL=http://127.0.0.1:8080
```

可选环境变量（根目录 `.env`）：

```env
VITE_API_BASE=https://your-worker-domain.workers.dev
VITE_BASE_PATH=/
VITE_COS_RESOURCE_MANIFEST_URL=https://<你的COS域名>/resources.json
VITE_COS_PUBLIC_BASE_URL=https://<你的COS域名>
VITE_STATIC_MODE=false
```

> GitHub Pages 部署到子路径时，设置 `VITE_BASE_PATH=/你的仓库名/`

COS 资源接入说明：

- `VITE_COS_RESOURCE_MANIFEST_URL`：资源清单地址（JSON）
- `VITE_COS_PUBLIC_BASE_URL`：图片/下载链接是相对路径时，自动拼接此域名前缀
- 当 COS 清单不可达时，前端自动回退到本地 `src/data/resources.json`

GitHub Pages 运行建议：

- 默认使用 Hash 路由（已适配 Pages 刷新）
- Actions 构建时默认开启 `VITE_STATIC_MODE=true`
- 静态模式下：
  - USB 认证仍会校验 VID/PID
  - 不依赖后端 token 验证接口
  - 下载走 `resources.json` 中的 `download` 直链

## Worker 启动与部署

在 `worker/` 目录：

```bash
npm install
npm run dev
npm run deploy
```

设置 Worker secrets：

```bash
wrangler secret put JWT_SECRET
wrangler secret put SIGN_SECRET
```

在 `worker/wrangler.toml` 中可配置：

- `ALLOWED_VID=0483`
- `ALLOWED_PID=66AA`
- `DOWNLOAD_BASE_URL=https://your-cdn/protected`

## API 说明

### `POST /api/auth`

请求：

```json
{
  "serial": "xxxxx",
  "vid": "0483",
  "pid": "66AA"
}
```

响应：

```json
{
  "success": true,
  "token": "jwt-token"
}
```

### `POST /api/download-sign`

Header:

```txt
Authorization: Bearer <token>
```

请求：

```json
{
  "productId": "jd-hub-pro",
  "resourceType": "firmware"
}
```

响应：

```json
{
  "success": true,
  "url": "https://.../firmware.zip?exp=xxx&sig=xxx",
  "expires": 1717000000
}
```

## Gin 私有读取接口

已新增 `backend/`，提供 COS 私有文件读取预签名接口：

- `GET /api/resource/:id`
- 功能：按资源 ID 查对象键，返回 10 分钟有效下载链接
- 响应：

```json
{
  "url": "https://..."
}
```

使用步骤：

```bash
cd backend
go mod tidy
go run .
```

需要配置环境变量（可参考 `backend/.env.example`）：

- `COS_BUCKET`
- `COS_REGION`
- `COS_SECRET_ID`
- `COS_SECRET_KEY`
- `RESOURCE_MAP_PATH`（默认 `config/resource_map.json`）

# v1pro_site
