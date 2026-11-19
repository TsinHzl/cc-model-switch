# 任务清单：add-light-dark-theme

## 状态：ARCHIVED

## 任务
- [x] 新增主题模式存储与纯逻辑：定义 `ThemeMode`（`'system' | 'light' | 'dark'`）、`resolveTheme(mode, systemPref)`、localStorage 读写 `ccms.theme.v1.mode`（读失败降级 `system`）、`applyThemeRoot(effective)` 同步设根元素 `data-theme` 与 `color-scheme`、`systemPrefersLight()` 读系统偏好。验证：新增 `src/lib/theme.ts` + `__tests__/theme.test.ts` 单测（含 `resolveTheme`、localStorage 降级、固定主题不随系统、根元素应用）通过 `npm test`
- [x] 改造 `theme.css` 为「暗色基线 + 浅色覆盖」：暗色 `:root` 现值保留，新增 `:root[data-theme="light"]` 覆盖全部主题变量——含文字中间色 `--text-secondary`/`--text-dim`/`--text-muted` 与兼容白叠加变量 `--bg-card`/`--bg-hover`/`--border-active`/`--bg-elevated` 的浅底深灰取向；根级 `color-scheme` 改为随 `data-theme` 切换（无属性回退 dark）；CSS 只响应 `data-theme`，不使用 prefers-color-scheme 覆盖。验证：仅改 CSS，`npx tsc -b` 通过；人工核对浅色变量与暗色齐整
- [x] 清理组件层浅色硬编码（`components.css` / `chat.css`）：将 `rgba(255,255,255,…)`、`#fff` 文字、霓虹 box-shadow、浅色 focus ring、`composer-send` 白字逐一映射到既有/新增主题变量，暗色色值不变。验证：grep 确认组件文件不再含针对性浅色硬编码；`npx tsc -b` + `npm test` 通过
- [x] 接线运行时生效主题与切换入口：`main.tsx` **render 前同步**读取 localStorage 并设根元素 `data-theme`/`color-scheme`（防 FOUC）并订阅 `matchMedia` change；`App.tsx` 顶部导航 `.tabs` 右侧加「白天 / 暗黑 / 跟随系统」三段式控件，`aria-pressed` 标记当前选择，点击即时持久化并生效，`system` 模式实时联动。验证：`npm run dev` 手动核对三段切换即时变色、浅色/跟随下首帧无暗色闪烁、重启后保留、`color-scheme` 跟随

## 验收标准
- [ ] 新建可选 `system`（默认）/ `light` / `dark`，首启跟随系统外观，暗色基线不改变既有暗色系统用户观感
- [ ] 三段式切换入口在顶部导航可见，选择即时生效并持久化到 renderer localStorage，重启保留
- [ ] `system` 模式下跟随系统外观变化（matchMedia change 实时更新），固定主题下不随系统
- [ ] 浅色模式全组件清晰可读、对比度与暗色一致，无浅色底白字等反差失效
- [ ] 根级 `color-scheme` 随生效主题切换，原生控件/滚动条配色跟随
- [ ] 业务逻辑、IPC 契约、主进程、布局结构零改动；`npm test`、`npx tsc -b`、`npm run desktop:typecheck` 通过