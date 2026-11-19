## 上下文

- Electron + React 18 + TS，页面经固定 preload/IPC 调主进程；主题属纯 renderer 视觉，不触碰契约层。
- 现状 `theme.css` 只定义暗色：`:root` 全套暗色变量 + `color-scheme: dark`；`components.css`/`chat.css` 含约 26 处浅色硬编码（`rgba(255,255,255,…)`、`#fff`）与霓虹阴影，仅适配暗色。
- 既有 renderer 持久化先例：对话会话存 `ccms.chat.v1.*` localStorage。主题沿用同模式，不新增 IPC。

## 目标 / 非目标

- **目标**：三态主题模式（默认 `system`），localStorage 持久化，即时生效，暗色为默认基线，浅色可读，`color-scheme` 跟随。
- **非目标**：不改业务/IPC/契约；不做主题插件化扩展点；不改布局结构。

## 决策

1. **三态枚举与持久化**：`type ThemeMode = 'system' | 'light' | 'dark'`，键 `ccms.theme.v1.mode`（与既有 `ccms.chat.v1.*` 命名同族）。读取/写入均 try/catch，失败降级 `system`。
2. **生效主题计算**：纯函数 `resolveTheme(mode, systemPref)` → `'light' | 'dark'`；`system` 时取 `matchMedia('(prefers-color-scheme: light)').matches`。运行时在根元素设 `data-theme="light|dark"` 并同步 `color-scheme`。任何变更不得依赖 `Date.now` 等副作用实现。
3. **CSS 结构（单一驱动源）**：
   - 暗色 = 基线，保持 `:root` 现值（兼容降级：即使脚本未运行，无 `data-theme` 即暗色，与现状一致）。
   - 浅色 = `:root[data-theme="light"]` 覆盖变量 + 组件浅色补齐。
   - **CSS 只响应 `data-theme`，不用 `prefers-color-scheme` 媒体查询做覆盖**，系统偏好只由 JS `matchMedia` 订阅后写进 `data-theme`，杜绝双驱动竞态。
   - `color-scheme` 放 `:root` 由 `data-theme` 选中：`:root:not([data-theme])`、`[data-theme="dark"]` → `dark`；`[data-theme="light"]` → `light`。
   - 浅色覆盖必须重定义全部文字中间色（`--text-secondary`/`--text-dim`/`--text-muted`）与兼容白叠加变量（`--bg-card`/`--bg-hover`/`--border-active`/`--bg-elevated`）为浅底深灰取向，否则浅色下文字对比度崩塌。
4. **切换接线位置与防闪烁**：`main.tsx` 顶部 **render 前同步**读取 localStorage 并在根元素设 `data-theme`/`color-scheme`，杜绝首帧暗色闪烁（FOUC）；随后挂 React。`App.tsx` 顶部导航 `.tabs` 区右侧放三段式控件。把「模式 + 生效主题」状态收敛到一个 `useThemeMode()` locale hook，由 `App` 持有并透传切换回调给导航；被 `system` 选择时 hook 订阅 `matchMedia` 实时联动。
5. **硬编码清理策略**：逐一映射
   - `#fff`/`rgba(255,255,255,0.6…)` 文字 → `var(--text)` / 既有 `--text-secondary` 层（暗色不变色值），浅色覆盖 `--text*`。
   - `rgba(255,255,255,0.03/0.04/0.06)` 表面底 → 新增 `--surface` 系列变量（暗色保留现值，浅色给浅底）。
   - 浅色 focus ring / hover 边框硬编码 `rgba(255,255,255,…)` → 用 `--border`/`--border-focus` 或新增中性边框变量。
   - 霓虹 `box-shadow`（accent/success glow）→ 用 `--accent-glow`/`--success-glow`，浅色覆盖为更淡。
   - `composer-send` 等 `color:#fff` 按钮 → `--on-accent`（白）变量。
   - css `color-scheme` 提升为根级可切换，不再固定 `dark`。

## 风险 / 权衡

| 风险 | 权衡 / 应对 |
|---|---|
| 硬编码清理遗漏 → 浅色反差失效 | 枚举 `rgba(255,255,255` / `#fff` 逐个核对；浅色下抽检激活卡片、modal、composer、Markdown 代码块、错误态 |
| 玻璃拟态 + 浅色半透明叠加发灰 | 浅色块卡片底提高不透明度、亮底色，并重定义兼容白叠加变量为浅色取向，保留 `backdrop-filter` 但减弱暗色 shadow |
| 原生 select/autofill/滚动条配色 | `color-scheme` 可切换根治 |
| 兼容降级 | 无 `data-theme` 即暗色基线，脚本异常也不会白屏/花屏 |
| 首帧闪屏（FOUC） | render 前同步设 `data-theme`/`color-scheme`，杜绝先暗后亮 |
| CSS 双驱动源竞态 | 单一驱动源，CSS 仅响应 `data-theme` |
| vitest/jsdom 下 matchMedia 不可用 | 单测 stub `matchMedia`（含 addEventListener/removeEventListener） |

## 迁移方案

- 无数据迁移：老用户 localStorage 无 `ccms.theme.v1.mode` → 视为 `system`（暗色系统仍暗色，行为不变）。
- 无 IPC/文件迁移，纯前端追加。

## 待决问题

- 无阻塞项。三项需求关键点（默认 system、localStorage、三段式切换入口）已在阶段 0 与用户确认。