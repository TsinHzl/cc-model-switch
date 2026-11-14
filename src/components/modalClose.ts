/* 弹窗关闭动画的计时控制：与实际 CSS 动画时长共用同一常量。
   组件是否挂载由父级状态决定，本 hook 只负责「关闭中」这一段。 */

/** 入场 / 退场统一时长；必须与 components.css 中 .modal-mask / .modal 的 animation 时长一致。 */
export const MODAL_ANIMATION_MS = 180;

/**
 * 直接操作 React state 的计时器；抽成独立工厂便于在 node 环境下用假定时器测试。
 * requestClose 幂等；finish 只触发一次；cancel 释放定时器（卸载时调用）。
 */
export function createCloseTimer(
  onClosed: () => void,
  durationMs: number = MODAL_ANIMATION_MS,
  schedule: (fn: () => void, ms: number) => number = (fn, ms) => window.setTimeout(fn, ms),
  cancel: (handle: number) => void = handle => window.clearTimeout(handle),
) {
  let timer: number | null = null;
  let done = false;
  return {
    requestClose(): void {
      if (done || timer !== null) return;
      timer = schedule(finish, durationMs);
    },
    /** 动画自然结束时提前收尾，避免等待兜底定时器。 */
    finish,
    /** 释放定时器；不清除 done，重复调用安全。 */
    cancel(): void {
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
    },
    get finished(): boolean {
      return done;
    },
    get pending(): boolean {
      return timer !== null;
    },
  };

  function finish(): void {
    if (done) return;
    done = true;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    onClosed();
  }
}
