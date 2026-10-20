# 变更提案：cc-model-switch

## 背景

用户现有 `~/change-ai-config.sh` + `~/change-ai-config.json` 工具链，通过终端 TUI 菜单切换 Claude Code 的模型配置（写入 `~/.zshrc` 环境变量块或 `~/.claude/settings.json` env 块，两者互斥清理）。存在问题：

- TUI 仅能在本机终端使用，配置项已增长到 42 条，终端菜单翻页体验有限
- 新增/修改配置项只能手工编辑 JSON，无校验、易出错
- API key 明文混在 JSON 中，手工编辑易误触

需求：做成可部署到服务端的 React 网站（端口 15858），在用户本地浏览器打开后实现与 sh 脚本**一模一样**的模型切换能力，并新增通过 Web UI 增删改 `change-ai-config.json` 配置项的能力。UI 美观简洁、交互人性化。

## 目标范围

**在范围内：**

- 新建独立子目录 `cc-model-switch/`（React 18 + TypeScript + Vite）
- **浏览器直写架构**：服务端仅托管静态资源（端口 15858），无任何后端运行时逻辑；本地文件读写全部由用户 Mac 上 Chrome/Edge 浏览器通过 File System Access API 完成
- **使用形态约束（重要）**：FSA API 授权的是**访问者本机**的文件，因此站点虽可部署到任意服务器，但必须从存放配置文件的那台 Mac 的浏览器访问；且 FSA API / `crypto.subtle` 仅在 secure context（HTTPS 或 localhost）下可用。README 必须写明三种可行访问方式：
  1. **SSH 端口转发（推荐）**：`ssh -L 15858:127.0.0.1:15858 <server>`，本地打开 `http://localhost:15858`——服务端部署、本地访问、满足 secure context，无需证书
  2. HTTPS 反向代理（Caddy/nginx + 受信证书）
  3. 直接在 Mac 本机跑 `node server.mjs`（localhost 即 secure context）
- 首次使用授权流程：用户在页面上依次授权选择 3 个本地文件（`~/change-ai-config.json`、`~/.claude/settings.json`、`~/.zshrc`），句柄持久化到 IndexedDB，后续访问免重选（Chrome 记住授权）
- 模型切换功能，行为与 sh 脚本逐项对齐：
  - 按 base_url → channel 双级分组展示全部配置项，当前激活项高亮标记
  - 激活态判定：优先读 settings.json env 块的 ANTHROPIC_MODEL/BASE_URL/AUTH_TOKEN 三元组，与配置项匹配；env 块为空时回退读 zshrc 标记块
  - 切换时选择写入位置（zshrc / settings.json 二选一，与脚本一致）
  - 写 zshrc：删除旧标记块 → 新 7 个 ANTHROPIC_* export 块插入文件**最前面** → 同步清理 settings.json env 中同名键
  - 写 settings.json：env 块原子更新 7 个键（保留 JSON 其他内容）→ 删除 zshrc 标记块
  - 标记块格式 `# >>> change-ai-config >>>` / `# <<< change-ai-config <<<` 与脚本完全兼容（幂等）
  - shell 转义：值按 bash `printf %q` 等价规则转义
- 配置管理功能（新增能力）：Web UI 表单化增/改/删 `change-ai-config.json` 条目（base_url / key / model / channel 四字段，必填校验），写回时保持 JSON 数组结构（4 空格缩进，与现有手工格式一致；实施时经实测现有文件为 4 空格缩进，修订原 2 空格表述），与手工编辑完全兼容
- 密码保护：首次访问设置访问密码（SHA-256 哈希存 localStorage），后续访问需登录；密码遗忘可清除浏览器数据重置
- API key 默认脱敏显示（前 6 后 4），点击可切换明文
- 部署产物：`dist/` 静态构建 + 极简静态服务脚本（node 单文件）监听 15858，附部署/启动说明（README，含上述三种访问方式与 secure context 约束）

**不在范围内：**

- 不实现 sh 脚本的"向当前已打开终端窗口注入环境变量"能力（浏览器沙箱物理无法做到，新开终端生效）
- 不支持 Safari/Firefox（File System Access API 不支持）；不支持非 secure context 的 http://<远程IP> 直接访问（浏览器限制，页面检测后给出 SSH 隧道指引）
- 服务端不存储、不转发任何配置数据或 API key（零后端逻辑、零数据落盘）
- 不做多用户/多设备配置同步（本地文件为唯一数据源）
- 不修改 `~/change-ai-config.sh` 脚本本身（两套工具并存，写同一批文件、格式互兼容）
- 不做配置项排序/拖拽、导入导出、批量操作（未要求，YAGNI）
- 不内置 TLS 终止（HTTPS 由反代承担，server.mjs 仅 http）

## 技术方案

- React 18 + TypeScript + Vite 构建，单页应用，无路由需求
- **能力检测双重条件**：`window.isSecureContext === true` 且 `showOpenFilePicker` 存在，二者缺一进入"环境不支持"说明页（区分浏览器不支持 / 非 secure context 两种原因并分别给出指引）
- 文件访问：`window.showOpenFilePicker` 获取 `FileSystemFileHandle`，IndexedDB（原生 API）持久化句柄；每次操作前 `queryPermission` → `requestPermission` 刷新授权
- **写入前强制重读（防 stale write）**：每次写 zshrc / settings.json / change-ai-config.json 前，先从磁盘重新读取最新内容，在最新内容上应用增量修改后写回，杜绝覆盖页面打开期间外部工具（sh 脚本、手工编辑）的变更
- 文件写入：`handle.createWritable()` → write → close；settings.json 写入前 JSON.parse 校验防损坏、写后回读验证
- 激活态 / 分组逻辑用 TypeScript 移植 sh 内嵌 python 逻辑（纯函数，可单测）
- 密码：SHA-256（Web Crypto，secure context 下可用）+ salt 存 localStorage
- 静态托管：构建产物 + `server.mjs`（node http 单文件，约 40 行）监听 15858；无任何 npm 运行时依赖
- UI：自研轻量样式（CSS Variables 主题，暗色为主），不引入组件库，控制包体积

## 预期影响

- 全部为新增代码（新子目录），不影响 sourcetree 下任何现有项目
- 与 `~/change-ai-config.sh` 操作同一批文件，写入格式逐字节兼容（标记块、转义、JSON 缩进），两者交替使用无冲突
- `change-ai-config.json` 条目新增/修改后，sh 脚本菜单同步可见（共享同一数据源）

## 风险

| 风险 | 应对 |
|---|---|
| FSA API / crypto.subtle 仅 secure context（HTTPS/localhost）可用，直接 `http://<远程IP>:15858` 访问 API 全部 undefined | 能力检测含 isSecureContext；不支持时说明页给出 SSH 端口转发命令；README 首屏写明三种访问方式 |
| 页面长开期间外部工具改写同一文件（sh 脚本/手工编辑），回写覆盖外部变更 | 每次写入前强制从磁盘重读最新内容再应用增量，不基于内存旧副本回写 |
| File System Access API 仅 Chrome/Edge 支持 | 能力检测（API 存在性）后展示说明页与替代指引 |
| 浏览器授权过期（Chrome 重启后需重新点击允许） | 每次操作前 queryPermission 检测，失效时引导用户一键重新授权，不静默失败 |
| 写本地文件失败（磁盘/权限） | createWritable 原子性保证（close 前不覆盖原文件）；失败时 UI 明确报错并保留内容可重试 |
| settings.json 含其他配置被误覆盖 | 仅操作 env 块内 7 个指定键，其余键原样保留；写前 parse 校验、写后回读验证 |
| API key 明文泄露 | 静态资源不含任何密钥；key 仅存在于用户浏览器内存与本地文件 |
| 密码哈希+salt 同存 localStorage，防护有限（非安全边界） | 定位为"防误触/基础门禁"，README 明示局限；文件本身仍受 macOS 用户权限保护 |
