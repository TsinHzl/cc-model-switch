## Purpose

提供 Electron 桌面模型切换与配置管理，页面经受限 preload/IPC 调用主进程读写账户 home 的固定文件。配置列表以 `~/change-ai-config.json` 为唯一数据源，格式与现有脚本兼容。

当前规范记录已接入的桌面行为，不代表原生验收完成。当前仅 macOS 文件写入可用；Linux 写入保持关闭，Windows 持久化尚未实现，跨平台目标与阻塞见活动变更提案。

## Requirements

### Requirement: 桌面桥接访问固定文件

系统 SHALL 通过固定桌面 IPC 访问账户 home 中的 config、settings、zshrc；settings 只读，不接受 renderer 指定任意路径、home、文件全文或 shell 命令，不保留独立配置 HTTP 服务。

#### Scenario: 首次使用
- **GIVEN** 目标 Mac 的三个配置文件已存在，且以普通用户启动桌面应用
- **WHEN** 应用界面加载
- **THEN** 页面通过桌面桥接加载配置，无需浏览器文件授权或 IndexedDB 句柄

#### Scenario: 非支持访问来源
- **WHEN** 配置调用不来自当前可信窗口的存活主 frame，或实际 origin/页面地址不匹配
- **THEN** 主进程拒绝请求，不调用业务或写文件

#### Scenario: 缺少桌面桥接
- **WHEN** 页面没有可用的 desktop.config
- **THEN** 明确提示使用桌面应用，不回退 HTTP

#### Scenario: 文件不受支持
- **WHEN** 目标文件缺失，或目标及父路径包含符号链接，或写入涉及不支持的权限/元数据
- **THEN** 服务安全报错，不自动创建文件、不放宽权限、不跟随链接写入

### Requirement: 固定 IPC 与请求校验

系统 SHALL 仅暴露 state/apply/add/edit/remove 五个固定配置方法，校验严格结构和业务字段，限制请求为 64 KiB 紧凑 JSON 等价 UTF-8 字节；五方法共享一个在途名额，忙时拒绝、不排队。预算不覆盖进入 handler 前的克隆开销，单名额不是频率限流。

#### Scenario: 请求被拒绝
- **WHEN** 请求包含额外字段、非法索引、非法写入值或超过载荷预算
- **THEN** 返回有限错误码，不调用业务或修改配置，不返回原始请求内容

#### Scenario: 通信失败
- **WHEN** 桥接调用异常或响应不符合共享契约
- **THEN** 提示操作结果未知，要求重新读取核对，不自动重放写请求

### Requirement: 模型切换仅写 zshrc

系统 SHALL 按 base_url → channel 分组，以 model/base_url/key 三元组匹配激活态；当前 macOS 切换仅写 zshrc，不修改或清理 settings.json。其他平台不得绕过当前写入守卫。

#### Scenario: 分组与激活态
- **GIVEN** 配置列表包含多条记录
- **WHEN** 页面加载
- **THEN** 按出现顺序分组并保留原数组下标；优先使用 settings env 三元组，三字段全空或解析失败才回退 zshrc

#### Scenario: 确认切换
- **WHEN** 用户确认所选配置
- **THEN** 服务在最新 config 中按三元组重新定位，缺失时报冲突；删除旧 zshrc 标记块并置顶插入包含七个 ANTHROPIC_* export 的新块，按 bash printf %q 等价规则转义
- **AND** settings.json 保持原样；页面刷新后仍按 settings 优先识别，不强制高亮刚写入的配置

#### Scenario: 取消切换
- **WHEN** 用户取消确认弹窗
- **THEN** 不发出写请求，不修改文件

### Requirement: 写入保护与反馈

系统 SHALL 基于最新磁盘文本计算增量，进程内串行写入；无变化不写，使用同目录排他临时文件、fsync、替换前目标及依赖复核、rename 和回读校验。此机制不保证跨进程绝对互斥。

#### Scenario: 替换前失败
- **WHEN** 写入或检查在 rename 前失败
- **THEN** 中止替换并清理本次临时文件，页面显示安全错误

#### Scenario: 替换后结果不确定
- **WHEN** rename 后校验失败，或页面无法确认 IPC 写请求结果
- **THEN** 提示可能已写入，要求刷新核对，不自动重试写操作

#### Scenario: 写入成功但刷新失败
- **WHEN** 主进程返回 `{ success: true }`，随后读取状态失败
- **THEN** 页面分别说明写入成功及状态刷新失败，不宣称未写入；重试只读取状态

### Requirement: 配置项管理

系统 SHALL 提供 base_url/key/model/channel 四字段新增、编辑、删除，只写 config，保持 JSON 数组、四空格缩进及末尾换行。

#### Scenario: 新增配置项
- **WHEN** 用户提交通过校验的配置
- **THEN** 基于最新数组追加条目，保留其他条目的未知字段，写后刷新列表

#### Scenario: 编辑或删除冲突
- **GIVEN** 外部操作改变了所选条目的原数组下标或三元组
- **WHEN** 用户保存或确认删除
- **THEN** 服务拒绝写入并提示重新读取，不覆盖外部变更

#### Scenario: 编辑配置项
- **WHEN** 下标和三元组校验通过
- **THEN** 用提交的四个已知字段替换该条目，其余条目保持不变

#### Scenario: 删除配置项
- **WHEN** 用户确认删除且校验通过
- **THEN** 从最新数组移除该条目，不自动切换或清理激活环境；刷新后重新匹配激活项

#### Scenario: JSON 损坏
- **WHEN** 磁盘 config 不是合法配置列表
- **THEN** 页面显示安全错误，不展示配置原文；依赖该列表的写入被拒绝，修复文件后可重新读取

### Requirement: 页面直接进入配置管理

系统 SHALL NOT 提供密码设置、登录验证或会话解锁门禁；页面启动即挂载配置管理界面。访问控制由操作系统账户与文件权限负责，UI 不宣称隔离恶意本机进程或已控制的 renderer。

#### Scenario: 直接使用
- **WHEN** 应用启动且桌面桥接可用
- **THEN** 直接显示配置列表，不出现密码输入框或解锁步骤，不写入任何门禁凭据到应用存储

#### Scenario: 遗留门禁存储
- **WHEN** 应用存储中存在旧版门禁哈希或会话解锁键
- **THEN** 不再读取或校验这些键，也不因此阻止进入配置界面
