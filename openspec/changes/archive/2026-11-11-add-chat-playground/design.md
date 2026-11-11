## 上下文

现有桌面应用是单页配置管理：renderer 禁用 Node，经 preload 暴露的 `desktop.config`（5 个固定方法）与 `desktop.clipboard.writeText` 访问主进程；主进程不发起任何出站网络请求，renderer 的 CSP 允许 `connect-src http: https:` 但仅用于测速。对话页需要调用第三方模型网关，而这些网关普遍不带 CORS 头，renderer 直连会被浏览器同源策略拦截。

## 目标 / 非目标

**目标：** 在不放宽 renderer 权限的前提下，让对话能力可用；密钥与目标 URL 始终由主进程按配置解析。

**非目标：** 通用 HTTP 代理、任意 URL 抓取、把密钥交给 renderer、会话上云。

## 决策

### 决策 1：主进程受限转发，而非 renderer 直连

renderer 直连第三方网关会被 CORS 拦截（参照现有测速「无 CORS 目标降级为失败」的行为）。因此新增 `chat:start` IPC：renderer 只提交 model + base_url 与消息体，主进程重新读取最新 config → 按 model + base_url 定位 → 使用条目自带的 base_url 与 key 发请求。

约束：
- 目标 URL 必须来自配置条目，不接受 renderer 传入任意地址。
- 定位键为 `model + base_url`，不含密钥：密钥轮换不影响定位，且密钥永不进入 renderer。
- 只允许 `http:` / `https:`；`redirect: 'error'`，不跟随重定向。
- TLS 证书默认校验，禁止注入 `rejectUnauthorized: false` 或 NODE_TLS_REJECT_UNAUTHORIZED。
- 不转发上游任意响应头，只解析 SSE 数据体。
- 密钥只在主进程内存中使用，不出现在 IPC 响应或事件中。

### 决策 2：流式回传用「请求 id + 只读事件通道」

- `chat:start`（invoke）→ 返回 `{ success: true, id }` 或有限错误码。
- `chat:chunk`（主进程 → renderer 单向事件）→ `{ id, kind: 'thinking'|'text'|'usage'|'search'|'done'|'error', ... }`。
- `chat:cancel`（invoke）→ 中止指定 id。
- preload 只暴露 `desktop.chat.start/cancel/onChunk`，其中 `onChunk` 接收回调并返回退订函数；不暴露 `ipcRenderer` 本体。

关闭窗口/页面卸载时，主进程按窗口与请求 id 清理在途连接，避免事件泄漏到已销毁的 webContents。

### 决策 3：单条在途 + 独立载荷预算

配置通道的 64 KiB 预算不适用于附件与历史消息。对话通道单独设定上限 8 MiB 紧凑 JSON 等价 UTF-8，超限直接拒绝（不静默截断历史），并保持「全局单条在途、忙时拒绝、不排队」的既有风格。

### 决策 4：会话存 localStorage，按「网关 + 模型」分区

键前缀 `ccms.chat.v1.`，包含：`sessions`（索引）、`session:<id>`（消息）、`config`（模型/力度/联网搜索选择）、`active`（当前会话）。超限时降级为纯内存并提示。

附件不持久化：保存会话时剥离 `data` 字段，仅保留名称/类型/大小用于展示占位。

### 决策 5：Markdown 采用 GitHub 成熟库，不启用原始 HTML

使用 `react-markdown@10.1.0` + `remark-gfm@4.0.1`（均 MIT，GitHub 上长期维护）。安全配置：
- 不引入 `rehype-raw`，原始 HTML 按纯文本显示。
- `urlTransform` 只放行 `http(s)`，其余协议链接降级为文本。
- 自定义 `img` 组件不渲染 `<img>`，改为文本占位，避免远端图片造成外联。
- 不传 `components` 中的 `dangerouslySetInnerHTML` 路径。

SSE 解析在主进程用 `TextDecoder` + 手写分帧实现（无现成依赖满足「固定通道 + 取消 + 单在途」约束）。

## 风险 / 权衡

- **扩大主进程网络能力**：这是与既有「不新增主进程 URL 代理」约定的显式偏离，已在提案中获用户授权。缓解：目标限定配置条目、协议限定、禁止重定向、无响应头透传。
- **SSE 实现差异**：部分网关不发 `message_stop` 或字段名不同。策略：未收到结束事件即报「可能不完整」，不静默当成功。
- **localStorage 配额**：长对话会超限；降级为内存态并提示，不阻塞对话。
- **附件体积**：图片压缩到长边 1568 并转 JPEG，文本 256 KiB 上限，避免请求体失控。
- **思考力度语义**：不同模型族字段不同，按参考实现的二分（adaptive/effort vs enabled/budget_tokens）。
- **测试**：主进程网络层需注入 fetch 替身做单元测试；真实网关调用不在自动化测试内，需手动验证。

## 待决问题

无（首版范围、通道形态、存储位置均已与用户确认）。
