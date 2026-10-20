## Purpose

提供可通过浏览器远程切换本机 Claude Code 模型配置、并管理配置项清单的能力：Web UI 与 `~/change-ai-config.sh` 操作同一批本地文件且格式完全兼容，本地 `~/change-ai-config.json` 为唯一数据源。

## Requirements

### Requirement: 浏览器直写本地文件
The system SHALL 在纯静态部署（无后端运行时）下，通过浏览器 File System Access API 直接读写用户本机的 `~/change-ai-config.json`、`~/.claude/settings.json`、`~/.zshrc`，服务端不存储、不转发任何配置数据；站点部署位置不限，但功能仅在 secure context（HTTPS 或 localhost）下的 Chrome/Edge 中可用。

#### Scenario: 首次授权
- **GIVEN** 用户从未在本浏览器授权过目标文件
- **WHEN** 用户在 secure context 下的 Chrome/Edge 打开站点并点击初始化授权
- **THEN** 页面依次引导选择 3 个目标文件，句柄持久化到 IndexedDB，后续访问免重选

#### Scenario: 不支持的浏览器
- **GIVEN** 用户使用 Safari 或 Firefox 打开站点
- **WHEN** 页面完成能力检测
- **THEN** 展示不支持说明页与替代指引，不进入任何功能界面

#### Scenario: 非 secure context 访问
- **GIVEN** 用户通过 `http://<远程IP或域名>:15858` 直接访问（非 localhost 非 HTTPS）
- **WHEN** 页面完成能力检测
- **THEN** 展示说明页说明浏览器安全限制，并给出 SSH 端口转发命令等访问指引

#### Scenario: 授权失效
- **GIVEN** Chrome 重启后文件句柄权限失效
- **WHEN** 用户触发任一读写操作
- **THEN** 系统检测到权限失效并引导重新授权，不静默失败

#### Scenario: 外部并发修改保护
- **GIVEN** 页面打开期间目标文件被外部工具（sh 脚本、手工编辑）修改
- **WHEN** 用户在页面执行写入
- **THEN** 系统先从磁盘重读最新内容再应用增量修改，不基于内存旧副本覆盖外部变更

### Requirement: 模型切换行为与脚本一致
The system SHALL 切换模型时的判定与写入行为与 `~/change-ai-config.sh` 完全一致：按 base_url + channel 分组展示配置、激活态三元组匹配、写入位置二选一且互斥清理另一处、zshrc 标记块置顶插入、幂等可重复执行。

#### Scenario: 分组展示与激活态
- **GIVEN** `change-ai-config.json` 含多条配置
- **WHEN** 页面加载配置列表
- **THEN** 按 base_url（一级）→ channel（二级）分组渲染，激活项（settings.json env 三元组匹配，env 为空时回退 zshrc 标记块匹配）带高亮标记

#### Scenario: 写入 zshrc
- **GIVEN** 用户选择某配置项并选择写入 macOS 环境变量
- **WHEN** 确认切换
- **THEN** 删除 zshrc 中旧标记块（若存在），将含 7 个 ANTHROPIC_* export 的标记块插入文件最前面（值按 bash printf %q 等价规则转义），并删除 settings.json env 块中的同名 7 键

#### Scenario: 写入 settings.json
- **GIVEN** 用户选择某配置项并选择写入 ~/.claude/settings.json
- **WHEN** 确认切换
- **THEN** settings.json env 块中 7 个 ANTHROPIC_* 键原子更新（JSON 其他内容原样保留，2 空格缩进），并删除 zshrc 中标记块

#### Scenario: 写入失败保护
- **GIVEN** 目标文件写入过程中发生错误
- **WHEN** createWritable 写入或校验失败
- **THEN** 原文件不被破坏（close 前不落盘），UI 明确报错并支持重试

### Requirement: 配置项管理
The system SHALL 支持通过 Web UI 对 `change-ai-config.json` 条目进行新增、修改、删除，字段为 base_url / key / model / channel，写回保持 JSON 数组结构与 4 空格缩进（与现有 ~/change-ai-config.json 手工格式一致；消费方 sh 脚本 json.load 对缩进无感知），与手工编辑及 sh 脚本完全兼容。

#### Scenario: 新增配置项
- **WHEN** 用户在管理界面填写 4 字段并通过必填校验后提交
- **THEN** 条目追加到 JSON 数组并写回本地文件，列表即时刷新

#### Scenario: 修改配置项
- **GIVEN** 已有条目被编辑且通过校验
- **WHEN** 用户保存
- **THEN** 仅该条目内容更新，其余条目与 JSON 结构不变

#### Scenario: 删除配置项
- **GIVEN** 用户对某条目点击删除并确认
- **WHEN** 删除执行
- **THEN** 该条目从数组移除并写回，若被删除的是当前激活项则激活态标记消失（不自动切换）

#### Scenario: JSON 写坏保护
- **GIVEN** 磁盘上的 change-ai-config.json 被外部手工编辑损坏
- **WHEN** 页面尝试加载
- **THEN** 解析失败时展示明确错误与原始内容查看入口，不进行任何写入

### Requirement: 访问密码保护
The system SHALL 以密码门禁控制 UI 访问：首次访问设置密码（哈希存储于浏览器本地），后续访问需验证通过；密码遗忘可通过清除浏览器站点数据重置。

#### Scenario: 首次设置密码
- **GIVEN** 浏览器本地无密码记录
- **WHEN** 用户首次访问
- **THEN** 引导设置密码（需二次确认输入），验证通过后进入功能界面

#### Scenario: 登录验证
- **GIVEN** 已设置密码
- **WHEN** 用户再次访问输入错误密码
- **THEN** 拒绝进入功能界面并提示重试
