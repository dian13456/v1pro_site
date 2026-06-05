# GitHub 上传与保密说明

本文说明本仓库中**哪些内容可以推送到 GitHub**，哪些**必须留在本地或服务器、不得提交**。  
**README 故意留空**，不在 GitHub 展示项目/API/域名介绍；运维细节见本地 `tools/` 文档（勿写入真实地址）。

---

## 可以上传 GitHub（推荐提交）

### 源代码与配置模板

| 类型 | 路径示例 |
|------|----------|
| 前端源码 | `src/`、`public/`、`index.html`、`vite.config.js` |
| 后端源码 | `backend/*.go`、`backend/service/` |
| Worker | `worker/` |
| 工具脚本（无密钥） | `tools/sync_cloud.py`、`tools/deploy_binary.py`、`tools/deploy_website_cos.py`、`tools/image_uploader_gui.py` 等 |
| CI / 部署 | `.github/workflows/` |
| 环境变量**模板** | `.env.example`、`backend/.env.example`、`.env.development`（仅本地开发、无真实密钥） |
| 文档 | `README.md`、`*.md` 协议与说明文档 |
| 依赖清单 | `package.json`、`package-lock.json`、`backend/go.mod`、`tools/requirements.txt` |

### 业务配置（无密钥时可提交）

以下内容只包含**资源 ID、COS 对象名、标题描述**等，不含 Secret，一般可以提交：

- `backend/config/image_map.json`
- `backend/config/resource_map.json`
- `src/data/resources.json`
- `src/data/columnTags.json`

> 若资源列表体积很大或含未公开素材信息，可按团队策略选择不提交，改为仅同步到云服务器。

### 构建与部署相关（非敏感部分）

- `CNAME` / `public/CNAME`（自定义域名文件；域名本身建议在 DNS/托管平台维护，README 不写）
- `package.json` 中的公开脚本
- GitHub Actions **Variables** 中的 `VITE_API_BASE`（值在仓库 Settings 配置，**不要写进 yml 或 README**）

---

## 禁止上传 GitHub（必须隐藏）

### 密钥与环境变量（最高优先级）

| 内容 | 说明 |
|------|------|
| `backend/.env` | 生产 JWT、COS 密钥、IMS、复核 Token 等 |
| 根目录 `.env`、`.env.local` | 前端/本地敏感配置 |
| 任何含真实 `AKID…` / `SecretKey` 的文件 | 腾讯云 API 密钥 |
| `JWT_SECRET` | 鉴权签名密钥 |
| `REVIEW_ADMIN_TOKEN` | 图片人工复核管理员 Token |
| `DEEPSEEK_API_KEY`、`MINIMAX_API_KEY` | 第三方 AI 密钥 |
| `REMOTE_SYNC_PASSWORD` | 云服务器 SSH 密码 |

**正确做法：** 只提交 `*.env.example`，在本地/服务器单独维护真实 `.env`，并在 GitHub **Settings → Secrets** 存放 CI 所需密钥。

### 编译产物与二进制

| 内容 | 说明 |
|------|------|
| `backend/jiadian-api` | Linux 后端可执行文件，应用 SFTP 部署，**不要进 git** |
| `backend/*.exe` | 已在 `.gitignore` |
| `backend/jiadian-hub-backend`、`backend/smoke_ims` 等 | 本地/测试编译产物 |
| `dist/`、`node_modules/` | 前端构建与依赖，已在 `.gitignore` |
| `V0.1.zip` 等大包/安装包 | 放 COS 或网盘，不要进仓库 |

### 含密码或服务器信息的临时脚本

| 内容 | 说明 |
|------|------|
| `tools/tmp_retry_cert.py` | 若内含明文 SSH 密码，**立即删除或改环境变量**，且勿提交 |
| `tools/_server_logs_latest.txt` | 服务器日志，可能含 IP/路径信息 |

### 用户与运营数据（慎提交）

| 内容 | 说明 |
|------|------|
| `backend/config/ai_image_credits.json` | 用户 AI 积分余额 |
| `backend/config/ai_image_share_counts.json` | 用户分享次数 |
| `backend/config/image_review_queue.json` | 待审核图片队列（若有） |
| `tools/image_review_gui_config.json` | 已在 `.gitignore`，含复核 Token |

此类文件适合**仅保存在云服务器**，通过 `tools/sync_cloud.py` 同步，不要进公开仓库。

### 服务器专属配置

| 内容 | 说明 |
|------|------|
| 云服务器 ` /opt/jiadian-hub/app/backend/.env` | 仅存在于服务器 |
| nginx 证书私钥、certbot 账户 | 仅在服务器或证书托管平台 |
| COS 控制台导出的密钥 CSV | 切勿入库 |

---

## 当前 `.gitignore` 已忽略项

```
node_modules
dist
.wrangler
.env
.env.local
backend/.env
backend/*.exe
tools/image_review_gui_config.json
__pycache__/
*.pyc
```

### 建议本地保留但不提交（尚未全部写入 `.gitignore`）

提交前用 `git status` 确认以下**不要** `git add`：

- `backend/jiadian-api`
- `backend/jiadian-hub-backend`、`backend/smoke_ims`
- `V0.1.zip`
- `tools/tmp_retry_cert.py`（含密码时）
- `tools/_server_logs_latest.txt`
- `backend/config/ai_image_credits.json`（若含真实用户数据）
- `backend/config/ai_image_share_counts.json`

如需一劳永逸，可将上述路径追加进 `.gitignore`。

---

## GitHub Actions / 协作建议

### 应放在 GitHub Variables / Secrets 的（不要写进仓库文件）

- `VITE_API_BASE`（Actions Variables）
- `COS_SECRET_ID`、`COS_SECRET_KEY`（Actions Secrets，若 CI 需上传 COS）
- 任何部署用 SSH 密码或私钥
- 第三方 API Key

### 不要写进 README / `.env.example` 的

- 真实 API 地址、前端域名、云服务器 IP
- Bucket 名称若需保密，仅写在服务器本地 `.env`

---

## 提交前自检清单

```bash
git status
git diff
```

确认：

1. 没有 `.env`（仅 `.env.example`）
2. 没有 `AKID` 开头的真实 SecretId
3. 没有 `backend/jiadian-api` 等二进制
4. 没有 SSH 密码、复核 Token、JWT 明文
5. 没有在聊天/截图里泄露过的密钥仍留在某文件中被提交

若密钥曾经泄露，请到 [腾讯云 CAM](https://console.cloud.tencent.com/cam/capi) **轮换密钥**，并更新服务器 `backend/.env`。

---

## 部署与 Git 的分工（简要）

| 内容 | 更新方式 |
|------|----------|
| 前端 | `git push` → GitHub Pages Actions |
| 后端源码 | 提交到 GitHub；**二进制**用 `go build` + `tools/deploy_binary.py` 上传服务器 |
| 素材清单 / map | 可提交 Git，或用 `tools/sync_cloud.py` 同步云服务器 |
| 生产 `.env` | **仅服务器维护**，勿覆盖上传 |

更完整的发布流程见 [`tools/云服务器同步指南.md`](tools/云服务器同步指南.md)。

---

## GitHub Pages 静态站安全（已加固项）

公开静态页无法像 nginx 一样加 HTTP 安全头，项目在构建阶段做了以下防护，降低被扫出漏洞信息的概率：

| 措施 | 说明 |
|------|------|
| **禁止 Source Map** | `vite.config.js` 中 `sourcemap: false`，避免还原 TS 源码 |
| **剔除 console/debugger** | 生产构建自动 drop，减少调试信息泄露 |
| **CSP（内容安全策略）** | 生产 `index.html` 注入：仅允许本站脚本与构建时配置的 API/COS 连接 |
| **frame-ancestors 'none'** | 降低被恶意站点 iframe 嵌套（点击劫持） |
| **Referrer-Policy** | 缩短跨站 Referer 泄露 |
| **Permissions-Policy** | 仅本站可用 WebUSB，禁用无关传感器 |
| **robots noindex** | 降低被搜索引擎与爬虫批量收录 |
| **public/.nojekyll** | 避免 Jekyll 误处理静态资源 |
| **CI 扫描 dist** | Actions 部署前拒绝含 `*.map`、`dev-token`、`AKID` 等特征的产物 |

### 构建产物中仍可能出现的信息

- 构建时写入的 API 地址（来自 Actions Variables，非 README）
- WebUSB 允许的 VID/PID（设备认证需要）

密钥类信息（JWT、COS Secret、SSH 密码）仅放在服务器 `backend/.env`。

### 更新 API 地址

仅在 GitHub **Settings → Actions → Variables** 修改 `VITE_API_BASE`，重新部署即可；**不要**写回 README 或 workflow 明文。

### 可选进一步加固

- 仓库设为 **Private**（源码不公开；Pages 仍可绑定自定义域名）
- 前端域名备案后改用 **COS + CDN**，在 CDN 层配置 `Strict-Transport-Security` 等 HTTP 头
