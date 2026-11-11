# cc-model-switch

提供 Claude Code 模型切换与配置管理的 Electron 桌面应用，复用 `~/change-ai-config.json` 格式，不执行原 shell 脚本。

采用 Electron + React 18 + TypeScript + electron-vite + Zod。页面经受限 preload/IPC 调用主进程业务与文件层，不再提供独立配置 HTTP 服务或浏览器使用入口。

当前仍在迁移中：仅 macOS 文件写入已接入；Linux 写入保持关闭，Windows 持久化尚未实现。已完成的 macOS arm64 验收：Electron 45.2.3 真实窗口（隔离入口经 CDP 驱动，24 项断言）、本机目录包 `release/mac-arm64/cc-model-switch.app` 构建、Koffi 随包加载与非仓库工作目录启动。未签名（adhoc）包的 Gatekeeper 放行行为、macOS x64、Windows/Ubuntu 原生行为、DMG/NSIS/AppImage 安装包、剪贴板原生与单实例锁仍待验收；构建通过不代表这些验收完成。

## 快速开始

准备 macOS 与 Node.js/npm（已验证 Node.js 25.9.0），并确认当前用户的三个文件已存在：

- `~/change-ai-config.json`：配置列表，可读写。
- `~/.claude/settings.json`：只读，用于识别当前模型。
- `~/.zshrc`：模型切换只写此文件的标记块。

安装依赖并单独下载 Electron 运行时；以下运行命令会打开桌面应用，生产入口使用当前账户的真实配置：

```bash
npm install --ignore-scripts
npm run desktop:install
npm run dev
```

遇到运行时下载失败时，先解决下载问题；不要关闭证书校验或 Electron sandbox。`--ignore-scripts` 跳过依赖安装脚本；Koffi 随包加载已在 macOS arm64 目录包内验证（包内 Electron 加载 `app.asar.unpacked` 的原生模块并成功调用系统函数），其他架构与平台仍未验证。

构建及预览使用：

```bash
npm run build
npm run preview
```

开发模式由 Electron 加载固定 loopback 开发页面，不提供配置 HTTP API；直接用普通浏览器打开页面会缺少桌面桥接。构建输出位于 `out/main`、`out/preload`、`out/renderer`；预览需先构建。

## 文件与访问边界

- 主进程按账户 home 派生固定文件路径，不接受页面指定路径、home、文件全文或 shell 命令；不执行或 source 用户配置。
- 页面禁用 Node，启用 sandbox、contextIsolation 和 webSecurity；配置 IPC 校验当前窗口、主 frame、可信来源及严格请求结构。生产资源由受限本地协议提供。
- 仅支持普通文件，拒绝目标和父路径中的符号链接；缺文件时报错，不自动创建。
- 写入拒绝硬链接、不支持的权限、所有权及无法可靠保留的 ACL、扩展属性或 flags；不以 root 运行，不通过放宽权限绕过检查。
- Linux 首版目标限定 ext4，但普通用户可能无法枚举隐藏元数据；安全方案与原生验证闭合并另获确认前，不开放 Linux 写入，也不增加提权能力。

## 功能

- **模型切换**：按 URL → 渠道分组；按 model/base_url/key 三元组识别激活项。只更新 `.zshrc` 置顶标记块中的 7 个 `ANTHROPIC_*` export，保留 bash `printf %q` 等价转义，不修改或清理 settings.json。
- **激活态**：优先读取 settings.json env，三元组全部为空或解析失败时回退 zshrc。写入 zshrc 后仍可能显示 settings 中的旧模型，这是既定优先级，不强制高亮刚选中的条目。
- **配置管理**：新增、编辑、删除只写 change-ai-config.json，保持四空格缩进和末尾换行；默认隐藏 key，可切明文、复制、搜索及按分组快捷新增。
- **冲突保护**：主进程写前重读最新内容；切换按三元组定位，编辑/删除校验原数组下标与三元组。写操作进程内串行，并在替换前复核目标及依赖，写后回读。此机制不是跨进程 CAS，不能保证与外部工具绝对互斥。
- **复制与测速**：复制经桌面只写剪贴板桥接；Env 在 macOS/Linux 生成 shell 文本，在 Windows 生成 PowerShell 当前会话赋值，不自动执行或持久化。测速由 renderer 发起，仅允许 HTTP(S)，不携带配置密钥，不经主进程代理。

## 错误处理与限制

- 遇到配置损坏、缺文件或权限问题，页面显示安全错误，不显示配置原文；修复本地文件后点“重试读取”。
- 缺少桌面桥接时明确报错，不回退 HTTP。通信失败或提示“可能已写入”时，先重新读取核对，不直接重复操作；重启应用也不自动重放写请求。
- 写入成功但状态刷新失败会分别提示，不能把它当作未写入。剪贴板失败或结果未知也可能已改变内容，不自动重试复制。
- 已打开的终端不会即时更新环境变量，请在新 shell / Claude 会话中确认配置。
- 桌面应用不设密码门禁，启动即进入配置管理；访问控制由操作系统账户与文件权限负责，不把 IPC 宣称为恶意本机进程隔离边界。
- Windows Env 空值在 PowerShell 5.1、7.0–7.4 中删除变量，7.5 起保留空字符串；生成文本尚未在真实 PowerShell 中验收。

## 验证

```bash
npm test
npm run desktop:typecheck
npm run build
npm run desktop:test:build
npm test -- server/__tests__/service.test.ts electron/__tests__/configIpc.test.ts
```

测试覆盖共享转换逻辑、临时目录真实文件 IO、固定 IPC 处理、客户端契约及实际构建产物。测试不依赖独立领域预构建；`vite.config.ts` 仅保留测试所需 React 转换配置，桌面构建使用 `electron.vite.config.ts`。

隔离构建输出到 `out-test`，采用专用临时 home/userData；不得用生产入口执行自动化配置写入测试。home/userData 隔离不隔离系统剪贴板，原生复制验收须使用另行授权的账户、会话或虚拟机及合成文本，不读取个人剪贴板。单元测试、VM 桥接测试和交叉构建均不能替代对应平台原生验收。
