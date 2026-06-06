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

1. 用户登录后，在 **mouseenter / 展示素材时** 预先请求 `GET ...&download=1` 缓存 `data.url`（可 async）
2. 用户点击「传输到设备」时 **禁止 await**，在同一同步调用栈执行：
   `window.location.href = buildV1ProUrl(cachedUrl, { auto: true, name })`
3. 页面轻提示：「已发送传输请求，请在控制工具中查看」

**禁止** 在 click 的 async 回调里用 iframe / `window.open` 打开 `v1pro://`（Chrome/Edge 会静默拦截，不弹「打开应用」）。

## 3. 后端要求

- 仅提供 **HTTPS** 地址（客户端拒绝 `http://`）
- 当前主站域名：`jadot.cn`、`www.jadot.cn`（及子域名，如 `cdn.jadot.cn`）
- 过渡域名（仍可解析）：`jiadianer.cloud`、`www.jiadianer.cloud`
- 需扩展域名时，修改客户端 `v1pro_gui/constants.py` 中 `PROTOCOL_ALLOWED_HOST_SUFFIXES` 并重新打包
- 单文件上限：**500 MB**
- 支持格式：图片 / GIF / GFM1 / 常见视频（与客户端拖放一致）

## 4. 客户端行为

1. Windows 注册表将 `v1pro://` 关联到 `佳点V1PRO控制工具.exe`
2. 程序下载文件到 `%LOCALAPPDATA%\佳点V1PRO\incoming\`
3. 加载到新手页素材栏
4. `auto=1` 时自动开始传输（需已连接 USB 设备）

若程序已在运行，新链接会转发给已有窗口，不会重复启动。

## 5. 页面提示（勿检测是否已安装）

浏览器**无法**可靠判断控制工具是否已安装。以下做法均会误报，**禁止**使用：

- `window blur` / `visibilitychange` 推断未安装（Windows 下协议唤起成功时页面也可能保持焦点）
- 传输成功后自动弹出「未检测到 / 未安装控制工具」类模态框

推荐做法：

- 点击传输后仅显示轻提示：「已发送传输请求，请在控制工具中查看」
- Setup 下载链接放在页脚，由用户自行点击，**不要**在传输流程里弹出安装引导

```javascript
launchV1ProTransfer(signedUrl, { auto: true, name }); // 内部用隐藏 iframe 打开 v1pro://
showToast("已发送传输请求，请在佳点 V1PRO 控制工具中查看进度");
```

## 6. 本地测试（开发）

未安装协议时，可直接传参启动：

```bat
python run_gui.py "v1pro://open?url=https%3A%2F%2Fwww.jadot.cn%2F...&auto=1"
```

安装 `Setup.exe` 后，在浏览器或「运行」对话框粘贴 `v1pro://...` 测试。
