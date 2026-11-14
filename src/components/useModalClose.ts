/* 弹窗关闭动画 hook：把 createCloseTimer 接到 React 生命周期。
   组件是否挂载由父级状态决定；本 hook 只负责退场动画与延迟卸载。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createCloseTimer, MODAL_ANIMATION_MS } from './modalClose';

/** 系统开启「减弱动态效果」时不做动画，也不额外延迟。 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface ModalClose {
  /** 为真时挂 .is-closing 并禁用按钮。 */
  readonly closing: boolean;
  /** 幂等；到期调用 onClosed。 */
  readonly requestClose: () => void;
  /** 绑定到遮罩 onAnimationEnd，退场动画结束时立即收尾。 */
  readonly onAnimationEnd: (event: { currentTarget: unknown; target: unknown }) => void;
}

/**
 * @param onClosed 退场动画结束后执行；可每次渲染新建，内部始终取最新引用。
 *   回调里必须无条件卸载弹窗（成功与失败都要卸载），否则弹窗会停在不可见的关闭态。
 */
export function useModalClose(onClosed: () => void): ModalClose {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof createCloseTimer> | null>(null);
  // 始终调用最新的回调，避免父级每次渲染重建函数导致定时器失效。
  const callbackRef = useRef(onClosed);
  callbackRef.current = onClosed;
  // 入场动画同样会在遮罩上触发 animationend，只有关闭阶段才允许提前收尾。
  const closingRef = useRef(false);

  if (timerRef.current === null) {
    timerRef.current = createCloseTimer(
      () => callbackRef.current(),
      prefersReducedMotion() ? 0 : MODAL_ANIMATION_MS,
    );
  }

  useEffect(() => () => {
    timerRef.current?.cancel();
    timerRef.current = null;
  }, []);

  const requestClose = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
    timerRef.current?.requestClose();
  }, []);

  const onAnimationEnd = useCallback((event: { currentTarget: unknown; target: unknown }) => {
    // 只处理遮罩自身的动画：子元素冒泡与入场动画都不应触发关闭。
    if (!closingRef.current || event.target !== event.currentTarget) return;
    timerRef.current?.finish();
  }, []);

  return { closing, requestClose, onAnimationEnd };
}
