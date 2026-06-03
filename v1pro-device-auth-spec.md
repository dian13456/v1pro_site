# 佳点 V1PRO 设备认证协议（USBDL AUTH）

> **读者：** MCU / 固件同事、上位机联调  
> **依赖：** [v1pro-usb-protocol.md](./v1pro-usb-protocol.md)（USBDL 帧格式、EP1 IN/OUT 约束）  
> **文档版本：** 2026-06-02  

### 实现状态（2026-06-02）

| 模块 | 状态 | 说明 |
|------|------|------|
| **MCU 固件 AUTH** | ✅ 已实现 | CAP / SIGN、`device_secret` 烧录 |
| **网站 WebUSB 验签** | ⏸ 暂不接入 | 前端仍走 legacy `/api/auth`（VID/PID + SN） |
| **后端 challenge / 验签 API** | ⏸ 暂不接入 | 产线 secret 导入与 `/api/auth/challenge` 待后续上线 |

当前线上用户 **无需升级浏览器流程**；新固件设备与旧网站可共存（Host 不发 AUTH 时不影响下传与登录）。

---

## 1. 背景与目标

### 1.1 现状问题

网站当前 `/api/auth` 仅校验 Host 上报的 **VID/PID + SN 字符串**，无法证明 SN 来自真实 USB 设备，存在脚本伪造风险。

### 1.2 目标

在 **不改变** 现有 PING / JEDEC / DISPLAY / START 行为的前提下，新增 **USBDL AUTH** 命令，使 Host 能向设备索取 **对服务端随机挑战码（challenge）的 HMAC 签名**，后端据此签发 **强认证 token**（`authVersion = 2`）。

### 1.3 非目标（本阶段不要求 MCU 实现）

- 不在 MCU 内实现 HTTPS / JWT  
- 不改变 GFM1 下传流程  
- 不替换 WinUSB 描述符与 EP 分配  

---

## 2. 与老固件的兼容策略

| 固件 | AUTH 命令 | 网站登录 |
|------|-----------|----------|
| **旧固件**（无 `0x0A`） | 无应答 / 超时 | 走 **legacy** 弱认证（`authVersion = 1`，后端可配置关闭） |
| **新固件**（实现本文） | 正常 SIGN | **强认证**（`authVersion = 2`） |

**MCU 侧要求：**

1. 未实现的命令 **不得** 误触发 START 下传或擦 Flash。  
2. 收到未知 `CMD` 时，建议 **忽略** 或 IN 回 `AUTH,0,unsupported`（ASCII，≤64 B），**不要** 复位 USB。  
3. 新固件 **必须** 仍完整支持 §4.1–§4.4 原有命令。

---

## 3. 安全模型（简要）

```
┌─────────┐   ① challenge    ┌─────────┐   ② SIGN 命令    ┌─────────┐
│ 网站后端 │ ───────────────► │ 浏览器  │ ───────────────► │  MCU    │
└─────────┘                  └─────────┘                  └─────────┘
      ▲                            │                            │
      │         ③ serial +         │         HMAC               │
      └──────── challenge + sig ───┘ ◄───────────────────────────┘
                    ④ 验签通过后发 token
```

| 元素 | 说明 |
|------|------|
| **device_secret** | 每机唯一 **32 字节** 随机密钥，产线烧录，不出设备 |
| **serial** | USB 字符串描述符中的 Serial Number（与现网一致） |
| **challenge** | 服务端生成的 **32 字节** 随机数，**5 分钟**有效，**一次性** |
| **signature** | `HMAC-SHA256(device_secret, message)`，`message` 见 §5.3 |

**后端** 在产线导入 `serial → device_secret` 映射后验签；**MCU 不保存** 服务器公钥。

---

## 4. 新增命令：`USBDL_CMD_AUTH = 0x0A`

在现有魔数帧内扩展（与 PING/JEDEC 相同，**非** START 流式模式）：

| 偏移 | 长度 | 说明 |
|------|------|------|
| 0 | 1 | `0xA5` |
| 1 | 1 | `0x5A` |
| 2 | 1 | `0x0A`（AUTH） |
| 3 | 1 | 子命令 `SUB` |
| 4… | 变长 | 子命令参数 |

**下传进行中（`s_rx_streaming=1`）时收到 AUTH：** 应 **丢弃** 或 NAK，**不得** 打断 START 流。

---

## 5. 子命令定义

### 5.1 能力查询 `SUB = 0x00`（CAP）

Host 探测固件是否支持设备认证。

**Host → Device（4 字节）：**

```
A5 5A 0A 00
```

**Device → Host（EP1 IN，ASCII，≤64 字节）：**

```
AUTH,2,cap,hmac-sha256-v1
```

| 字段 | 含义 |
|------|------|
| `AUTH` | 固定前缀 |
| `2` | 认证协议版本 `auth_proto = 2`（与网站 `authVersion` 对齐） |
| `cap` | 能力查询应答 |
| `hmac-sha256-v1` | 当前唯一支持的签名算法 |

**旧固件：** 无应答（Host 超时 ≥200 ms 判定为 legacy）。

---

### 5.2 挑战签名 `SUB = 0x02`（SIGN）

**Host → Device（36 字节）：**

```
A5 5A 0A 02 [challenge × 32]
```

| 字段 | 说明 |
|------|------|
| `challenge` | 32 字节二进制，来自网站后端，Host **原样**转发 |

**Device 行为：**

1. 读取 USB 字符串 **Serial Number**（与 WebUSB `device.serialNumber` 一致）。  
2. 若 SN 为空或不可用 → IN 回 ASCII：`AUTH,2,err,no_serial`  
3. 若 `device_secret` 未烧录（全 0 或 magic 无效）→ `AUTH,2,err,no_secret`  
4. 计算签名（§5.3）  
5. 通过 EP1 IN 回复 **二进制块**（§5.4）

**注意：** SIGN 过程中 **不要** 在 USB 包内附带 SN；SN 由 Host 从描述符读取并与验签请求一并提交给后端。

---

### 5.3 签名算法 `hmac-sha256-v1`

**Message 构造（字节拼接，无长度前缀）：**

```
message = domain || serial_utf8 || challenge
```

| 部分 | 内容 |
|------|------|
| `domain` | 固定 ASCII：`V1AUTHv1`（8 字节） |
| `serial_utf8` | Serial Number 的 UTF-8 字节，**不含** `\0` |
| `challenge` | Host 下发的 32 字节 |

**签名：**

```
signature = HMAC-SHA256(key = device_secret, data = message)   // 32 字节
```

**C 伪代码：**

```c
#define V1AUTH_DOMAIN     "V1AUTHv1"
#define V1AUTH_DOMAIN_LEN 8
#define V1AUTH_CHALLENGE_LEN 32
#define V1AUTH_SECRET_LEN    32
#define V1AUTH_SIG_LEN       32

int v1auth_sign(const uint8_t secret[V1AUTH_SECRET_LEN],
                const char *serial_utf8,
                const uint8_t challenge[V1AUTH_CHALLENGE_LEN],
                uint8_t out_sig[V1AUTH_SIG_LEN])
{
    // 使用 MCU 侧 SHA256 + HMAC 库（如 mbedTLS / 自研）
    // hmac_update(domain)
    // hmac_update(serial, strlen(serial))
    // hmac_update(challenge, 32)
    // hmac_final(out_sig)
}
```

**测试向量（联调必过）：**

```
device_secret = 00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF (32 B)
serial        = "TESTSN001"  (UTF-8)
challenge     = AA * 32 (32 字节均为 0xAA)
message       = "V1AUTHv1" + "TESTSN001" + (AA*32)
signature     = 待固件与后端各自算出后填入联调表（首次联调时双方对齐）
```

---

### 5.4 SIGN 应答（EP1 IN，二进制）

因 EP1 IN 仅 **64 字节/包**，且 HMAC 为 32 字节二进制，**SIGN 成功应答采用二进制**，与 JEDEC/PONG 的 ASCII 区分。

**Device → Host（34 字节，单次 IN 读完）：**

| 偏移 | 长度 | 值 | 说明 |
|------|------|-----|------|
| 0 | 1 | `0xAB` | 二进制应答魔数 `AUTH_REPLY_MAGIC0` |
| 1 | 1 | `0x01` | 应答格式版本 |
| 2 | 1 | `0x02` | 子命令 SIGN 的回显 |
| 3 | 1 | `0x00` | 状态：`0x00`=成功 |
| 4 | 32 | — | `signature[32]` |

**失败时（仍用 ASCII，便于调试）：**

```
AUTH,2,err,<reason>
```

| `reason` | 含义 |
|----------|------|
| `no_serial` | 无有效 SN |
| `no_secret` | 未烧录密钥 |
| `busy` | 正在 START 下传 |
| `bad_len` | challenge 长度不对 |

Host 解析规则：

- 若首字节为 `0xAB` → 按二进制成功块解析  
- 若首字节为 `'A'`（`0x41`）→ 按 ASCII 错误解析  

---

## 6. 产线与密钥存储（MCU + 工厂）

### 6.1 `device_secret` 存储建议

| 项目 | 建议 |
|------|------|
| 长度 | 32 字节 |
| 来源 | 产线 TRNG / 服务器下发后一次性写入 |
| 存储位置 | CH32V203 **用户配置区 / 独立 Flash 页**，与动画元数据页分离 |
| 读保护 | 使能 RDP / 读保护，禁止 SWD 直接 dump（按项目现有安全策略） |
| 无效标记 | 全 `0x00` 或全 `0xFF` 视为 **未Provisioning** → SIGN 回 `no_secret` |

### 6.2 产线导出（给网站后端导入）

CSV 格式（**禁止**进公开 Git）：

```csv
serial,secret_hex,vid,pid,auth_proto
0483XXXX1234,00112233445566778899AABBCCDDEEFF00112233445566778899AABBCCDDEEFF,0483,66AA,2
```

后端文件路径（规划）：`config/device_secrets.json`（加密-at-rest，由运维管理）。

### 6.3 与第二 VID/PID 的关系

网站白名单含 `0483:66AA` 与 `2E3C:5753`。若两档产品共用 AUTH 实现，**secret 仍按 SN 唯一**；`vid/pid` 仅作后端辅助校验。

---

## 7. Host 侧流程（供 MCU 理解联调顺序）

> **当前阶段：** 仅固件与上位机/脚本可联调 AUTH；**网站不做验签**，§7.1 供后续上线参考。

### 7.0 现阶段联调（无网站）

可用 PC 工具或 Python（WinUSB/PyUSB）验证：

```
1. CAP:  OUT A5 5A 0A 00  →  IN  AUTH,2,cap,hmac-sha256-v1
2. 本地生成 32B 随机 challenge（不必调后端）
3. SIGN: OUT A5 5A 0A 02 + challenge[32]
4. IN:   读 34B 二进制（0xAB 头 + signature）
5. 用产线 CSV 中的 device_secret 本地算 HMAC，与 signature 对比
```

### 7.1 网站 WebUSB 强认证（authVersion = 2）— **后续实现**

```
1. 用户选择 USB 设备（WebUSB，VID/PID 过滤不变）
2. GET/POST /api/auth/challenge  →  { challenge: base64(32B), challengeId, expiresAt }
3. Bulk OUT: A5 5A 0A 02 + challenge
4. Bulk IN:  读 ≤64 B → 解析 0xAB 二进制签名
5. 读取 device.serialNumber
6. POST /api/auth
     {
       "authVersion": 2,
       "serial": "...",
       "vid": "0483",
       "pid": "66aa",
       "challengeId": "...",
       "signature": "<base64(32B)>"
     }
7. 后端验签 → 返回 token
```

### 7.2 Legacy 回退（authVersion = 1）— **当前网站默认**

```
1. CAP 超时或无 AUTH,2,cap,... 
2. POST /api/auth { "authVersion": 1, "serial", "vid", "pid" }  // 无 signature
3. 后端按配置决定是否接受（兼容期）
```

MCU **无需** 区分 WebUSB 与 PC 工具；只要正确实现 AUTH 命令即可。

---

## 8. 后端验签（供联调对照，**网站暂未实现**）

```
expected = HMAC-SHA256(device_secret, "V1AUTHv1" || serial || challenge)
constant-time compare(expected, signature)
```

附加校验：

- `challengeId` 未使用、未过期  
- `serial` 与产线登记一致  
- `vid/pid` 在白名单  
- 通过后签发 token（带 `authVersion: 2` 声明，TTL 见 `TOKEN_TTL_DAYS`）

---

## 9. 固件改动清单（Checklist）

- [x] `usb_flash_transfer.h` 增加 `USBDL_CMD_AUTH 0x0A` 与子命令枚举  
- [x] `usb_flash_transfer.c` 解析 `A5 5A 0A xx`，与 START 流互斥  
- [x] 集成 HMAC-SHA256（或已有密码库）  
- [x] 产线 Provisioning 写入/校验 `device_secret`  
- [ ] CAP / SIGN 与 **网站后端** 端到端联调（网站侧暂缓）  
- [x] 确认 **旧命令** PING/JEDEC/DISPLAY/START 回归通过  
- [x] 更新 [v1pro-usb-protocol.md](./v1pro-usb-protocol.md) §4 命令表  

---

## 10. 建议常量（头文件草稿）

```c
#define USBDL_CMD_AUTH           0x0Au
#define USBDL_AUTH_SUB_CAP       0x00u
#define USBDL_AUTH_SUB_SIGN      0x02u

#define V1AUTH_PROTO_VERSION     2u
#define V1AUTH_CHALLENGE_LEN     32u
#define V1AUTH_SECRET_LEN        32u
#define V1AUTH_SIG_LEN           32u
#define V1AUTH_REPLY_MAGIC0      0xABu
#define V1AUTH_REPLY_FMT_VERSION 0x01u
#define V1AUTH_REPLY_STATUS_OK   0x00u

#define V1AUTH_DOMAIN            "V1AUTHv1"
#define V1AUTH_DOMAIN_LEN        8u
```

---

## 11. 时序图

```
Host (WebUSB)                         MCU
     |  A5 5A 0A 00 (CAP)                |
     | --------------------------------> |
     |  AUTH,2,cap,hmac-sha256-v1         |
     | <-------------------------------- |
     |                                     |
     |  A5 5A 0A 02 + challenge[32]       |
     | --------------------------------> |
     |  AB 01 02 00 + signature[32]       |
     | <-------------------------------- |
```

---

## 12. 常见问题

**Q：IN 包最大 64 字节，为何 SIGN 用二进制？**  
A：32 字节 HMAC 若用 hex ASCII 需 64 字符，再加前缀会溢出；二进制 34 字节可一次 IN 返回。

**Q：challenge 能否更短？**  
A：协议固定 32 字节；若 Host 误发更短，回 `AUTH,2,err,bad_len`。

**Q：是否要在 MCU 存 challenge 防重放？**  
A：不需要。challenge 一次性由 **服务器** 记账；MCU  Stateless 签名即可。

**Q：PC 控制工具未更新，会影响下传吗？**  
A：不会。未发 AUTH 时行为与现网一致；仅网站登录无法享受 authVersion 2。

---

## 13. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-06-02 | 初版草案：AUTH 0x0A、CAP/SIGN、HMAC 消息格式、二进制 IN、legacy 兼容、产线 provisioning |

---

## 14. 评审待确认项

| # | 问题 | 结论 |
|---|------|------|
| 1 | HMAC 库选型 | 固件已实现 |
| 2 | `device_secret` Flash 地址与保护 | 固件已实现 |
| 3 | SIGN 成功二进制 / 失败 ASCII | 按本文 |
| 4 | 网站验签上线时间 | **待定**，当前不做 |
| 5 | 产线 secret 导入后端 `device_secrets.json` | 待网站阶段 |

后续网站接入时，需实现：`POST /api/auth/challenge`、`POST /api/auth`（`authVersion: 2`）、WebUSB CAP/SIGN 流程；此前 **legacy 登录保持不变**。
