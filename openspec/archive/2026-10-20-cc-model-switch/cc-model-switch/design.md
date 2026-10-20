## 上下文

用户要求"服务端部署的网站直接改本地 Mac 文件、不通过桥接"。经澄清确认：服务器无法触达 NAT 后的本地文件系统，唯一无桥接路径是浏览器直写——页面在用户 Mac 的 Chrome/Edge 中打开，通过 File System Access API 读写本地文件；服务端仅托管静态资源。

**关键约束（提案审查发现的架构级风险）：** FSA API 与 `crypto.subtle` 仅在 secure context���HTTPS / localhost）下可用。站点可部署到任意服务器，但访问必须满足：SSH 端口转发到 localhost（推荐，零证书）、HTTPS 反代、或本机直接跑。FSA 授权的是访问者本机文件，因此只能管理"打开浏览器的这台 Mac"上的配置文件。

## 目标 / 非目标

**目标：**
- 静态站点部署到服务器 15858 端口，`npm run build` 产物 + 单文件 node 静态服务
- 与 `~/change-ai-config.sh` 行为逐项对齐（分组、激活判定、双写入目标互斥、标记块格式、转义规则）
- 新增 Web UI 配置管理（增/改/删 + 校验）
- 密码门禁 + key 脱敏

**非目标：**
- 复刻 sh 的当前终端注入（`CHANGE_AI_CONFIG_INJECT`）——浏览器沙箱物理不可行
- Safari/Firefox 支持；多设备同步；服务端任何数据存储

## 决策

1. **纯静态 + 浏览器直写**（用户确认）。备选的本地 agent 桥接、手动粘贴方案被否决。代价已向用户明示：仅 Chrome/Edge、首次需授权、已开终端不即时生效。
2. **无路由单页 + 双 Tab**：`切换模型` / `配置管理` 两个标签页，避免引入 router。
3. **句柄持久化**：`FileSystemFileHandle` 序列化进 IndexedDB（原生 API，不引依赖）；每次读写前 `queryPermission`，非 granted 则触发 UI 引导授权（`requestPermission` 需用户手势，不能静默重试）。
4. **写入策略**：每次写入前**从磁盘强制重读最新内容**（防 stale write：页面长开期间 sh 脚本/手工编辑可能改写同一文件），在最新内容上应用增量后经 `createWritable` 写全量、`close()` 才落盘（浏览器保证原子性）；settings.json / change-ai-config.json 写前 `JSON.parse` 自检、写后回读验证；zshrc 生成新全文（删旧块 + 头部插入新块）。
5. **纯函数移植**：sh 内嵌 python 的分组/激活判定逻辑、bash `%q` 转义逻辑移植为 TS 纯函数（`lib/shellQuote.ts`、`lib/applyConfig.ts`），核心可单测（vitest）。
6. **零运行时依赖**：React + react-dom 之外仅 devDependencies；静态服务用 node:http 单文件（<50 行），不引 express。
7. **UI 自研样式**：CSS Variables 暗色主题，无组件库。列表用分组卡片 + 当前项徽标；管理表单用受控组件 + 行内校验提示；全部列表渲染 key 用稳定 id（条目在内存中的 uuid，非数组下标）。
8. **密码门禁**：SHA-256(salt + password) 存 localStorage；sessionStorage 记录本次会话已解锁，避免每次切 Tab 重输。

## 风险 / 权衡

| 风险 | 权衡与应对 |
|---|---|
| 非 secure context 下 FSA / crypto.subtle 全部 undefined | 能力检测 `isSecureContext` + API 存在性双重判断，分别给出指引；README 三种访问方式（SSH 隧道推荐 / HTTPS 反代 / 本机直跑） |
| 页面长开期间外部工具改写同一文件导致 stale write | 写前强制重读磁盘最新内容再增量写回 |
| Chrome 句柄权限在浏览器重启后回落为 prompt | 每次操作前检测；失效时给出"重新授权"按钮（一次点击恢复，句柄仍在） |
| settings.json 外部并发修改 | 读取→修改→写回为短窗口；写前 parse 失败即中止并提示用户手工处理，不强行覆盖 |
| localStorage 密码哈希非安全边界 | 定位为防误触门禁；README 明示局限 |
| 与 sh 脚本交替使用 | 标记块、转义、缩进逐字节兼容；README 说明两者共存关系 |
| TS 移植 python 逻辑偏差 | 用现有真实数据（42 条配置）做快照测试对齐分组结果 |

## 迁移方案（如适用）

无存量数据迁移：沿用现有 `~/change-ai-config.json`，格式不变。

## 待决问题（Open Questions，如适用）

无（阶段 0 已澄清全部架构决策）。
