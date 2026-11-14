/* 弹窗关闭计时器测试：node 环境无 DOM，用注入的 schedule/cancel 验证幂等与单次回调。 */
import { describe, expect, it, vi } from 'vitest';
import { createCloseTimer, MODAL_ANIMATION_MS } from '../modalClose';

function harness(durationMs = MODAL_ANIMATION_MS) {
  const onClosed = vi.fn();
  const pending = new Map<number, () => void>();
  let seq = 0;
  const cancel = vi.fn((handle: number) => { pending.delete(handle); });
  const timer = createCloseTimer(
    onClosed,
    durationMs,
    (fn) => { seq += 1; pending.set(seq, fn); return seq; },
    cancel,
  );
  const fire = () => {
    const entry = [...pending.entries()][0];
    if (!entry) return false;
    pending.delete(entry[0]);
    entry[1]();
    return true;
  };
  return { timer, onClosed, cancel, fire, pendingCount: () => pending.size };
}

describe('createCloseTimer', () => {
  it('未请求关闭前不回调', () => {
    const { timer, onClosed } = harness();
    expect(timer.pending).toBe(false);
    expect(timer.finished).toBe(false);
    expect(onClosed).not.toHaveBeenCalled();
    expect(timer.requestClose).toBeTypeOf('function');
  });

  it('请求关闭后到点回调一次', () => {
    const { timer, onClosed, fire, pendingCount } = harness();
    timer.requestClose();
    expect(timer.pending).toBe(true);
    expect(pendingCount()).toBe(1);
    expect(onClosed).not.toHaveBeenCalled();
    fire();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(timer.finished).toBe(true);
  });

  it('重复 requestClose 只排一个定时器且回调一次', () => {
    const { timer, onClosed, fire, pendingCount } = harness();
    timer.requestClose();
    timer.requestClose();
    timer.requestClose();
    expect(pendingCount()).toBe(1);
    fire();
    expect(onClosed).toHaveBeenCalledTimes(1);
    // 结束后再请求也不再回调
    timer.requestClose();
    fire();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('finish 提前收尾并释放定时器，不会二次回调', () => {
    const { timer, onClosed, fire, cancel } = harness();
    timer.requestClose();
    timer.finish();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    fire();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('cancel 释放定时器且不回调（卸载路径）', () => {
    const { timer, onClosed, fire, pendingCount } = harness();
    timer.requestClose();
    timer.cancel();
    expect(pendingCount()).toBe(0);
    fire();
    expect(onClosed).not.toHaveBeenCalled();
    expect(timer.finished).toBe(false);
    // 重复 cancel 安全
    timer.cancel();
  });

  it('减弱动态效果时用 0 毫秒时长', () => {
    const { timer, onClosed, fire } = harness(0);
    timer.requestClose();
    fire();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('默认时长为 180ms，与 CSS 动画时长常量一致', () => {
    expect(MODAL_ANIMATION_MS).toBe(180);
  });
});
