# 变更提案：migrate-electron-desktop

## 背景
当前项目是 React 网页加本机 Node HTTP 服务。用户要求在当前仓库内改写为 Electron 桌面应用，全部应用源码采用 TypeScript，不保留独立网页服务。
本次采用轻量 OpenSpec，仅创建 proposal.md 和 tasks.md，不创建 spec.md 或 design.md。

## 目标范围
**在范围内：**
- 支持 macOS arm64/x64、Windows x64、Ubuntu 22.04/24.04 x64。
- 复用现有 React 界面、分组、搜索、复制、测速、切换确认和配置增删改。
- 将主进程、preload、现有 Node 业务与文件层、相关测试迁为 TypeScript。
- 通过受限 IPC 访问本机配置，移除独立 HTTP 服务、浏览器客户端协议及服务启停脚本。
- 保持配置列表位于账户 home 下 change-ai-config.json，settings.json 只读且优先用于激活态识别。
- macOS 写 .zshrc；Linux 目标仍为按账户登录 shell 写 .bashrc 或 .zshrc，其他 shell 明确拒绝切换。Linux 首版仅考虑 ext4；当前保持全部 Linux 文件写入关闭，待安全方案与原生验证闭合并另获确认后开放。
- Windows 写 HKCU\Environment 中当前用户的七个 ANTHROPIC_* 环境变量。
- Linux 元数据检测随应用分发，不要求用户安装 getfacl/getfattr/lsattr。
- 提供开发运行、类型检查、测试、目录包及 macOS DMG、Windows NSIS、Linux AppImage 构建配置。
- 同步现有启动说明和架构文档。

**新增范围（密码门禁移除）：**
- 桌面应用直接进入配置管理，移除「设置访问密码」「输入密码解锁」页面与流程。
- 删除 `src/components/Gate.tsx`、`src/lib/authStore.ts` 及其 localStorage/sessionStorage 键与门禁样式，`App.tsx` 直接渲染 `ModelSwitch`。
- 同步 CLAUDE.md、README、openspec/project.md 与当前 spec 中门禁相关描述。

**不在范围内：**
- 保留独立浏览器网页端、远程配置服务或开放任意文件访问。
- 自动更新、托盘、开机启动、云同步、商店发布或新增 CI 发布流程。
- 正式分发证书、macOS 公证、Windows 签名；首版提供未签名本地包。
- Windows/Linux ARM64、其他 Linux 发行版的支持承诺。
- 自动创建缺失配置、修改 settings.json、执行或 source 用户配置。
- 清理与本次迁移无关的既存代码及 UI 问题。

## 技术方案
1. 构建采用 Electron、electron-vite、electron-builder，保留 React、Vite、Zod、Vitest；增加 Node 类型和 Electron E2E 所需开发依赖。版本在落地时按兼容性和安全检查锁定。
2. 主进程管理单实例、窗口生命周期和固定业务服务；preload 仅暴露类型化的状态读取、切换、增删改和剪贴板写入能力。
3. renderer 禁用 Node，启用 sandbox、contextIsolation 和 webSecurity。每次 IPC 校验窗口身份、主 frame、可信 origin 和严格请求结构，限制载荷与排队数量。
4. 生产使用受限本地资源协议与 CSP；拒绝任意导航、子窗口、webview、下载及非必要权限。开发地址仅在非打包环境启用，不提供配置 HTTP API。
5. 共享领域纯函数由主进程直接导入 TS，不再通过独立 dist-server 构建桥接。配置路径只由主进程根据账户 home 决定，不接受 renderer 指定路径或命令。
6. 文件存储拆为共享业务契约和平台适配。保留普通文件校验、链接拒绝、大小与 UTF-8 限制、最新内容转换、依赖快照、串行写入、无变化不写及替换前后复核。
7. macOS 保留现有保守元数据检测。Linux 拟通过 Koffi 调用系统接口检查 xattr、ACL 相关属性和文件 flags，首版仅支持 ext4，其他文件系统拒写；不能仅凭 ext 系列共用的 magic 判断为 ext4。普通用户的属性枚举可能省略不可访问属性，空列表不能证明不存在特殊元数据；在这一安全缺口解决前保持 Linux 写入关闭，不以不完整检查放宽“不静默丢失属性”的契约。
8. Windows 通过 Koffi 调用系统 API。配置文件首版面向本地 NTFS，检查 reparse point、硬链接、owner/DACL、额外数据流和特殊属性；使用安全临时文件与经验证的替换机制，不能保留安全属性时拒写。
9. Windows 激活状态从注册表实际存储读取，不以 process.env 代替。七键使用原始字符串写入，不做 shell 转义、不经命令行传递密钥；写前复核，写后逐键回读并发送有超时的环境变更通知。
10. Windows 七键不是原子事务：区分写入前失败、已确认部分写入、结果不确定、写入成功但通知失败；不自动重试或盲目回滚。已有终端及 IDE 不保证立即获得新环境。
11. settings 三元组任一字段非空仍优先；全部为空或解析失败才使用平台目标。写入校验独立于激活高亮，不能因 settings 遮蔽而错误报告写入失败。
12. 配置 CRUD 保留原数组下标与三元组校验、未知字段处理、四空格缩进和末尾换行。不同平台间不新增配置文件字段或迁移个人数据。
13. 保留写成功与刷新失败的区分。刷新、IPC 中断和应用重启均不得自动重放写操作；部分写入提示只展示字段名和状态，不泄露值。
14. 复制 Env 在 macOS/Linux 使用现有 shell 格式，在 Windows 使用 PowerShell 当前会话格式；该操作只是复制，不执行也不持久化。
15. 测速继续由 renderer 发起，只允许 HTTP(S)，不携带配置密钥，不扩大主进程网络能力、不关闭浏览器安全检查；不可测时明确显示失败。
16. 桌面应用不再提供密码门禁：页面直接进入配置管理，移除首次设置密码、登录校验、会话解锁状态及相关存储键与样式；本机桌面入口本身即使用边界，如需访问控制由操作系统账户与文件权限负责。
17. 安装包只包含必要产物与运行依赖；原生模块按需解包。应用资源、userData 和账户配置 home 分离，不依赖启动工作目录。

## 预期影响
- 用户直接启动桌面应用，不再打开 127.0.0.1 网页，不再使用 start.sh/stop.sh。
- 应用包包含 Electron 和必要原生依赖，安装体积将明显大于现有网页产物。
- 切换提示按平台展示实际写入目标；Windows 不再显示写入 zshrc。
- Linux bash 登录会话未必读取 .bashrc；不自动修改其他 profile，不承诺所有新会话立即生效。
- 缺失文件及不支持的权限、元数据或文件系统仍明确报错，不通过放宽保护提高兼容率。
- 生产不再保留 HTTP token、bootstrap、端口和静态服务防护；以 Electron 窗口、frame、origin 和固定 IPC 能力替代。
- 既有并发刷新响应乱序等非迁移问题不顺带扩大修复范围。

## 风险
- 原生 FFI 的 ABI、缓冲区、句柄生命周期错误可能导致主进程崩溃；先验证小型平台适配，再迁移入口。
- Windows 文件替换与注册表写入不能照搬 POSIX 原子性和断电持久性承诺；错误结果必须反映已发生的变更。
- 进程内队列和替换前检查不是跨进程 CAS；不宣称排除外部工具并发修改。
- Linux flistxattr 可能省略不可访问属性，trusted.* 仅对具备 CAP_SYS_ADMIN 的进程可见；文件所有权不能保证完整枚举。临时文件替换可能丢失不可见属性，不为绕过该限制给桌面应用增加 CAP_SYS_ADMIN。依据： https://man7.org/linux/man-pages/man2/listxattr.2.html 和 https://www.man7.org/linux/man-pages/man7/xattr.7%40%40man-pages.html 。
- 新依赖涉及 Electron、构建和原生边界，实施前检查版本兼容、预构建产物、许可及已知漏洞。
- 允许 renderer 测速任意用户配置的 HTTP(S) 网关会限制 CSP 的网络收紧程度；不宣称抵御已控制 renderer 的攻击者。
- 未签名安装包可能触发系统安全提示，不自动关闭 Gatekeeper、SmartScreen 或 Electron sandbox。
- 测试使用临时 home、独立 userData 和隔离注册表位置；禁止读写真实个人配置、用户环境或复用个人浏览器会话。
- 当前 Mac 只能验证对应本机行为；Windows、Ubuntu 及其他 CPU 的真实验证需要对应环境。缺少环境时保留待验收状态，不将 mock 或交叉构建视为通过。
- 不自动提交、合并、推送或发布；每批应用代码修改前另行展示完整 diff 并确认。
