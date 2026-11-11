# 项目上下文

## 技术栈

- 单项目仓库：Electron + React 18 + TypeScript + electron-vite，主进程 Node 文件 API，Zod 边界校验，Vitest 测试。
- 页面通过受限 preload/IPC 操作固定配置，没有独立配置 HTTP 服务或浏览器使用入口。
- 迁移仍在进行：当前仅 macOS 写入已接入，Linux 写入保持关闭，Windows 持久化及三平台安装包待实现和验收。macOS arm64 已验证真实窗口（隔离入口 CDP）、目录包构建、Koffi 随包加载及非仓库工作目录启动；未签名包 Gatekeeper 行为、x64、剪贴板原生与单实例锁仍未验证。

## 架构约定

- 生产页面使用受限本地资源协议及 CSP；开发页面固定在 `127.0.0.1:5173`，仅作为 Electron renderer 开发入口，不挂载配置 API。
- 配置来自账户 home 的固定三个文件；config 可读写，zshrc 可读写，settings 只读，不存主进程配置副本，不接受 renderer 指定 home 或路径。
- 模型切换仅写 zshrc，保留七键 export、标记块及转义格式；settings 优先用于激活态识别，不做互斥清理。
- 只支持普通文件，拒绝符号链接；写前重读、校验三元组/原数组下标，进程内串行原子替换、写后回读，不宣称跨进程 CAS。
- 页面禁用 Node，启用 sandbox、contextIsolation 和 webSecurity；固定 IPC 校验当前窗口、主 frame、实际 origin、请求结构及载荷。配置操作单在途、忙时拒绝，不宣称频率限流。
- 桌面应用不设密码门禁，页面直接进入配置管理，访问控制由操作系统账户与文件权限负责；桥接缺失不回退 HTTP，通信失败及写入不确定时重新读取核对，不自动重放。
- Linux 首版仅考虑 ext4；普通用户不可见元数据的安全缺口未解决前保持写入关闭，不放宽契约或增加提权能力。

## 目录结构

- `src/`：页面、桌面桥接客户端、共享契约和领域纯函数。
- `server/`：TS 固定文件 IO、macOS 元数据检测、业务服务及真实 IO 测试；由主进程直接导入，不独立启动。
- `electron/`：主进程、preload、固定 IPC、资源与窗口边界、隔离测试入口及测试。
- `electron.vite.config.ts` / `electron.test.vite.config.ts`：生产和隔离构建；`vite.config.ts`：测试所需 React 转换配置。
- `out/` / `out-test/`：各含 main、preload、renderer，输出互不覆盖；不再独立构建领域模块。
- `openspec/`：项目上下文、当前 specs 与历史 changes 归档。

## 开发约定

- 使用 `npm test`、`npm run desktop:typecheck`、`npm run build`、`npm run desktop:test:build` 验证；无 ESLint/Prettier 配置。
- 通用 dev/build/preview 脚本分别调用已有桌面脚本；运行前须有 Electron 二进制，下载失败不关闭 TLS 或 sandbox。
- 测试只用临时配置和隔离入口，不修改真实个人文件或停止既有进程。home/userData 不隔离系统剪贴板，原生复制验收须另行授权。
- 缺少平台原生环境时保留待验收状态，不以替身、VM 或构建通过代替真实桌面及安装包验收。
- 常规提交格式沿用 `<type>: <中文描述>`；跳过 OpenSpec 的变更另遵守用户确认的前缀约定。
