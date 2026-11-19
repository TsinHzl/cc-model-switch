# 变更提案：add-light-dark-theme

## 背景

当前应用仅有暗色玻璃拟态主题（`theme.css` 硬编码 `color-scheme: dark`，组件样式含大量浅色硬编码 `rgba(255,255,255,…)` 与 `#fff`），无白天模式。需求新增「白天 / 暗黑 / 跟随系统」三种主题模式切换，让用户能按偏好或系统外观选用主题。

## 目标范围

**在范围内：**

- **主题模式状态**：新增三态主题模式 `system`（默认）/ `light` / `dark`；用户选择存 renderer `localStorage`（默认 `system`）
- **主题层改造**（`src/styles/theme.css`）：将 `:root` 暗色变量集改造为「暗色基线 + 浅色覆盖」，由根元素 `data-theme` 属性单一驱动；`color-scheme` 随当前生效主题切换，让原生控件与滚动条跟随
- **组件层换皮**（`src/styles/components.css`、`src/styles/chat.css`）：将浅色硬编码（`rgba(255,255,255,…)`、`#fff`、少量霓虹阴影）以新增或现有主题变量表达；`light` 覆盖下重定义全部文字中间色（`--text-secondary`/`--text-dim`/`--text-muted` 及兼容白叠加变量 `--bg-card`/`--bg-hover`/`--border-active`/`--bg-elevated`）为深灰浅底取值，保证浅色模式可读、对比度达标，不改变任何布局/结构
- **React 接线**（`src/main.tsx` 或 `src/App.tsx`）：**render 前同步读取** `localStorage` 主题模式并先设根元素 `data-theme`/`color-scheme`（避免首帧 FOUC），随后订阅 `prefers-color-scheme` 变化计算生效主题
- **根元素 `data-theme`**:仅存 `data-theme="light"` / `data-theme="dark"`,不存 `system`（`system` 仅存在于选择态，运行时解析为具体主题）
- **切换入口**：顶部导航栏提供「白天 / 暗黑 / 跟随系统」三段式切换控件，选择持久化到 `localStorage`，即时生效

**不在范围内：**

- 不动业务逻辑与契约层：`configStore` / `applyConfig` / `apiClient` / IPC / 主进程全不改
- 不新增 IPC 契约或主进程持久化（主题仅存 renderer `localStorage`，与既有 `ccms.chat.v1.*` 模式一致）
- 不做主题扩展点（不接受未来任意主题插件化，本变更仅三态）
- 不改布局或组件结构（仅换皮换色）

## 技术方案

- **主题状态（纯前端，无 IPC）**：三态枚举 `'system' | 'light' | 'dark'`，读取与写入 `localStorage` 键如 `ccms.theme.v1.mode`；`system` 时解析 `window.matchMedia('(prefers-color-scheme: light)')` 为 `light/dark`
- **生效主题运行时计算**：render 前用 `useMemo/初始读取` 同步算出生效主题并写根元素；`useEffect` 订阅 `matchMedia` 的 `change` 事件；当模式为 `system` 时随系统变化，否则固定在所选主题。**单一驱动源**：CSS 只响应 `data-theme`，不用 `prefers-color-scheme` 媒体查询做覆盖，避免与 JS 双驱动竞态
- **CSS 接管**：`theme.css` 定义
  - `:root`（或 `[data-theme="dark"]`）为暗色基线（沿用现值）
  - `[data-theme="light"]` 覆盖变量为浅色取值
  - 根级 `color-scheme` 由生效主题决定（暗 `dark` / 浅 `light`）
  - 无 `data-theme` 时回退暗色基线，脚本异常也不改变既有观感
- **切换控件**：放在顶部导航栏（`App.tsx` 的 `.tabs` 区域右侧），三段式 `button` 组，`aria-pressed` 标记当前选择；选择即时写 `localStorage` 并重算生效主题
- **硬编码清理**：`components.css` 的 `rgba(255,255,255,…)` / `#fff` 文字与边框、霓虹 `box-shadow`、浅色 focus ring 逐一映射到「新增中性变量 `--surface`/`--surface-strong`/`--ink` 等」或既有 `--text` 系列；`chat.css` 的 `composer-send` 白字改为 `--on-accent`

## 预期影响

- 视觉新增白天模式，暗色为默认基线（`system` 首启跟随系统，暗色系统仍显示暗色，行为不变）
- 所有既有功能零变化；布局/结构/交互不变
- 主题切换即时生效，无需重启；选择持久化于 renderer
- 测试影响：纯 UI 层，新增 1 个主题 hook 纯函数测试（生效主题计算），其余既有测试不受影响

## 风险

| 风险 | 应对 |
|---|---|
| 大量浅色硬编码转换遗漏导致浅色模式对比度不足或文字不可见 | 逐文件核对 `rgba(255,255,255` / `#fff` / 阴影；`light` 覆盖必须重定义文字中间色与兼容白叠加变量为深灰浅底；改造后跑 typecheck + 测试 + 手动核对类名清单 |
| 首帧闪屏（FOUC）——浅色用户/浅色系统先暗后亮 | render 前同步读取 localStorage 并先设根元素 `data-theme`/`color-scheme`，杜绝首帧暗色闪烁 |
| CSS 双驱动源（data-theme + prefers-color-scheme）竞态 | 单一驱动源：CSS 仅响应 `data-theme`，系统偏好只由 JS `matchMedia` 订阅后写进 `data-theme` |
| 玻璃拟态 `backdrop-filter` + 浅色半透明叠加叠加后发灰 | 浅色覆盖块把卡片底色调成更高不透明度的浅色，并重定义兼容白叠加变量为浅色取向；保证可读 |
| 原生控件（滚动条/表单 select/autofill）配色不随主题 | 用 `color-scheme` 全局可切换，让原生 UI 跟随 |
| 既有暗色系统用户首启被切到 `light` | 默认 `system`，暗色系统 → 仍暗色，行为与现状一致，不抢占 |
| `localStorage` 不可用（异常环境） | 捕获读取/写入异常降级为 `system`（跟随系统），不崩溃 |
| matchMedia 测试在 vitest/jsdom 需手动 stub | 单测 stub `matchMedia`（含 addEventListener/removeEventListener），只测 `resolveTheme`/降级纯逻辑，hook 订阅留手动核对 |