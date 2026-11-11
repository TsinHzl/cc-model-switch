# CLAUDE.md

本文为 Claude Code 提供本仓库开发约定。

## 项目概览

项目使用 Electron + React 18 + TypeScript + electron-vite + Zod，页面经固定 preload/IPC 调用主进程业务与文件层。没有独立配置 HTTP 服务、浏览器使用入口或 File System Access API。

当前仅 macOS 文件写入已接入；Linux 写入保持关闭，Windows 持久化尚未实现。macOS arm64 已完成真实窗口（隔离入口 CDP）、目录包构建与 Koffi 随包加载验收；其他平台、安装包、剪贴板原生与单实例锁仍待验收，不以测试或构建通过代替。

## 常用命令

```bash
npm install --ignore-scripts
npm run desktop:install    # 单独下载 Electron 运行时
npm run dev                # desktop:dev，打开桌面开发应用
npm run build              # desktop:build，类型检查并构建三个目标
npm run preview            # desktop:preview，需先构建
npm run desktop:typecheck  # 主进程、preload、服务与测试类型检查
npm run desktop:test:build # 构建隔离入口到 out-test
npm test                   # vitest run，无领域预构建
npm test -- server/__tests__/service.test.ts electron/__tests__/configIpc.test.ts
npm test -- src/lib/__tests__/applyConfig.test.ts
npm test -- -t "关键词"
npx tsc -b                 # 页面类型检查；仓库无 ESLint/Prettier 配置
```

注意生产入口使用真实账户 home；自动化验收必须使用隔离入口，不得结束非本次创建的进程。运行时下载失败时不得关闭证书校验或 sandbox。

## 核心架构：受限桌面桥接

- `electron/main.ts` 显式启动 `bootstrap`，生产 home 来自 `os.userInfo().homedir`；`electron/testing/main.ts` 使用隔离资源，不允许 renderer 指定 home。
- `electron.vite.config.ts` 构建 main/preload/renderer 到 `out`；测试配置单向复用并输出到 `out-test`。根 `vite.config.ts` 仅保留测试转换配置。
- `electron/renderer.ts` 生产使用受限本地资源协议及 CSP；开发仅接受固定 `http://127.0.0.1:5173`，没有配置 HTTP API。
- 页面禁用 Node，启用 sandbox、contextIsolation、webSecurity，禁止 webview；preload 只暴露 platform、五个配置方法、只写剪贴板和 `chat`（start/cancel/onChunk），不暴露通用 IPC、FFI、路径、命令或 URL 代理。
- 配置 IPC 检查当前窗口、主 frame、实际 origin 与页面地址、严格结构及 64 KiB 紧凑 JSON 等价预算；五方法共用一个在途名额，忙时拒绝、不排队。预算不覆盖传输前克隆开销，单名额不是频率限流。
- 对话 `chat:start` 只收 `model + base_url` 与消息体，主进程按二者在最新 config 中定位自取 key，只允许 http(s)、禁止重定向、保留 TLS 校验，单条在途；密钥不进入 renderer，错误不暴露原文。
- `server/files.ts` 固定 config（`~/change-ai-config.json`）、settings（`~/.claude/settings.json`）、zshrc（`~/.zshrc`）；只有 config/zshrc 可写。
- `server/service.ts` 用 Zod 校验业务输入和磁盘列表，直接导入 `applyConfig.ts`、`configModel.ts` 纯函数；不要复制转义或分组算法。错误不暴露文件原文、密钥或真实 home。

## 数据流与客户端契约

- `apiClient.ts` 调用 `desktop.config` 固定方法，缺桥接明确报错，不回退 HTTP；状态返回校验后的 entries/groups/activeIndex，不返回文件原文。
- `configStore.loadConfigState()` 调用 state 桥接；主进程读取三个最新文件，按 URL → channel 分组，保留 JSON 顺序及原数组下标。分组扁平序不等于数组序。
- `readActive()` 优先使用 settings env 的 model/base_url/key 三元组：任意字段非空即使用，三字段全空或解析失败才回退 zshrc；`findActiveIndex()` 要求完全相等。
- `apply` 按 expected 三元组在最新 config 中定位，仅写 zshrc，settings 原样保留；channel 不参与身份判定。
- `add` 新增，`edit/remove` 同时校验原下标和 expected 三元组。新增/删除保留其他条目的未知字段；编辑整体替换目标为四个已知字段。
- 写成功为 `{ success: true }`，不附带状态；客户端写失败抛 ApiError。`reload()` 返回 boolean 且自行设置安全错误态，`applyModel()` 写成功后返回刷新结果；不能把刷新失败当作写入未发生。
- `WRITE_UNCERTAIN` 或 `IPC_ERROR` 需要重新读取核对；通信中断、刷新或重启均不得自动重放写请求。ready 状态刷新不先卸载列表，防滚动归零。

## 与脚本兼容的格式

- zshrc 标记为 `# >>> change-ai-config >>>` / `# <<< change-ai-config <<<`，置顶插入 7 个 `ANTHROPIC_*` export；`shellQuote()` 保持 bash `printf %q` 等价转义。
- change-ai-config.json 保持四空格缩进和末尾换行。
- 当前桌面行为不包含写 settings 或互斥清理；不要因历史纯函数仍在而恢复这些入口。
- 改动共享纯函数必须回归 applyConfig、shellQuote、configModel 测试。

## 文件写入契约

- 所有写入经 `createFileStore().update(key, transform)`，基于传入最新文本计算；依赖读取必须经 transform 的 `readDependency` 登记快照。
- 只支持普通文件，拒绝目标及父路径符号链接；拒绝 root、硬链接和不支持的写权限/所有权。`server/metadata.ts` 保守检测 macOS ACL、xattr、flags，检测失败不得退化为直接写入。
- 无变化不写；写队列串行，排他创建同目录 0600 临时文件，保留允许的 mode/uid/gid，fsync，替换前复核目标/依赖，再 rename、目录 fsync、回读。
- 替换前失败清理临时文件；rename 后异常报告 WRITE_UNCERTAIN，不自动重试。不要移植旧 FSA 的 InvalidStateError 重试或收敛判定。
- 队列及替换前检查不是跨进程 CAS，不宣称绝对互斥。不得 source、执行或 shell 插值用户配置。
- Linux 首版目标仅 ext4，但安全方案未闭合前保持写入关闭；不可用属性枚举空列表证明不存在特殊元数据，不增加 CAP_SYS_ADMIN。Windows 文件与注册表存储尚未实现。
- 文件层与 IPC 集成测试使用临时 home；原生验收还须隔离 userData、会话及 Windows 注册表位置，不访问真实个人配置。

## UI 结构

页面由 `App.tsx` 提供「模型切换 / 对话」两个页签；配置页为单页 `ModelSwitch`（搜索、分组、切换确认与增删改弹窗），对话页 `ChatPage` 组合侧栏、消息区与输入区。桌面应用不设密码门禁：启动即进入配置管理，访问控制由操作系统账户与文件权限负责，IPC 不因此被视为恶意本机进程隔离边界。

- key 默认由 `maskKey()` 脱敏。测速仍由 renderer 发起，仅允许 HTTP(S)，不携带配置密钥，不增加主进程代理。
- 对话页会话/选择/活动会话仅存 renderer localStorage（`ccms.chat.v1.*`），超限降级为内存并提示；保存剥离附件 正文 data。直接进入对话页即恢复上次会话，不触碰配置文件。Markdown 用 react-markdown + remark-gfm（无 raw HTML、仅 http(s)、图片降级文本）。
- 复制经 `desktop.clipboard.writeText`，仅写、单在途、1 MiB 原始 UTF-8 上限，等待原生 Promise 完成；失败或结果未知可能已改变剪贴板，不自动重试。
- Env 在 macOS/Linux 保留 shell 格式，Windows 使用 PowerShell 当前会话赋值，不执行、不持久化；空值遵循目标 PowerShell 版本语义。
- home/userData 隔离不隔离系统剪贴板；原生剪贴板验收须另获授权，使用隔离账户/会话或虚拟机及合成文本，不读取个人剪贴板。

## 规范

- `openspec/specs/cc-config-management/spec.md` 是当前行为规范，`openspec/project.md` 记录架构约定；归档保留历史，不作为恢复旧行为的依据。
- 常规提交格式沿用 `<type>: <中文描述>`；用户确认跳过 OpenSpec 的变更遵守其专用提交前缀约定。
