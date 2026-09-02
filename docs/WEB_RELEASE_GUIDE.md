# 佳点 HUB 网站线上发布流程与注意事项

> 适用范围：当前 V1PRO视频分享站仓库。本文描述现有脚本和 CI 的实际行为，命令中的密钥、令牌、密码和生产地址均不得写入 Git。发布前请先确认当前分支和工作区状态；本文不会替代腾讯云、GitHub 或服务器的权限审批。

## 1. 线上架构和发布边界

| 部分 | 默认位置/入口 | 发布方式 | 说明 |
| --- | --- | --- | --- |
| React/Vite 前端 | GitHub Pages（仓库 Actions） | 推送 main/master，或手动运行 Deploy to GitHub Pages | .github/workflows/deploy-pages.yml 会先构建，再部署 Pages；同一工作流还会部署网站 COS |
| Go API | 云服务器上的 jiadian-api.service | 交叉编译 Linux 二进制，经 SFTP 上传后重启 | 远程根目录和服务名可由 tools/云服务器同步指南.md 与同步环境变量覆盖 |
| 素材和业务数据 | COS + API 的 JSON/MySQL 存储 | 上传素材后同步映射/清单；后端配置留在服务器 | 不要用前端构建覆盖服务器上的生产数据 |
| 浏览器 FFmpeg | public/ffmpeg/，也可发布到软件 COS | 随前端发布，或运行 scripts/publish_ffmpeg_assets_to_cos.py | 需要 GET/HEAD CORS 和长期缓存 |
| 自定义域名 | CNAME、public/CNAME | DNS/CNAME 在域名或 CDN 控制台维护 | 当前仓库文件内容是 www.jadot.cn；改域名前必须同步 DNS、CSP、CORS 和 API 配置 |

默认前端发布路径是 GitHub Pages。tools/deploy_website_cos.py 是可选的 COS 镜像脚本，不会被普通 git push 调用；不要把 GitHub Pages、网站 COS、素材 COS 和 CDN 源站混为同一个桶。

前端使用 HashRouter，线上路由形式为 /#/...。public/404.html 仅用于 Pages 的兜底跳转；直接访问不带 # 的服务器端路径不应作为路由配置依据。

## 2. 发布前的本地检查

### 2.1 工作区和敏感文件

先确认没有把别人的未提交改动、生产数据或二进制一起发布：

~~~bash
git status --short
git diff --check
git branch --show-current
git fetch origin
git log --oneline -5
~~~

只暂存本次明确修改的文件，避免直接无选择地执行 git add .。尤其不要提交：

- 根目录 .env、.env.local 和 backend/.env；
- JWT_SECRET、API_SIGN_SECRET、COS SecretId/SecretKey、微信支付私钥、管理员令牌、第三方 AI Key；
- backend/jiadian-api、*.exe、dist/、node_modules/、安装包和服务器日志；
- 含真实用户积分、分享次数、审核队列或其他生产运营数据的 JSON（除非已确认是公开的基线数据）。

仓库已有 .gitignore 和《GitHub 上传与保密说明》，发布前仍必须检查 git status；被忽略不等于已从历史提交中清除。若密钥曾经出现在提交、日志或聊天记录中，应立即在云服务控制台轮换，并更新服务器配置。

### 2.2 前端依赖、类型、代码和构建

CI 使用 Node.js 20，锁文件必须与安装结果一致：

~~~bash
npm ci --no-audit --no-fund
npm audit --audit-level=high
npm run typecheck
npm run lint
npm run build
~~~

npm audit、类型检查、ESLint 或构建任一失败，都不要继续发布。构建完成后确认 dist/index.html、dist/404.html、dist/CNAME（如构建配置复制）和 dist/assets/存在。

生产构建由 vite.config.js 执行以下约束：

- sourcemap: false，生产构建移除 console 和 debugger；
- 根据 VITE_API_BASE 注入 CSP；
- VITE_BASE_PATH 通常为 /；
- VITE_STATIC_MODE=false 时，前端会请求真实 API；没有正确的 API 地址时，页面可能能打开但登录、素材列表和上传会失败。

### 2.3 后端测试和安全检查

.github/workflows/deploy-pages.yml 的 backend-quality 是前端部署的前置条件，因此 Go 测试失败也会阻止 Pages/COS 发布：

~~~bash
cd backend
go test ./...
go run golang.org/x/vuln/cmd/govulncheck@v1.7.0 ./...
cd ..
~~~

若 Go 版本或依赖有变，先在本地复现 CI 使用的版本，再修改代码或锁定依赖。

## 3. 前端正式发布（GitHub Pages）

### 3.1 配置 Actions Variables/Secrets

在仓库 Settings → Secrets and variables → Actions 中配置：

**Variables（变量）**

- VITE_API_BASE：生产 API 的完整 HTTPS 基地址，不要带末尾 /；
- VITE_API_SIGN_SECRET：与后端 API_SIGN_SECRET 配套的浏览器请求签名值；它会被打包进前端，只能用于降低低成本滥用，不能当作真正的服务器密钥。

**Secrets（密钥）**

- COS_DEPLOY_SECRET_ID；
- COS_DEPLOY_SECRET_KEY。

工作流把 VITE_BASE_PATH=/、VITE_STATIC_MODE=false 固定传入构建，并用 v1site-1311844229、ap-guangzhou 调用 scripts/deploy_cos.py。如果生产桶、区域或发布策略要改变，应先修改并审核工作流；不要在聊天、README 或构建日志中打印密钥。

### 3.2 推送和观察流水线

完成检查后，只提交已审查文件：

~~~bash
git add <本次修改的文件>
git diff --cached --check
git commit -m "描述本次发布"
git push origin main
~~~

推送会触发 Deploy to GitHub Pages 工作流（main 和 master 均匹配）。工作流执行以下阶段：

1. 安装 Node 依赖、审计、类型检查、Lint 和 Vite 构建；
2. 扫描 dist，发现 source map、dev-token、AKID、SECRET_KEY 或私钥标记时直接失败；
3. 上传 Pages artifact 并部署 GitHub Pages；
4. 下载同一个构建 artifact，运行 scripts/deploy_cos.py 上传网站 COS；
5. 先通过 Go 后端测试和 govulncheck，才允许上述部署作业继续。

在 GitHub Actions 中确认 build、backend-quality、deploy、deploy-cos 全部成功，并记录工作流运行编号。只看到“代码已推送”不能证明线上已更新。

### 3.3 发布后浏览器验证

使用无痕窗口或清除站点缓存后检查：

1. 首页、/#/auth、/#/leaderboard、/#/share、/#/webusb-test 能正常加载；
2. DevTools 的 Network 中 index.html 返回 200，入口 JS/CSS 不出现 404；
3. API 请求指向预期的 VITE_API_BASE，不是 GitHub Pages 自身的 /api；
4. 登录、素材列表、图片/GIF/视频预览、网页直传和退出认证各做一次最小验证；
5. Chrome/Edge 的 WebUSB 授权弹窗和设备释放行为正常；没有设备时页面不会自动连接或卡在“正在自动连接”；
6. 浏览器控制台没有动态 import 404、CSP、CORS 或 Failed to fetch。

网页直传自动帧率验收建议至少各做一次：

- GFM3 新固件：从设备报告的上限开始，按最终 GFM3 压缩字节逐步降到 20fps；仍超出容量时才自动加速；
- 旧固件：走稳定的 25fps 兼容路径，空间不足时按既有兼容逻辑加速；
- 素材卡片不再提供 20/25/30fps 选择，完成提示只显示传输结果；分享表单中的创作者参数属于独立设置，不要误当成卡片固定策略；
- 传输中途关闭详情弹窗后，顶层进度仍持续更新，完成后 USB 接口和句柄都应释放。

如果入口 HTML 已更新而旧 JS 仍被缓存，先确认 CDN/COS 的 index.html 已失效，再检查资产是否真的上传成功；带内容哈希的 assets/* 不应随意改成短缓存。

## 4. 网站 COS / CDN 发布

### 4.1 工作流自动部署的 COS

工作流中的 deploy-cos 使用 scripts/deploy_cos.py，需要以下进程环境变量（CI 已注入，手动运行时自行设置）：

~~~text
COS_BUCKET
COS_REGION
COS_SECRET_ID
COS_SECRET_KEY
~~~

脚本会逐个比较 ETag、大小、Content-Type 和 Cache-Control，只上传有差异的文件，最后才上传 index.html。当前缓存策略是：

- index.html、HTML、CNAME、version.json：no-cache, no-store, must-revalidate；
- assets/、ffmpeg/：public, max-age=31536000, immutable；
- 其他文件：public, max-age=86400。

这能避免入口 HTML 指向尚未上传的哈希资产。若 CDN 仍返回旧入口，只刷新入口 HTML；不要为了一个入口问题清空整个素材桶。

### 4.2 手动镜像脚本（谨慎使用）

仓库还提供 tools/deploy_website_cos.py。它默认只提示 GitHub Pages 发布；只有明确需要 COS 镜像时才执行：

~~~bash
python tools/deploy_website_cos.py --use-cos
~~~

可选参数：--skip-build、--no-delete。脚本默认从 backend/.env 或环境变量读取 WEBSITE_COS_BUCKET/WEBSITE_COS_REGION 和 COS_SECRET_ID/COS_SECRET_KEY，默认桶名与工作流桶可能不同。脚本默认会删除远端多余对象（除非指定 --no-delete），因此执行前必须核对桶、区域和 dist 内容；不要对素材桶执行此脚本。

### 4.3 CDN、CNAME 和自定义域名

接入 CDN 时确认：

- DNS 的 CNAME 指向 CDN 控制台显示的 CNAME，且没有与旧 A 记录冲突；
- 源站协议、回源 Host、证书和源站桶区域一致；
- HTTPS 证书覆盖所有实际访问主机名；
- CDN 缓存规则保留入口 HTML 的短缓存/不缓存，哈希资产可长期缓存；
- 切换域名后同步 CNAME、vite.config.js 的允许来源、FFmpeg CORS 来源、后端 CORS_ALLOW_ORIGIN 和前端 API 地址；
- 国内/境外加速、备案和 CDN 账号限制以 CDN 控制台当前状态为准，不把“已创建”当作“DNS 已生效”。

DNS 生效后可用以下方式确认响应头和链路（不要把带签名的私有 URL 写入文档）：

~~~bash
curl -I https://<站点域名>/
nslookup <站点域名>
~~~

若使用 CDN 刷新，优先刷新 /index.html 或具体变更对象；刷新全部目录会增加回源流量和等待时间。

## 5. COS 素材、预览和浏览器 FFmpeg

### 5.1 素材桶和网站桶分离

后端 .env.example 区分了资源、图片、软件、视频、GIF、视频封面和 GIF 封面桶。真实 bucket、region、密钥应只放服务器 .env，由后端签发短期读取 URL。前端不应保存 COS Secret，也不应把私有桶改成永久公有读来“修复”预览。

### 5.2 CORS

浏览器直接读取 COS 对象需要正确的 CORS。仓库现有脚本：

- tools/set_cos_material_cors.py：读取服务器 .env，检查各素材桶的 GET/HEAD 与上传 CORS，并做签名图片探测；
- tools/set_cos_gif_cors.py：更新 GIF 与 GIF 封面桶的 PUT/GET/HEAD 规则；
- scripts/publish_ffmpeg_assets_to_cos.py：发布 FFmpeg 核心并确保允许站点 GET/HEAD 的 CORS。

执行这些脚本前先检查脚本中的站点来源是否包含当前主域名/备用域名，并确认使用的是正确的账号和桶。CORS 只解决“浏览器是否允许读取响应”，不解决对象不存在、签名过期、CDN 回源失败或 Content-Type 错误。

### 5.3 FFmpeg 首次加载和版本

src/services/ffmpegAssetCache.ts 在真正开始转换时才加载 FFmpeg；核心文件启用长期缓存，首次使用仍可能下载约 32 MB。修改 public/ffmpeg/后应重新构建并验证 ffmpeg-core.js、ffmpeg-core.wasm 的响应状态、大小、MIME 和 CORS。若 CDN 使用旧文件，更新入口或 FFmpeg 版本查询参数，不要手工改生产 JS 文件名。

## 6. 后端 API 发布

### 6.1 交叉编译

在项目根目录执行（Windows PowerShell）：

~~~powershell
$env:GOOS = "linux"
$env:GOARCH = "amd64"
$env:CGO_ENABLED = "0"
go build -o backend/jiadian-api ./backend
~~~

确认输出是 Linux ELF，而不是 Windows PE；该二进制已被 .gitignore 忽略，不能提交 GitHub。若服务器架构不是 amd64，必须按实际架构重新编译。

### 6.2 上传和重启

tools/sync_cloud.py 的默认行为是同步清单/映射 JSON；--binary 才会上传 backend/jiadian-api，并且默认不覆盖线上 JSON。建议先在一次维护窗口内执行：

~~~powershell
$env:REMOTE_SYNC_HOST = "<服务器地址或 IP>"
$env:REMOTE_SYNC_PORT = "22"
$env:REMOTE_SYNC_USER = "<SSH 用户>"
$env:REMOTE_SYNC_PASSWORD = "<临时输入，不要写入脚本>"
$env:REMOTE_SYNC_BASE_PATH = "/opt/jiadian-hub/app"
python tools/sync_cloud.py --binary --restart --verify
~~~

仅同步素材清单时：

~~~powershell
python tools/sync_cloud.py --restart --verify
~~~

只有明确要用本地清单覆盖服务器时才加 --with-config；该选项可能覆盖线上用户刚分享的内容。脚本会把文件先传到 /home/ubuntu 临时位置，再用 sudo install 替换，并在重启后检查服务和 http://127.0.0.1:8080/api/verify-token。

也可使用 tools/deploy_binary.py --binary --restart 只部署二进制，或按脚本支持的 --quota/--shop 同步对应业务 JSON。首次使用前阅读脚本帮助，不要凭记忆拼接参数。

### 6.3 服务器环境变量和监听

生产 .env 只在服务器维护。backend/.env.example 当前包含：

- PORT（默认代码回退为 8080）和可选 LISTEN_ADDR；
- 同时设置 TLS_CERT_FILE、TLS_KEY_FILE 时由 Go 原生 HTTPS 监听，否则为 HTTP；
- JWT_SECRET 必填；启用 API 签名时 API_SIGN_SECRET 也必填；
- CORS_ALLOW_ORIGIN 支持逗号分隔的明确来源，生产不要使用 *；
- COS、数据库、审核、微信支付和 AI 服务的密钥/令牌；
- 请求超时、限流和 STORAGE_BACKEND/MYSQL_DSN 等运行参数。

修改 .env 后先运行配置检查，再重启：

~~~bash
sudo systemctl restart jiadian-api.service
systemctl is-active jiadian-api.service
sudo journalctl -u jiadian-api.service -n 100 --no-pager
~~~

不要假设公网一定是 8080 或 8443；以服务器 .env、systemd 单元、监听端口和 DNS/CDN 当前配置为准。若启用了原生 TLS，证书链、私钥权限和证书覆盖域名必须一起核验。

### 6.4 API 签名和 CORS 验证

当前 API 签名由前端 VITE_API_SIGN_SECRET 和后端 API_SIGN_SECRET 配合生成 HMAC 请求头，时间戳默认允许约 5 分钟偏差（可由 API_SIGN_MAX_SKEW_SEC 调整），nonce 用于防重放。服务器和客户端系统时间不准会出现“API 签名已过期”。

生产联调可使用仓库脚本（密钥从环境变量或本地未跟踪文件读取）：

~~~bash
python tools/api_smoke_test.py
~~~

如公网 API 不是脚本默认值，先设置不落盘的 API_BASE。脚本会检查无签名请求被拒绝、签名请求成功、错误签名被拒绝、资源/标签接口和管理员接口。不要把 backend/.api_sign_secret.local 或管理员 Token 加入 Git。

## 7. 发布后验收清单

建议按以下顺序记录结果：

### 基础可用性

- [ ] DNS、CDN CNAME、TLS 证书状态正常；
- [ ] 首页和一个带 # 的受保护路由能打开；
- [ ] 静态入口、JS、CSS、FFmpeg 文件没有 404；
- [ ] API 签名、CORS、登录和 token 验证正常；
- [ ] jiadian-api.service 为 active，重启后日志无 panic/配置缺失；

### 素材链路

- [ ] 图片、GIF、视频各预览一次，响应 MIME/Range/CORS 正确；
- [ ] 资源映射、封面映射和数据库/JSON 数据与线上一致；
- [ ] 小文件可从 CDN 命中，大文件不会错误地回源到网站桶；
- [ ] 网页直传完成后设备能收到数据，USB 句柄能释放；
- [ ] 新固件/旧固件兼容逻辑、预擦除和失败回退各做一次最小测试；

### 运营与安全

- [ ] 上传、删除、管理员、活动和支付接口按权限验证；
- [ ] 限流、审核、积分和订单状态未被发布过程覆盖；
- [ ] 没有在构建产物、Actions 日志、截图或浏览器控制台泄露密钥；
- [ ] 记录本次 Git commit、Actions run、后端二进制校验值和配置变更摘要。

## 8. 回滚方案

### 前端回滚

1. 在 GitHub Actions 中重新部署上一个已验证 commit，或将发布分支安全地恢复到该 commit 后重新推送；
2. 先确认旧版本的 VITE_API_BASE、API 签名和静态资源仍与后端兼容；
3. 若使用 CDN/COS，刷新 index.html，不要删除仍被旧入口引用的哈希资产；
4. 回滚后重新执行“发布后验收清单”。

不要用 git reset --hard 覆盖未确认的用户改动；如需回滚，优先使用新提交明确反向修改，保留审计记录。

### 后端回滚

1. 保留上一份可启动的 Linux jiadian-api 二进制和校验值；
2. 通过 SFTP 上传到服务器临时路径，确认权限后原子替换；
3. sudo systemctl restart jiadian-api.service，检查 systemctl is-active 和日志；
4. 若数据库迁移已执行，先确认迁移是否可逆，不能只回滚二进制；
5. 验证 API 签名、COS 签名 URL、素材列表和管理接口。

### COS/CDN 回滚

不要把网站 COS 回滚脚本指向素材桶。若入口 HTML 发布错误，优先恢复上一个 index.html 并刷新入口；只有确认对象不再被任何版本引用时才清理旧对象。私有素材对象删除属于不可逆操作，必须先备份映射和确认影响范围。

## 9. 常见故障定位

| 现象 | 先查什么 | 常见原因 |
| --- | --- | --- |
| 页面能开但 API 404/不可达 | 构建产物中的 VITE_API_BASE、DNS、CORS | Actions Variable 为空、API 域名/端口变更、CORS 未加入新域名 |
| 动态 import 404 | index.html 与 assets/的发布时间、CDN 缓存 | 入口已更新但资产未上传、CDN 缓存旧 HTML |
| 图片/GIF“预览不可用” | 签名 URL、COS 对象、响应 CORS/MIME/Range | 对象被删、签名过期、桶 CORS/权限或 CDN 回源配置错误 |
| API 提示缺少签名/签名过期 | 前后端签名变量、电脑/服务器时间 | VITE_API_SIGN_SECRET 与 API_SIGN_SECRET 不一致，时钟偏差或 nonce 重用 |
| 服务重启后 502 | systemctl status、journalctl、二进制格式/权限 | 二进制被 git stash -u 带走、上传了 Windows PE、证书路径或必填环境变量错误 |
| 网页直传卡住/USB claim 失败 | 是否有本地 GUI 占用、浏览器授权、任务是否释放 | 本地软件未关闭、旧页面仍持有句柄、浏览器不支持 WebUSB |
| CDN 流量异常 | CDN 命中率、回源 Host、缓存规则、对象大小 | 入口或媒体被短缓存、回源循环、预览反复重试 |

## 10. 发布记录模板

每次线上发布建议保存一条不含密钥的记录：

~~~text
日期/时区：
发布人：
Git commit：
GitHub Actions run：
前端域名/CDN：
API 域名和监听端口（仅记录公开配置）：
后端二进制 SHA-256：
是否同步素材清单：是/否
是否执行 COS/CDN 刷新：是/否（对象范围）
验收结果：
回滚点：
异常与后续任务：
~~~

真实密钥、私钥、SSH 密码、数据库 DSN 和带签名的 COS URL 不得填入该记录。
