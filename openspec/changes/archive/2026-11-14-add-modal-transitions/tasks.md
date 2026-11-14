# 任务清单：add-modal-transitions

## 状态：ARCHIVED

## 执行约束
- 仅使用 proposal.md 和本文件追踪轻量 OpenSpec（本变更无 spec.md / design.md）。
- 动画时长与缓动集中定义，四个弹窗共用同一套类名，禁止为单个弹窗单独写关键帧。
- 不改变弹窗的 `role="dialog"` / `aria-modal` / 按钮文案与写入语义。
- 每个任务独立验证后勾选，不以一次总体验收代替逐项证据。
- 不自动提交、合并或推送；应用代码修改前另行展示完整 diff 并确认。

## 任务
- [x] 1. 新增 `src/components/useModalClose.ts`：`useModalClose(onClosed)` 返回 `{ closing, requestClose, onAnimationEnd }`，`requestClose` 幂等，`animationend` 与兜底定时器双保险且只回调一次，卸载时清理定时器。验证：`npm test -- src/components/__tests__/modalClose.test.ts`（仓库测试环境为 node，改用纯函数计时器测试替代原计划的 useModalClose.test.ts，经用户确认）。
- [x] 2. 在 `src/styles/components.css` 弹窗区块加入入场动画（遮罩淡入、内容上浮 + 轻微放大）与 `.is-closing` 退场动画，统一 180ms `cubic-bezier(0.16, 1, 0.3, 1)`。验证：样式文件中四个弹窗共用同一选择器，无重复关键帧。
- [x] 3. 为 `prefers-reduced-motion: reduce` 关闭动画，并让 hook 的兜底延时同步归零。验证：CSS 媒体查询存在；hook 读取同一时长常量（`MODAL_ANIMATION_MS`）。
- [x] 4. 接入 `ConfirmDelete`：取消/确认按钮先 `requestClose()`，关闭回调里再执行 `onCancel` / `onConfirm`；`closing` 期间按钮禁用。验证：`npm test -- src/components/__tests__/modalTransitions.test.tsx` 断言延迟到时才调用父级回调。
- [x] 5. 接入 `EntryForm`：同上，且表单提交（新增/编辑）走同一关闭路径。验证：同一测试文件覆盖提交路径。
- [x] 6. 接入 `ModelSwitch` 的切换确认弹窗：同上，保留 `busy` 写入期间按钮禁用语义。验证：同一测试文件覆盖，且 `busy` 时按钮仍禁用。
- [x] 7. 接入 `ConfirmClearAll`：同上。验证：同一测试文件覆盖。
- [x] 8. 全量验证：`npm test`、`npx tsc -b`、`npm run desktop:typecheck`、`npm run build` 全部通过，并核对待测文件未被遗漏。验证：命令输出结论。

## 验收标准
- [x] 四个弹窗（删除确认、新增/编辑表单、切换确认、清空历史确认）打开时均有淡入 + 上浮动画，关闭时均有淡出 + 下沉动画，时长与缓动一致。
- [x] 关闭动画结束前弹窗仍然可见，动画结束后才真正卸载，且父级回调只触发一次。
- [x] `prefers-reduced-motion: reduce` 下无动画、无额外延迟。
- [x] 动画期间重复点击不会触发两次配置写入或两次删除。
- [x] 弹窗的无障碍语义（`role="dialog"` / `aria-modal="true"`）与所有按钮文案保持不变。
- [x] `npm test` 全部通过，`npx tsc -b` 与 `npm run desktop:typecheck` 无错误。
