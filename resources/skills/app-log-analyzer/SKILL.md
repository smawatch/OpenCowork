---
name: app-log-analyzer
description: app日志分析技能。当用户通过截图、粘贴文件路径、或直接上传文件的方式提供应用日志时使用。
  自动从截图中提取路径信息，拼接 OSS 域名获取日志压缩包，下载解压后分析，优先检索 BleLog 目录，最终定位问题。
---

# APP Log Analyzer

## 触发条件

以下任一情况激活此 skill：
- 用户说 "分析日志"、"帮我看下日志"、"看看这个报错"
- 用户粘贴了一张包含文件路径的截图（如应用日志详情页面）
- 用户上传了日志文件（.log / .txt / .zip）
- 用户直接给出了日志压缩包路径或 OSS 链接

## OSS 日志服务

应用日志以压缩包形式上传到 OSS，基础地址：
```
https://dev-oss.iot-solution.net/
```

**拼接规则**：从截图中识别到的路径直接拼接到域名后面。
示例：截图中看到路径 `logs/app/2025-07-01/logs.zip` → 完整 URL `https://dev-oss.iot-solution.net/logs/app/2025-07-01/logs.zip`

## 工作流程

### 场景 A：用户粘贴截图

1. **提取路径**：使用视觉能力识别截图中的所有文件路径
2. **拼接 URL**：每个路径拼上 `https://dev-oss.iot-solution.net/` 前缀
3. **下载压缩包**：用 WebFetch 或 curl 下载 zip 文件到本地临时目录
4. **解压**：解压到本地临时目录
5. **分析日志**：按下方「本地日志目录检索」和「日志文件读取」规则进行分析

### 场景 B：用户直接给出路径或链接

1. **判断来源**：是 OSS 在线链接还是本地 zip 路径
2. **获取压缩包**：在线链接 → 下载；本地路径 → 直接使用
3. **解压 → 分析**：同场景 A

### 场景 C：用户上传日志文件

1. **读取文件**：使用 Read 工具读取本地文件内容
2. **如果是压缩包**：先解压到临时目录，再按下方规则分析
3. **分析日志**：同下

## 本地日志目录检索（解压后）

压缩包解压后，按以下优先级检索日志目录：

### 1. 优先检索 BleLog 目录

解压后的根目录下通常包含多个子目录。**优先进入 `BleLog/` 目录**查找日志文件。
忽略其他与日志无关的目录（如配置文件目录、资源目录等）。

### 2. 未指定时间 → 自动选最新日期

`BleLog/` 目录下通常按日期组织子目录：

```
BleLog/
├── 2026-07-01/
├── 2026-07-02/
├── 2026-07-03/   ← 自动选这个
└── 2026-07-04/   ← 或这个
```

1. `ls BleLog/` 列出所有日期子目录
2. **按日期降序排列，取最新日期目录**
3. 在最新日期目录下查找日志文件

只有用户明确指定了日期（如 "看下 7 月 1 号的"），才用指定目录。

### 3. 忽略压缩包

在日志目录内：
- **跳过 `.zip`、`.tar.gz`、`.7z` 等压缩文件**，不扫描不解压
- 只关注 `.log`、`.txt` 后缀的原始日志文件
- 除非用户明确要求 "解压"、"压缩包里的"

### 4. 检索策略总结

```
用户输入                      → 检索行为
─────────────────────────────    ─────────────────────────────────────────
"分析日志"                     → 下载 → 解压 → BleLog/ → 最新日期/ → *.log
"看下 7/1 的日志"              → 下载 → 解压 → BleLog/2026-07-01/ → *.log
"看看 crash.log"              → 下载 → 解压 → BleLog/最新日期/ → crash.log
"解压看看 zip 里的东西"       → 不跳过压缩包，正常解压分析
```

## 日志文件读取策略（必须严格遵守）

### ⚠️ 硬性规则：禁止全量读取

**绝对不能**一次性读取整个日志文件。日志文件可能几 MB 甚至几十 MB，全量读取会超出 token 限制导致分析失败。

**禁止的操作**：
- ❌ `cat file.log`  /  `Get-Content file.log`（不带 Tail）
- ❌ `Read file.log`（不指定 offset/limit）
- ❌ 任何不带行数限制的读取命令

**使用 Read 工具时也必须限制行数**（适用于所有平台）：
- ✅ `Read file.log` 且指定 `offset` + `limit` 参数
- 示例：`Read file.log, offset=文件总行数-300, limit=300`（读最后 300 行）

**Unix/macOS（sh/bash/zsh）** ：
- ✅ `tail -n N file.log`
- ✅ `grep -iE "error|warn" file.log | tail -n 200`
- ✅ `wc -l file.log`

**Windows（PowerShell）** ：
- ✅ `Get-Content file.log -Tail N`
- ✅ `Select-String -Path file.log -Pattern "error|warn" | Select-Object -Last 200`
- ✅ `(Get-Content file.log).Count`

### 标准读取流程

**Step 1: 先看文件有多大**

Unix:
```bash
wc -l file.log
ls -lh file.log
```

Windows PowerShell:
```powershell
(Get-Content file.log).Count
(Get-Item file.log).Length
```

**Step 2: 根据大小决定策略**

```
行数        → 策略
─────────     ─────────────────────────────────
< 300 行     → 可以全量读（尾部 300 行）
300-1000 行  → 先读尾部 500 行，不够再补
> 1000 行    → 必须用过滤 + 尾部截取，绝不全量读
```

**Step 3: 大文件先过滤错误行再截取尾部**

Unix:
```bash
# 只提取错误和警告相关行，取最后 200 条
grep -iE "error|warn|fail|exception|crash|timeout" file.log | tail -n 200

# 结果太少则扩大关键字范围
grep -iE "error|warn|fail|exception|crash|timeout|ble|connect|disconnect|flag" file.log | tail -n 300
```

Windows PowerShell:
```powershell
# 过滤错误关键字，取最后 200 条
Select-String -Path file.log -Pattern "error|warn|fail|exception|crash|timeout" -AllMatches | Select-Object -Last 200

# 结果太少则扩大范围
Select-String -Path file.log -Pattern "error|warn|fail|exception|crash|timeout|ble|connect|disconnect|flag" -AllMatches | Select-Object -Last 300
```

**Step 4: 需要更多上下文时才扩大范围（绝不全量）**

Unix:
```bash
tail -n 500 file.log                              # 最后 500 行
tail -n 1000 file.log | head -n 500               # 倒数 500-1000 行
```

Windows PowerShell:
```powershell
Get-Content file.log -Tail 500                    # 最后 500 行
Get-Content file.log -Tail 1000 | Select-Object -First 500   # 倒数 500-1000 行
```

### 多文件时也是同样规则

如果 BleLog 目录下有多个日志文件，**对每个文件单独按上述规则处理**，不要合并后全量读取。

### 分析时关注最近内容

- 以**时间倒序**呈现错误（最近的排最前面）
- 标注每条错误距离文件末尾的位置
- 如果日志跨多个文件，优先分析最新文件的尾部

## 日志关键字速查

分析日志时，重点关注以下字段，帮助快速定位设备和用户上下文：

### 设备信息

| 关键字 | 含义 | 用途 |
|--------|------|------|
| `bleName` / `ble_name` / `deviceName` | 设备蓝牙名 | 确认出问题的设备是哪一台 |
| `flag` | 设备固件标记 | 判断设备固件版本、功能开关状态 |
| `mac` / `bleMac` / `ble_mac` | 设备蓝牙 MAC 地址 | 唯一标识设备，关联后台数据 |

## 日志分析指南

拿到日志内容后，按以下维度分析：

1. **错误摘要**：几行概括核心问题
2. **时间线**：按时间倒序标注关键错误发生的时间点（最近的在前）
3. **根因推测**：基于日志中的异常堆栈或错误信息推断可能原因
4. **建议修复**：给出具体可操作的排查/修复建议

## 深度分析：调用服务端接口（必须执行）

**这是强制步骤，不可跳过。** 日志分析完成后，你必须执行以下检查：

### 内置 MCP 服务器

当前项目内置了两个 MCP 服务器，可用于查询服务端数据：

| MCP 服务器 | 能做什么 |
|-----------|---------|
| `cowork-server-mcp` | 查询后台数据库、配置、用户数据等 |
| `apifox-new-mcp` | 查看接口文档，验证 API 契约 |

### 你必须做的事情

1. 日志分析完成后，**立刻检查**当前可用的 MCP 工具列表中是否已有 `mcp__builtin-cowork-server-mcp__` 或 `mcp__builtin-apifox-new-mcp__` 前缀的工具
2. 如果**有**这些工具 → 结合日志错误信息，调用对应的 MCP 工具获取服务端数据，完成深度分析
3. 如果**没有**这些工具 → **必须**用以下文案提示用户（直接复制，不要改写）：

> ⚠️ 日志分析需要关联服务端数据才能定位根因。内置 MCP 服务器未启用，请在下方输入框底部找到 **MCP** 数量标签，点击后勾选 `cowork-server-mcp` 或 `apifox-new-mcp`。然后告诉我重新分析。

**不得跳过此步骤，不得用其他方式代替。** 即使用户没有明确要求，也必须主动提示。

## 扩展

### 添加新的日志源

如需添加新的 OSS 域名或路径规则，修改本文的 OSS 日志服务部分即可。

### 支持更多文件类型

当前支持 `.log` / `.txt`，如需支持 `.json` 结构化日志、`.csv` 等，补充解析规则即可。
