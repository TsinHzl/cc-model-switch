## Purpose

提供在配置所在 Mac 上运行的网页服务：浏览器切换 Claude Code 模型并管理配置列表，由同机 Node 服务读写进程用户的固定文件。配置列表以 `~/change-ai-config.json` 为唯一数据源，格式与现有脚本兼容。

## Requirements

### Requirement: 同机服务访问固定文件

系统 SHALL 仅监听 loopback，通过同源 API 访问服务用户 home 中的 config、settings、zshrc；settings 只读，不接受 HTTP 指定任意路径、home、文件全文或 shell 命令。

#### Scenario: 首次使用
- **GIVEN** 目标 Mac 的三个配置文件已存在，且以普通用户启动服务
- **WHEN** 用户打开 `http://127.0.0.1:15858` 并通过页面门禁
- **THEN** 页面从本机 API 加载配置，无需浏览器文件授权或 IndexedDB 句柄

#### Scenario: 非支持访问来源
- **WHEN** 请求 Host 不等于 `127.0.0.1:实际监听端口`，或写请求 Origin 不同源
- **THEN** 服务拒绝请求，不开放 CORS，也不信任转发头

#### Scenario: 文件不受支持
- **WHEN** 目标文件缺失，或目标及父路径包含符号链接，或写入涉及不支持的权限/元数据
- **THEN** 服务安全报错，不自动创建文件、不放宽权限、不跟随链接写入

### Requirement: 会话与请求校验

系统 SHALL 使用启动期随机内存 token 保护配置 API；bootstrap 限同源 Fetch Metadata 和自定义头，写请求限 JSON 并校验字段，限制正文大小、读取时间和请求频率。

#### Scenario: 服务重启
- **GIVEN** 页面保留旧 token，服务已重启
- **WHEN** 用户请求配置 API
- **THEN** 返回 SESSION_EXPIRED，提示整页刷新，不自动重新鉴权或重放写请求

### Requirement: 模型切换仅写 zshrc

系统 SHALL 按 base_url → channel 分组，以 model/base_url/key 三元组匹配激活态；切换仅写 zshrc，不修改或清理 settings.json。

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
- **WHEN** rename 后校验失败，或浏览器无法确认写请求结果
- **THEN** 提示可能已写入，要求刷新核对，不自动重试写操作

#### Scenario: 写入成功但刷新失败
- **WHEN** 服务返回 204，随后读取状态失败
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

### Requirement: 页面密码门禁

系统 SHALL 保留首次设置密码及后续登录验证；哈希存 localStorage、会话解锁存 sessionStorage，清除站点数据可重置。门禁仅防误触，不作为 API 安全边界，不隔离恶意本机进程或同源代码。

#### Scenario: 首次设置
- **WHEN** 浏览器没有密码记录
- **THEN** 要求两次一致输入并完成设置后才挂载配置页面，不提前请求配置 API

#### Scenario: 密码错误
- **WHEN** 用户输入错误密码
- **THEN** 拒绝进入功能界面并提示重试
