# 佳点 V1PRO USB 传输协议说明

> 供官网、上位机、联调同事同步使用。  
> 网站深链接（`v1pro://`）见 [website-v1pro-protocol.md](./website-v1pro-protocol.md)。

**固件参考：** `V1PRO/User/usb_flash_transfer.c`、`usb_flash_transfer.h`  
**上位机参考：** `V1PRO/tools/usb_send_gif.py`、`usb_flash_query.py`  
**文档版本：** 2026-06-02（与当前工程一致）

---

## 1. 整体架构

```
网站 HTTPS 素材
    ↓  v1pro:// 深链接（可选）
佳点V1PRO控制工具（PC）
    ↓  图片/GIF/视频 → 编码为 GFM1
    ↓  WinUSB Bulk OUT
CH32V203 固件
    ↓  写入外置 SPI Flash
    ↓  LCD 播放 RGB565 动画
```

网站侧**不直接**访问 USB；通常由已安装的 Windows 控制工具完成「下载 → 转码 → USB 下传」。若需对接第三方上位机，按本文 **USBDL + GFM1** 实现即可。

---

## 2. USB 设备层

| 项目 | 值 |
|------|-----|
| VID | `0x0483` |
| PID | `0x66AA` |
| 设备类 | WinUSB（MS OS 2.0 描述符，接口 Class `0xFF`） |
| 传输类型 | Bulk |
| EP1 OUT | `0x01`，Host → Device，**64 字节/包** |
| EP1 IN | `0x81`，Device → Host，**64 字节/包**（命令应答） |
| 操作系统 | Windows 需 WinUSB 驱动；控制工具优先 `WinUSB.dll`，失败时回退 PyUSB |

**Bulk 分包：** 主机可将任意长度数据拆成 ≤64 字节的 USB 包连续发送；设备按 EP1 OUT 环形缓冲（64 槽 × 64 B）重组，**不要求**包边界与逻辑帧对齐。

**推荐发送块大小（上位机）：** `4096` 字节（`DEFAULT_USB_CHUNK`），仅影响主机侧 write 粒度，与设备 64 B USB 包无关。

---

## 3. USBDL 应用层帧格式

除「纯数据下传流」外，控制类消息均以固定魔数开头：

| 偏移 | 长度 | 说明 |
|------|------|------|
| 0 | 1 | `0xA5`（`USBDL_MAGIC0`） |
| 1 | 1 | `0x5A`（`USBDL_MAGIC1`） |
| 2 | 1 | 命令码 `CMD` |
| 3… | 变长 | 命令参数 |

**应答：** 设备经 **EP1 IN** 回 ASCII 文本（无 `\0` 结尾，长度 ≤64），例如 `JED,...`、`PONG,ok`、`DSP,255`。

---

## 4. 命令一览

### 4.1 心跳 `PING` — `CMD = 0x09`

**Host → Device（3 字节）：**

```
A5 5A 09
```

**Device → Host：**

```
PONG,ok
```

用途：检测设备在线、USB 通路正常。旧固件无此命令时，上位机可回退为 `JEDEC` 查询。

---

### 4.2 Flash 信息 `JEDEC` — `CMD = 0x07`

**Host → Device（3 字节）：**

```
A5 5A 07
```

**Device → Host（CSV 文本）：**

```
JED,<jedec_hex>,<model>,<total_mb>,<usable_mb>,<product_frames>
```

| 字段 | 说明 | 示例 |
|------|------|------|
| `jedec_hex` | 6 位十六进制 JEDEC ID | `856017` |
| `model` | 容量档：`64` / `128` / `256`（对应 PY25Q64/128/256） | `128` |
| `total_mb` | 外置 Flash 总容量（MB） | `16` |
| `usable_mb` | 动画可用容量（MB，已扣除保留区） | `15` |
| `product_frames` | 建议最大帧数（与容量档对应） | `154` |

容量档与最大帧数（固件常量）：

| model | 总容量 | 最大图片空间（张） |
|-------|--------|-------------------|
| 64 | 8 MB | 77 |
| 128 | 16 MB | 154 |
| 256 | 32 MB | 308 |

---

### 4.3 显示 / 背光 `DISPLAY` — `CMD = 0x08`

**推荐：亮度子命令（5 字节）**

```
A5 5A 08 FF <brightness>
```

| `brightness` | 行为 |
|--------------|------|
| `0` | 背光关 / 息屏 |
| `1`…`255` | PWM 亮度（`255` = 最亮） |

**Device → Host：**

```
DSP,<brightness>
```

**兼容：4 字节息屏开关（仍支持）**

```
A5 5A 08 <mode>
```

| `mode` | 行为 |
|--------|------|
| `0` | 开屏（恢复上次亮度） |
| `1` | 息屏 |

应答：`DSP,0` 或 `DSP,1`。

背光设置会写入 MCU 内部 Flash 元数据页，掉电可恢复。

---

### 4.4 动画下传 `START` — `CMD = 0x01`

**首包格式（≥8 字节）：**

```
A5 5A 01 <total_u32_le> [payload...]
```

| 字段 | 说明 |
|------|------|
| `total_u32_le` | 后续 **GFM1 载荷** 总字节数（小端 `uint32`），不含本 8 字节头 |
| `payload` | 可选；若首包带 payload，从偏移 8 起即为 GFM1 数据开头 |

**后续包：** 下传进行中（`s_rx_streaming=1`）时，EP1 OUT 上的数据**不再**带魔数，均为 GFM1 原始字节流，直到收满 `total` 字节。

**设备行为摘要：**

1. 校验 `total`：`0 < total ≤ usable_flash_bytes`
2. 预擦除 `[ANIM_FLASH_BASE, ANIM_FLASH_BASE + total)` 对应扇区
3. 数据经 4 KB staging 缓冲聚合后写入外置 Flash
4. 收满后校验 GFM1 头；成功则写 MCU 元数据指针，并自动播放

**Host 完整发送序列（逻辑字节流）：**

```
[ A5 5A 01 | total_le32 | 0x00 ] + <GFM1 blob>
  \____ 8 字节 START 头 ____/       \__ total 字节 __/
```

说明：上位机实现中 START 头为 8 字节（第 8 字节常为 `0x00` 填充），GFM1 从第 9 字节开始；设备只使用头中前 7 字节（魔数 + CMD + total），第 8 字节忽略，从偏移 8 起接收 payload。

### 4.5 设备认证 `AUTH` — `CMD = 0x0A`（**新固件已实现**）

用于网站 **强认证**（challenge + HMAC）。**当前网站未接入验签**，用户登录仍走 legacy（VID/PID + SN）；Host 不发 AUTH 时不影响现有功能。

完整定义见 **[v1pro-device-auth-spec.md](./v1pro-device-auth-spec.md)**。

| 子命令 | 字节 | 说明 |
|--------|------|------|
| CAP | `A5 5A 0A 00` | 能力查询 → IN: `AUTH,2,cap,hmac-sha256-v1` |
| SIGN | `A5 5A 0A 02` + 32B challenge | 签名 → IN: 34B 二进制块（`0xAB` 头 + 32B HMAC） |

---

## 5. GFM1 载荷格式

GIF/图片/视频在 **PC 端** 转为 GFM1，MCU **不解码 GIF**，只存储并按帧播放 RGB565。

### 5.1 文件头（64 字节，小端）

对应 C 结构 `AnimHeader64` / Python `struct.pack("<4sHHHHI40s", ...)`：

| 偏移 | 类型 | 字段 | 说明 |
|------|------|------|------|
| 0 | char[4] | magic | 固定 `"GFM1"` |
| 4 | uint16 | version | 固定 `1` |
| 6 | uint16 | lcd_w | 固定 `320` |
| 8 | uint16 | lcd_h | 固定 `170` |
| 10 | uint16 | frame_count | 帧数 `N`，≥1 |
| 12 | uint32 | pixel_bytes | `N × 320 × 170 × 2` |
| 16 | uint8[40] | reserved | 填 0 |

### 5.2 帧间隔表

紧接头之后，**`N × uint16`**（小端），单位 **毫秒**：

- 每帧显示时长；`0` 在播放时按 `100 ms` 处理
- 最小间隔：`ANIM_MIN_FRAME_MS = 1` ms

### 5.3 像素数据

偏移 `56 + N×2` 起，连续 **`N × 108800`** 字节：

- 分辨率：**320 × 170**
- 像素格式：**RGB565**（小端 uint16，R5G6B5）
- 每帧大小：`320 × 170 × 2 = 108800` 字节
- 帧顺序：与 delay 表一致

### 5.4 总长度

```
total = 64 + N×2 + N×108800
      = 56 + N×108802
```

固件校验：`pixel_bytes == frame_count × 108800`，且 `total` 与 START 命令一致。

### 5.5 大小限制

| 项目 | 值 |
|------|-----|
| Flash 动画区基址 | `0x00001000`（首 4 KB 扇区保留） |
| 最大载荷（256Mbit Flash） | `0x02000000 - 0x1000 = 33550336` 字节 |
| 上位机单文件上限（网站/客户端） | 500 MB（转码前） |

---

## 6. 外置 Flash 布局（动画区）

```
0x00000000 ─┬─ 保留 / 其他
0x00001000 ─┼─ ANIM_FLASH_BASE
            │   [ GFM1 header 64B ]
            │   [ delay × N ]
            │   [ frame0 RGB565 ]
            │   [ frame1 RGB565 ]
            │   ...
            └─ 至 total 字节（由 START 指定）
```

MCU 内部 Flash 末页另存 **MFP1** 元数据（已提交动画总字节数、背光偏好），用于掉电恢复。

---

## 7. 典型交互时序

### 7.1 连接检测

```
Host:  A5 5A 09
Dev:   PONG,ok
```

### 7.2 查询容量（传输前）

```
Host:  A5 5A 07
Dev:   JED,856017,128,16,15,154
```

### 7.3 下传动画

```
Host:  Bulk OUT  [START 8B][GFM1...]  （可拆成任意 64B USB 包）
Dev:   （无进度应答；完成后自动校验并播放）
```

可选：下传前 `A5 5A 08 FF 200` 调背光；下传中避免并发发送其他 USBDL 命令。

### 7.4 息屏 / 亮屏

```
Host:  A5 5A 08 FF 0        → Dev: DSP,0
Host:  A5 5A 08 FF 255      → Dev: DSP,255
```

---

## 8. 上位机与网站协作（摘要）

| 环节 | 负责方 | 说明 |
|------|--------|------|
| 素材 HTTPS 托管 | 网站后端 | 仅 HTTPS；域名白名单见 website 文档 |
| 唤起客户端 | 网站前端 | `v1pro://open?url=...&auto=1` |
| 转码为 GFM1 | 控制工具 | 320×170 RGB565，支持 GIF/图片/视频 |
| USB 下传 | 控制工具 | 本文 START + GFM1 流程 |
| 设备播放 | 固件 | 按 delay 表循环帧 |

网站同事若只对接「用户点击 → 素材到设备」，实现 **website-v1pro-protocol.md** 即可；若自研 PC 端或调试工具，需同时遵循本文 **§3–§7**。

---

## 9. 常量速查

```c
// 魔数与命令（usb_flash_transfer.h）
#define USBDL_MAGIC0  0xA5
#define USBDL_MAGIC1  0x5A
#define USBDL_CMD_START   0x01
#define USBDL_CMD_JEDEC   0x07
#define USBDL_CMD_DISPLAY 0x08
#define USBDL_DISPLAY_SUB_BRIGHTNESS 0xFF
#define USBDL_CMD_PING    0x09
#define USBDL_CMD_AUTH    0x0A   // 见 v1pro-device-auth-spec.md

#define ANIM_MAGIC    "GFM1"
#define ANIM_VERSION  1
#define ANIM_FLASH_BASE 0x00001000
```

```python
# 上位机（usb_send_gif.py）
VID, PID = 0x0483, 0x66AA
LCD_W, LCD_H = 320, 170
START = bytes([0xA5, 0x5A, 0x01])
DEFAULT_USB_CHUNK = 4096
```

---

## 10. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06-02 | 初版：USBDL 命令、GFM1、Bulk 下传、Flash 布局；与当前固件/工具对齐 |
| 2026-06-02 | 增加 §4.5 AUTH 索引，指向 v1pro-device-auth-spec.md |
| 2026-06-02 | 固件 AUTH 已实现；网站验签暂不接入，登录仍用 legacy |

如有协议变更，请同步更新本文及 `usb_flash_transfer.h` 注释。
