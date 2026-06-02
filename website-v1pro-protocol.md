# 佳点 V1PRO 网站 ↔ 控制工具协议说明

供官网前端/后端联调使用。用户安装 `Setup.exe` 后，浏览器可通过 `v1pro://` 唤起控制工具并传输素材。

## 1. 链接格式

```
v1pro://open?url=<HTTPS地址>&auto=1&name=<可选文件名>
```

| 参数 | 必填 | 说明 |
|------|------|------|
| `url` | 是 | 素材 **HTTPS 直链**（需 URL 编码） |
| `auto` | 否 | `1`（默认）= 下载后自动传输；`0` = 仅加载 |
| `name` | 否 | 建议文件名，如 `demo.gif` |

**示例（未编码）：**

```
v1pro://open?url=https://www.jadot.cn/assets/demo.gif&auto=1&name=demo.gif
```

**编码后（浏览器跳转用）：**

```
v1pro://open?url=https%3A%2F%2Fwww.jadot.cn%2Fassets%2Fdemo.gif&auto=1&name=demo.gif
```

## 2. 前端示例

```javascript
function buildV1ProUrl(fileUrl, { auto = true, name = '' } = {}) {
  const params = new URLSearchParams();
  params.set('url', fileUrl);
  params.set('auto', auto ? '1' : '0');
  if (name) params.set('name', name);
  return 'v1pro://open?' + params.toString();
}

function transferToDevice(fileUrl, options) {
  window.location.href = buildV1ProUrl(fileUrl, options);
}
```

推荐流程：

1. 前端请求后端 API 获取 **短期有效的 HTTPS 下载地址**（可带 token）
2. 用户点击「传输到设备」
3. `window.location.href = buildV1ProUrl(signedUrl, { auto: true, name })`

## 3. 后端要求

- 仅提供 **HTTPS** 地址（客户端拒绝 `http://`）
- 当前允许域名：`jadot.cn`、`www.jadot.cn`（及子域名，如 `cdn.jadot.cn`）
- 需扩展域名时，修改客户端 `v1pro_gui/constants.py` 中 `PROTOCOL_ALLOWED_HOST_SUFFIXES` 并重新打包
- 单文件上限：**500 MB**
- 支持格式：图片 / GIF / GFM1 / 常见视频（与客户端拖放一致）

## 4. 客户端行为

1. Windows 注册表将 `v1pro://` 关联到 `佳点V1PRO控制工具.exe`
2. 程序下载文件到 `%LOCALAPPDATA%\佳点V1PRO\incoming\`
3. 加载到新手页素材栏
4. `auto=1` 时自动开始传输（需已连接 USB 设备）

若程序已在运行，新链接会转发给已有窗口，不会重复启动。

## 5. 未安装时的页面提示

浏览器无法静默检测控制工具是否已安装。**不建议**用 `window blur` 判断——Windows 下协议唤起成功时页面也可能保持焦点，会误报「未安装」。

推荐做法：

- 点击传输后显示轻提示：「已发送传输请求，请在控制工具中查看」
- 仅在用户主动点击「未安装？下载 Setup」时再弹出安装引导

```javascript
window.location.href = buildV1ProUrl(signedUrl, { auto: true, name });
showToast("已发送传输请求，请在佳点 V1PRO 控制工具中查看进度");
```

## 6. 本地测试（开发）

未安装协议时，可直接传参启动：

```bat
python run_gui.py "v1pro://open?url=https%3A%2F%2Fwww.jadot.cn%2F...&auto=1"
```

安装 `Setup.exe` 后，在浏览器或「运行」对话框粘贴 `v1pro://...` 测试。
