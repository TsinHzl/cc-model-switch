# 变更提案：add-chat-playground

## 背景

当前桌面应用只有「模型切换」一个页面，用户需在外部终端里使用模型。用户要求在应用内新增「对话」页面，直接使用 `~/change-ai-config.json` 中已配置的模型与网关进行在线对话。界面参考同级仓库 `kiro2cc-proxy` 的 playground 页：左侧历史会话、右侧消息流、底部输入框（思考力度 / 联网搜索 / 模型选择 / 发送）。

## 目标范围

**在范围内：**
- 新增页面切换（模型切换 / 对话），保留现有配置管理页行为不变。
- 对话页布局：新对话按钮、历史会话列表、消息区、输入区。
- 模型来源：当前配置列表中的条目；模型与网关成对选择，key 由主进程按条目解析。
- 流式回复、停止生成、重新生成、复制回复、Markdown 渲染、思考过程可折叠、用量展示。
- 思考力度档位（off/low/medium/high/xhigh/max，按模型收敛）与联网搜索开关。
- 附件：图片（png/jpeg/gif/webp）与 UTF-8 文本文件，随消息发送。
- 会话历史保存在 renderer 的 localStorage；不写 config、settings、zshrc。
- 新增固定 IPC 通道，由主进程代为请求对话接口并流式回传。

**不在范围内：**
- 会话同步到服务端、跨设备同步、多账户登录。
- 修改 `~/change-ai-config.json`、`~/.claude/settings.json`、`~/.zshrc`。
- 新增任意 URL 代理能力、任意文件读取、任意命令执行。
- 会话导出、搜索、重命名、分享。
- 附件持久化到 localStorage（附件只保留在当前会话内存与其所在消息的展示中，不写入存储）。
- 自动重试、自动重放、模型计费与额度统计。

## 技术方案

1. 页面结构：`App.tsx` 增加轻量页签状态（不引入路由库），在两组页面间切换；配置页保持原组件不变。
2. 对话请求不交由 renderer 直连（第三方网关普遍无 CORS）。新增三条固定通道：`chat:start`（invoke，提交请求）、`chat:cancel`（invoke，取消）、`chat:chunk`（主进程 → renderer 单向事件，按请求 id 关联）。
3. **密钥不进入 renderer**：`chat:start` 只接受 `model` + `base_url` + 消息 + 参数；主进程重新读取最新 config，按 `model + base_url` 定位条目（唯一性冲突时按数组首个匹配并在响应中返回序号），密钥完全由主进程从最新文件解析，不出现在任何 IPC 请求、响应或事件中。renderer 不得提交任意 URL、路径、命令或自定义请求头。
4. 主进程只允许请求配置列表中存在的 `base_url`；只接受 `http:`/`https:`；`redirect: 'error'` 拒绝任何重定向；默认校验 TLS 证书，禁止为兼容自签网关关闭证书校验；只解析流式响应体，不转发任意响应头。
5. preload 只暴露 `desktop.chat.start/cancel/onChunk`；`onChunk` 接收回调并返回退订函数，不暴露 `ipcRenderer` 本体或通用 `on`。
6. 请求在途数量限制：全局单条对话流，忙时拒绝新请求；不排队。窗口关闭或页面卸载时按请求 id 中止并清理、退订。
7. 会话存储在 localStorage，按「网关 + 模型」维度展示历史；超配额时降级为内存态并提示，不崩溃。
8. 思考力度收敛规则：以 `claude-opus-4-5` / `claude-sonnet-4-5` 代际（含带日期别名）与所有非 `claude-*`/`gpt-*` 前缀模型为一组，只提供 off/low/medium/high，超出档位（xhigh/max）收敛为 high，请求字段为 `thinking.enabled + budget_tokens`（low 4096 / medium 10240 / high 20000）；其余 `claude-*` 与 `gpt-*` 提供六档，请求字段为 `thinking.adaptive + output_config.effort`；`off` 两种情况都不发送 thinking 字段。
9. 附件在 renderer 内处理（图片压缩到长边 1568、JPEG 0.85；文本限制 256 KiB；单条最多 5 个），随请求消息体发送，不落盘。对话通道另有总请求体上限 8 MiB 紧凑 JSON 等价，超限直接拒绝并提示，不截断历史。
10. Markdown 采用 GitHub 成熟第三方库 `react-markdown@10.1.0` + `remark-gfm@4.0.1`（GFM 表格 / 任务列表 / 删除线）；不启用 `rehype-raw`，原始 HTML 按纯文本转义；`urlTransform` 仅放行 `http(s)` 链接；自定义 `img` 组件把图片语法降级为文本，不发起远端请求。

## 预期影响

- 应用从单页变双页，新增一条主进程网络能力，属于本提案显式授权的架构变更（此前约定「不新增主进程 URL 代理」）。
- CSP 的 `connect-src` 不再需要为对话放开任意 http(s)，renderer 不发起对话请求。
- 对话内容不会进入任何配置文件，清理应用数据即可删除历史。
- 网关不支持 `tools` 或图片时，联网搜索开关或图片附件会由上游返回错误，页面展示上游错误信息。

## 风险

- 主进程新增出站网络能力是安全面扩大：必须把目标限制为配置列表中已存在的 base_url，禁止 renderer 自带 URL/密钥，并校验重定向与协议。
- 定位键若包含密钥，密钥轮换后必然定位失败；因此定位键固定为 `model + base_url`，密钥只在主进程内读取使用。
- TLS 证书默认校验；如遇自签网关握手失败，按错误上报，不放宽校验、不关闭 sandbox。
- 流式事件的请求 id 与生命周期需要与窗口/取消严格绑定，否则可能串话或泄漏到已关闭窗口。
- 第三方网关的 SSE 实现不一致（缺少 `message_stop`、字段差异），需按「未收到结束事件即报截断」处理。
- 附件与历史消息会让单次请求体远大于现有 64 KiB 预算；对话通道单独设 8 MiB 上限，超限拒绝而非静默截断历史。
- localStorage 配额（通常 5 MB）可能被长对话占满，必须有降级路径。
- 会话与模型回复属于不可信内容：`react-markdown` 不启用 `rehype-raw`，原始 HTML 转义，链接仅 http(s)，图片语法降级为文本、不触发远端请求。
- 新增生产依赖 `react-markdown` 与 `remark-gfm`（GH 成熟库，MIT）：需锁定版本并检查许可证与已知漏洞。
- 联网搜索依赖上游 `web_search_20250305` 工具支持，非通用能力。
