# 变更提案：add-modal-transitions

## 背景

当前四个弹窗（`ConfirmDelete`、`EntryForm`、`ModelSwitch` 的切换确认、`ConfirmClearAll`）共用 `.modal-mask` / `.modal` 结构，但样式里没有任何 `animation` / `transition`（`src/styles/components.css:600-624`）。弹窗瞬间出现、瞬间消失，缺少进入与退出的视觉过渡，与仓库其余交互（按钮 hover、列表项均为 150–200ms 过渡）风格不一致。

## 目标范围

**在范围内：**
- 弹窗遮罩淡入/淡出 + 内容轻微上浮与缩放的进入、退出动画
- 四个弹窗全部接入同一套动画，行为一致
- 退场动画需要组件在关闭时保留短暂延迟后再卸载（否则元素立即移除，动画看不到）
- 尊重系统「减弱动态效果」（`prefers-reduced-motion: reduce`）时跳过动画
- 为新增的关闭态逻辑补单元测试

**不在范围内：**
- 对话页输入区的模型下拉、消息区、侧栏等其他浮层的动画
- 弹窗的焦点圈闭、Esc 关闭、初始焦点管理（既有 known issue #4，另行处理）
- 弹窗尺寸、间距、配色等视觉样式调整
- 页面切换（模型切换 / 对话页签）的过渡动画

## 技术方案

1. **共享关闭动画 hook**：新增 `src/components/useModalClose.ts`，导出 `useModalClose(onClosed: () => void)`，返回 `{ closing, requestClose }`。组件是否挂载由父级状态决定，hook 只负责关闭阶段；`requestClose()` 置 `closing=true`，在 `animationend` 或兜底定时器（与 CSS 动画时长一致）后调用 `onClosed()`；重复调用幂等。
2. **组件接入**：四个弹窗的「取消 / 确认」按钮改为先调用 `requestClose()`，再在 `onClosed` 回调里执行原本的父级关闭逻辑；`closing` 为真时遮罩与内容挂 `.is-closing` 类。
3. **CSS**：在 `src/styles/components.css` 的弹窗区块新增 `.modal-mask` / `.modal` 的入场动画与 `.is-closing` 退场动画，统一 180–200ms、`cubic-bezier(0.16, 1, 0.3, 1)`；`@media (prefers-reduced-motion: reduce)` 下 `animation: none` 并把兜底延时降为 0。
4. **一致性与安全**：动画只改视觉层，不改变弹窗的 `role="dialog"` / `aria-modal` 语义；`closing` 期间按钮禁用，避免重复触发写入。

## 预期影响

- 纯前端样式与交互层改动，不触及 preload / IPC / 文件层 / 对话请求链路
- 关闭弹窗的时机由「立即卸载」变为「约 180ms 后卸载」，父级状态更新延后；写入操作仍在动画开始前或结束后按现有逻辑执行，不改变写入语义
- 不影响配置读写、会话存储与任何持久化格式
- 打包产物需重新构建安装才能看到效果

## 风险

| 风险 | 应对 |
|---|---|
| 关闭回调未触发导致弹窗卡住 | `animationend` + 兜底 setTimeout 双保险；hook 内部保证 `onClosed` 只调用一次 |
| 组件卸载时残留定时器 | hook 在 `useEffect` 清理函数中清除定时器 |
| 动画期间重复点击触发两次写入 | `closing` 期间禁用按钮；`requestClose` 幂等 |
| 减弱动态效果用户看到延迟 | `prefers-reduced-motion` 下动画与延时同时归零 |
| 四个弹窗改动遗漏 | 逐组件接入并在 tasks 中单列，新增测试覆盖 hook 与组件闭包时机 |
