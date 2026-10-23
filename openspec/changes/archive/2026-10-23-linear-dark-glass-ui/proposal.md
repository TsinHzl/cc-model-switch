# 变更提案：linear-dark-glass-ui

## 背景

现有 UI 为自研 CSS Variables 暗色主题（蓝色 accent、分组卡片 + 常驻文字按钮）。用户提供设计稿 `/Users/MacBook/Downloads/model-switcher-ui-designs/01-linear-dark-glass.html`（Linear 风格暗色玻璃拟态），要求将 Web UI 完全替换为该设计稿样式，同时保留全部既有功能（切换/增删改/复制 key/授权流程/错误态）。

## 目标范围

**在范围内：**

- **主题层重写**（`src/styles/theme.css`）：按设计稿替换全套 CSS Variables——背景 `#090b10` + 三重 radial 渐变光晕、玻璃卡片 `rgba(18,22,34,0.75)` + `backdrop-filter: blur(16px)`、indigo 主色 `#6366f1`、边框 `rgba(255,255,255,0.08)`、成功绿 `#10b981`、危险玫红 `#f43f5e`；字体用系统字体栈近似（`-apple-system` + `ui-monospace`），不引 Google Fonts 外链
- **组件样式重写**（`src/styles/components.css`）：按设计稿逐组件复刻——
  - 顶部栏：渐变图标块 + 标题 + `version-tag` 胶囊（显示真实版本号 `v1.0.0`，取自 package.json 语义，不虚构 CLI Sync 文案）+ 副标题（联动说明 + 统计徽标）+ 操作按钮组（显示 Key / 刷新 / 新增配置=主色渐变）
  - **Hero 激活卡片（新增）**：`ACTIVE CURRENT` 脉冲徽标 + 模型名 + meta 行（网关/分组/key——key 随「显示/隐藏 Key」切换明/密）+ 真实测速延迟徽标 + 「复制 Env」按钮（复制 7 个 `ANTHROPIC_*` export 行，与 zshrc 标记块同格式）
  - **搜索框（新增）**：全文过滤（模型名/分组名/URL），带放大镜图标与 ⌘K kbd 装饰胶囊（纯装饰，不实现快捷键）；不做 Tab 分类胶囊
  - URL 分组卡（`endpoint-card`）：头部 URL + `(N个模型)` 计数 + 「+ 添加端点模型」按钮
  - 渠道子分组（`subgroup`）：竖条标题 + 「+ 快速加模型」幽灵按钮（保留渠道入口预填锁定 key 语义）
  - 模型行（`model-row`）：模型名（mono）+ `key-box` key 胶囊（**点击即复制完整 key**，含复制图标；显示随「显示/隐藏 Key」切换明/密）+ `btn-switch` 切换按钮（当前项为绿色 `current` 态、不可点）+ 悬浮显现的 `hover-actions` 图标按钮组（复制=复制该条目 JSON 四字段/编辑/删除）；**不渲染** `model-badge` 徽标（设计稿为无数据源的静态假文案，经用户确认放弃）
  - 弹窗（切换确认/表单/删除确认）、toast、错误面板、密码门禁：同主题换皮适配新变量
- **ModelSwitch.tsx 结构调整**：新增 Hero 卡片渲染（读 `activeIndex` 对应条目）、搜索状态与过滤逻辑、key 胶囊点击复制、`btn-switch` 显式切换按钮（替代整行点击，行不再可点击）、hover 副操作（复制 JSON 条目）；删除 `maskKey` 之外的旧类名引用
- **App.tsx / Gate.tsx**：环境不支持说明页与密码门禁卡片换用新主题变量（结构不变）
- **图标**：按设计稿内嵌 SVG（refresh/eye/plus/search/copy/edit/delete/globe/pulse），零外部依赖

**不在范围内：**

- 不改任何业务逻辑：`configStore` / `applyConfig` / `fileAccess` / `configModel` / `handleStore` / `authStore` 全部不动
- 不做 Tab 分类胶囊过滤（设计稿有、用户确认不做）
- 不引入 Google Fonts 外链（用户确认系统字体近似）
- 不改弹窗的确认流程与校验逻辑（仅换皮）
- 不做移动端适配调整（沿用现状）

## 技术方案

- 主题以 CSS Variables 整体替换为设计稿取值；`backdrop-filter` 需现代浏览器（项目已强制 Chrome/Edge，无兼容风险）
- Hero 延迟测速：页面 ready 后对激活条目 `base_url` 发起一次性 `fetch`（HEAD，`AbortController` 5s 超时），成功显示 `Nms`，失败/超时显示 `—`；不做轮询
- 复制 Env：拼装 `buildExportLines(entry)` 的 7 行 export（复用 `applyConfig.ts` 现有纯函数）+ `\n` join，走 `navigator.clipboard.writeText`
- 搜索过滤：`useMemo` 在 `groups` 上按 `model/channel/base_url` 包含匹配（大小写不敏感），空搜索词显示全部
- 行交互重构：行本身不再 `onClick`/`role=button`（设计稿行是容器），切换收敛到 `btn-switch`；key 胶囊与图标按钮各自 `stopPropagation` 不再需要（行无点击），但键盘可达性由按钮原生语义承担
- 删除徽标 `model-badge`（如 Anthropic Opus）为设计稿静态文案，无真实数据源 → 不渲染该徽标（避免假数据，经用户确认）；badge 仅用于 key 胶囊与当前态
- hover「复制」副操作：复制该条目的 JSON 四字段（base_url/key/model/channel，`JSON.stringify(entry, null, 2)`，与配置文件条目同构），与 key 胶囊的「复制完整 key」区分
- key 显示口径统一：列表 `key-box` 与 Hero meta 的 key 均随顶部「显示/隐藏 Key」按钮联动明/密（复制到剪贴板的始终是完整 key）

## 预期影响

- 视觉整体切换为 Linear Dark Glass 风格；功能零变化（切换/增删改/复制/授权/错误态全保留）
- `model-row` 由整行可点改为「切换」按钮显式触发——交互变化经用户确认
- 新增 Hero 卡片与搜索框为页面新元素（用户确认要）
- `theme.css` / `components.css` 几乎全量重写；`ModelSwitch.tsx` 中等幅度调整；测试不受影响（纯 UI 层），`resolveAddPreset` 等 export 不动

## 风险

| 风险 | 应对 |
|---|---|
| Hero 测速请求可能被代理 CORS 拦截（fetch 失败≠服务不可用） | 失败显示 `—` 不报错；HEAD 不被允许时回退 GET；5s 超时中止 |
| 玻璃拟态 `backdrop-filter` 在低端 GPU 上性能开销 | 项目为本地工具单页，列表规模 ~50 条，可接受；不动效卡片不加 blur |
| 全量重写 CSS 可能遗漏既有错误态/加载态样式 | 逐组件核对 ModelSwitch/Gate/EntryForm/ConfirmDelete 全部类名，重写后跑 tsc + 全量测试 + 手动核对类名清单 |
| 搜索过滤后 `activeIndex` 语义不变（原数组下标），过滤不改变 index | 过滤仅作用于渲染层，`groups` 内 `index` 字段原样传递，切换/编辑逻辑零改动 |
| 弹窗换皮遗漏字段（写入位置单选等） | 弹窗结构保留原 DOM，仅类名映射到新样式 |
