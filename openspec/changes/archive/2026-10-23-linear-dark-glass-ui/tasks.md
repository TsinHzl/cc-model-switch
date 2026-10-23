# 任务清单：linear-dark-glass-ui

## 状态：DONE（已归档 2026-10-23）

## 任务
- [x] 任务 1：重写 `src/styles/theme.css` 为设计稿变量（bg #090b10 + 三重 radial 光晕、玻璃卡片色、indigo #6366f1、系统字体栈），验证：`npm run build` 通过且页面背景/主色生效
- [x] 任务 2：重写 `src/styles/components.css` 顶部栏与通用按钮（header/渐变图标块/version-tag/subtitle+stats-badge/btn/btn-primary 渐变），验证：构建后视觉对照设计稿
- [x] 任务 3：新增 Hero 激活卡片样式（active-hero/脉冲徽标/meta 行/latency-pill/复制 Env 按钮）并在 `ModelSwitch.tsx` 渲染真实激活条目（含一次性 fetch 测速 + buildExportLines 复制 Env），验证：ready 态显示当前条目，复制入剪贴板
- [x] 任务 4：新增搜索框样式（search-input-wrap/放大镜图标/⌘K kbd 装饰胶囊）与 `ModelSwitch.tsx` 过滤逻辑（model/channel/base_url 包含匹配，空词显示全部），验证：输入关键词即时过滤列表
- [x] 任务 5：重写分组卡与模型行样式（endpoint-card/endpoint-header/subgroup/subgroup-title/model-row/model-name/key-box/btn-switch current/hover-actions/btn-icon），`ModelSwitch.tsx` 行结构对齐设计稿：key 胶囊点击复制完整 key（显示随 showKeys 联动明/密）、切换按钮显式触发、行移除整行点击、副操作悬浮显现（复制=JSON 条目四字段/编辑/删除）、不渲染 model-badge，验证：交互全通（切换/编辑/删除/复制 key/复制 JSON/新增入口含渠道预填）
- [x] 任务 6：弹窗（ConfirmDialog/EntryForm/ConfirmDelete）、toast、ErrorPane/JsonErrorPane、Gate 与 App 环境页换皮适配新主题变量，验证：密码门禁→错误态→弹窗→toast 全链路视觉一致且功能正常
- [x] 任务 7：全量回归：`npx tsc -b` + `npx vitest run`（47 用例）+ `npm run build` + 手动核对无旧类名残留（grep 旧类名清单），验证：全部通过

## 验收标准
- [ ] 页面视觉与设计稿一致：暗色玻璃拟态、indigo 主色、Hero 卡、搜索框、分组卡、模型行、悬浮副操作
- [ ] 全部既有功能不受影响：切换（写入位置二选一）、增/改/删（含渠道入口预填锁定 key）、复制 key、显示/隐藏 key、刷新、授权流程、JSON 损坏错误态、密码门禁
- [ ] Hero 卡显示真实激活条目（key 随 showKeys 联动明/密）+ 实测延迟（失败显示 —）+ 复制 Env（7 个 export 行）
- [ ] 搜索过滤即时生效（含 ⌘K 装饰）且不影响 activeIndex/编辑删除的下标语义
- [ ] hover 复制副操作输出 JSON 条目四字段；version-tag 显示真实版本号；不渲染 model-badge 假徽标
- [ ] tsc / vitest 47 用例 / build 全绿
