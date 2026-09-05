# 安全与性能上线清单

## 管理员会话

管理员登录现在签发 8 小时短期 Session，不再把长期 `REVIEW_ADMIN_TOKEN` 作为登录密码或前端令牌。部署时必须设置独立且随机的 `ADMIN_PANEL_PASSWORD` 与 `REVIEW_ADMIN_TOKEN`，并轮换曾经出现在脚本或历史记录中的旧密码。

## CDN / COS

- `index.html` 使用 `no-cache` 或短缓存。
- `/assets/*` 使用 `public, max-age=31536000, immutable`。
- CDN HTTPS 边缘增加 CSP、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Permissions-Policy` 和 `X-Frame-Options`。
- 原始素材桶保持私有；下载和预览使用短时效签名 URL。

## 多实例

增加 API 服务器时，将 Session、API nonce、防重放和限流状态迁移到共享 Redis；不要依赖单机内存缓存。

## API 承载参数

单实例起步建议：

```env
MYSQL_MAX_OPEN_CONNS=40
MYSQL_MAX_IDLE_CONNS=10
HTTP_READ_TIMEOUT=30s
HTTP_WRITE_TIMEOUT=2m
HTTP_IDLE_TIMEOUT=60s
```

上传接口若需要更长时间，只提高 `HTTP_WRITE_TIMEOUT`，不要无限提高读超时。多实例时，所有实例连接池总和必须低于 MySQL `max_connections`，并为迁移、监控和管理员操作预留连接。

## 前端构建

FFmpeg 与 React 依赖已拆分为独立 chunk。发布前执行 `npm run build`，确认主入口和 FFmpeg chunk 均可从 CDN 返回，并检查 WebUSB、视频预览和 COS CORS。

## 密钥卫生

所有运维脚本必须通过 `REMOTE_SYNC_PASSWORD`、`ADMIN_PANEL_PASSWORD` 等环境变量获取凭据，禁止在脚本中写默认密码。凭据变更后重新部署并验证管理员登录、上传、微信通知和商城图片接口。
