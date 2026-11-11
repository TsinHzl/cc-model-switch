# 变更提案：platform-native-acceptance

## 背景
`migrate-electron-desktop` 在 macOS arm64 上已完成窗口、IPC、文件写入与目录包验证，但 Windows、Linux、macOS x64 及三平台安装包缺少本机原生环境，无法取得真实验收证据。为不阻塞主迁移归档，将这些平台相关任务拆出为独立变更，继续保留待验收状态。

## 目标范围
**在范围内：**
- Windows x64：注册表七键读取/快照/提交、NTFS 文件安全检查与安全替换、nsis 安装包与隔离账户原生验收。
- Linux（Ubuntu 22.04/24.04 x64）：ext4 元数据检测、账户登录 shell 激活目标、AppImage 原生验收；安全方案未闭合前保持写入关闭。
- macOS x64：目录包与原生行为验收。
- 三平台安装包：DMG、NSIS、AppImage。
- 剪贴板原生验收（此前明确排除，需另行授权的隔离账户或虚拟机）。
- 单实例锁与 activate 重激活验收（隔离入口每进程派生独立 userData，无法互斥）。
- 迁移后全量 diff 的独立审查（此前调用被中断，未完成）。

**不在范围内：**
- 新增用户可见功能。
- 修改 macOS arm64 已验收的写入行为。
- 自动更新、签名、公证与分发流程。

## 技术方案
1. 沿用 `migrate-electron-desktop` 已建立的文件层契约：不静默丢失属性，无法确认时拒写，不增加提权能力。
2. Linux 先用 Koffi 检测 ext4、xattr、ACL 与 flags；`trusted.*` 与不可访问属性的枚举缺口闭合前不开放写入。
3. Windows 通过 Koffi 调用系统 API 检查 reparse point、硬链接、owner/DACL、数据流与特殊属性，使用安全临时文件替换。
4. 各平台验收必须使用隔离账户/临时 home/独立注册表位置，不读写真实个人配置。
5. 缺少对应原生环境时保留未验收状态，不以 mock、VM 或交叉构建代替。

## 预期影响
- 主迁移变更可按 macOS arm64 已完成范围归档，平台扩展独立推进。
- 在对应平台验收完成前，应用仍仅对 macOS 开放写入。

## 风险
- Windows 与 POSIX 在原子性与断电持久性上语义不同，错误结果必须反映已发生的变更。
- Linux 属性枚举可能省略不可见项，空列表不能证明不存在特殊元数据。
- 未签名安装包可能触发系统安全提示，不自动关闭 Gatekeeper、SmartScreen 或 Electron sandbox。
