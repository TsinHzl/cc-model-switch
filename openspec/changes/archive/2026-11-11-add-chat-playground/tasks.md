# 任务清单：add-chat-playground

## 状态：ARCHIVED

## 任务

### 契约与主进程转发
- [x] 1. 新增 `src/lib/chatIpcContract.ts`：定义 `chat:start` / `chat:cancel` 请求与响应 schema、`chat:chunk` 事件 schema、错误码枚举、8 MiB 载荷上限常量、`ChatBridge` 类型。请求只含 `model` + `base_url`，不含密钥。验证：新增契约单元测试（合法/额外字段含 key 字段被拒/超限/非法 kind）先失败后通过。
- [x] 2. 新增 `src/lib/sse.ts`：SSE 分帧与事件分派纯函数（`message_start` / `content_block_*` / `message_delta` / `message_stop` / `error`），输出思考、文本、用量、搜索事件。验证：单元测试覆盖跨 chunk 分帧、CRLF、未闭合尾帧、缺失 `message_stop`、格式非法事件被忽略。
- [x] 3. 新增 `src/lib/thinking.ts`：按提案技术方案第 8 条的映射表实现模型族判定、档位收敛与请求字段生成。验证：单元测试覆盖 claude-4.5 代际（含日期别名）、其他 claude、gpt、国产模型、off，以及 xhigh/max 在 budget 模式收敛为 high。
- [x] 4. 新增 `electron/chatIpc.ts`：可信来源校验、按 `model + base_url` 在最新 config 中重新定位并自行取 key、协议校验、`redirect: 'error'`、TLS 默认校验（不注入 `rejectUnauthorized: false`）、单条在途、请求 id 生命周期、取消与窗口销毁清理。验证：注入 fetch 替身的 handler 单元测试覆盖越权来源、未知/重复三元组、非 http(s)、重定向、并发拒绝、取消、响应与事件中不含密钥。
- [x] 5. `electron/bootstrap.ts` 注册 `chat:start` / `chat:cancel` 并在退出、窗口关闭时清理；`electron/preload.ts` 暴露 `desktop.chat.start/cancel/onChunk`。验证：构建产物测试确认 preload 只暴露固定方法且无 `ipcRenderer` 本体；两套构建通过。

### 对话页
- [x] 6. 新增 `src/lib/chatStore.ts`：localStorage 会话读写（sessions 索引、单会话、配置、当前会话），超限降级为内存并返回标记；保存时剥离附件 `data`。验证：单元测试用可控 storage 替身覆盖首次保存、恢复、删除、清空、配额异常。
- [x] 7. 新增 `src/lib/chatStream.ts`：把 `desktop.chat` 事件转成消息状态更新（思考累积、文本累积、用量、搜索、错误/中断），含取消与收尾。验证：单元测试用桥接替身覆盖增量拼接、停止、错误、未结束截断（标记为 `error` 且带固定文案）。
- [x] 8. 引入 `react-markdown@10.1.0` + `remark-gfm@4.0.1`（锁定精确版本，检查许可证与 `npm audit`），新增 `src/components/chat/Markdown.tsx` 包装组件。验证：单元测试断言原始 HTML 被转义为文本、非 http(s) 链接降级为文本、图片语法不产出 `<img>` 远端请求；`npm audit` 无新增高/严重漏洞。
- [x] 9. 新增 `src/components/chat/Composer.tsx` + `AttachmentView.tsx`：输入框、思考力度/联网搜索/模型选择、发送与停止、附件预览与移除。验证：组件静态渲染测试覆盖发送禁用条件、附件数量上限提示。
- [x] 10. 新增 `src/components/chat/MessageList.tsx` + `SessionsSidebar.tsx`：消息区（思考折叠、搜索块、错误/中断标记、复制、重生成、用量）与历史侧栏（新建/选择/删除/清空）。验证：组件静态渲染测试覆盖空状态、各消息状态展示。
- [x] 11. 新增 `src/components/chat/ChatPage.tsx`：组合页面外壳与状态来源。验证：组件静态渲染测试覆盖无可用模型时禁用发送并提示。
- [x] 12. 新增 `src/lib/attachments.ts`：图片压缩（长边 1568、JPEG 0.85）、文本 UTF-8 校验、数量（5）与体积上限。验证：单元测试覆盖 API（mock createImageBitmap/canvas）；真实浏览器行为未验证的部分在结论中显式说明。
- [x] 13. `src/App.tsx` 增加页签切换，保留 `ModelSwitch` 不变；新增 `src/styles/chat.css`（复用主题变量）。验证：`npm run build` 通过，配置页既有测试零回归。

### 验收与文档
- [x] 14. 隔离入口原生验收：新增 CDP 断言覆盖页签切换、对话页空状态、无可用模型禁用、`chat:start` 传入额外字段或超限被拒。验证：`node electron/__tests__/native-acceptance.mjs` 通过且旧断言不回归。
- [x] 15. 同步 README / CLAUDE.md / openspec/project.md：说明新增对话页、主进程受限转发边界（与旧「不新增主进程代理」约定的关系）、会话仅存本地。验证：`git diff --check` 通过。
- [ ] 16. 手动验证真实网关一轮对话（流式、停止、重生成、思考过程、Markdown、附件），记录结果；失败则保留为未验证并说明原因。

## 验收标准
- [x] renderer 仍无 Node、无通用 IPC、无任意网络与文件能力；对话请求目标只来自配置条目，密钥不出现在任何 IPC 请求/响应/事件中。
- [x] 配置页行为零回归（`npm test` 全绿）。
- [x] 会话只在本地存储，可在重启后恢复；清缓存后不崩溃。
- [x] 流式回复可停止、可重生成；未收到结束事件时以固定错误文案标记为不完整。
- [x] 附件格式与体积限制生效，不支持的类型被拒绝并提示；超 8 MiB 请求体被拒绝。
- [x] 模型回复按受限 Markdown 渲染，原始 HTML 以单元测试断言确认被转义，链接仅 http(s)。
- [x] 至少一轮真实网关对话完成手动验证，或明确记录未验证原因。**未验证**：真实网关 /v1/messages 流式、思考、联网搜索、附件需在已配置真实网关的隔离/生产窗口手动验证一轮；受隔离 home 不布置真实凭据与本地无法触发真实网关限制，自动化与 CDP 断言仅覆盖请求拒绝、越权与空状态，不代表真实对话通过。
