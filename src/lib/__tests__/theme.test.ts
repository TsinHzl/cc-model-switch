/* theme.ts 单元测试：模式读写降级、生效主题解析、根元素应用。 */
import { describe, expect, it } from 'vitest';
import {
  applyThemeRoot,
  loadThemeMode,
  resolveTheme,
  saveThemeMode,
  THEME_MODE_KEY,
} from '../theme';

/** 可控 storage 替身；setItem 可配置抛错模拟配额 / 隐私模式。 */
function memoryStorage(failOnWrite = false) {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      if (failOnWrite) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
  };
}

describe('loadThemeMode', () => {
  it('无记录时降级为 system', () => {
    expect(loadThemeMode(memoryStorage())).toBe('system');
  });

  it('读取合法持久化值', () => {
    const s = memoryStorage();
    s.setItem(THEME_MODE_KEY, 'light');
    expect(loadThemeMode(s)).toBe('light');
    s.setItem(THEME_MODE_KEY, 'dark');
    expect(loadThemeMode(s)).toBe('dark');
    s.setItem(THEME_MODE_KEY, 'system');
    expect(loadThemeMode(s)).toBe('system');
  });

  it('非法值 / storage 抛错均降级为 system', () => {
    const s = memoryStorage();
    s.setItem(THEME_MODE_KEY, 'blue');
    expect(loadThemeMode(s)).toBe('system');
    const err = { getItem: () => { throw new Error('denied'); }, setItem: (_k: string, _v: string) => {} };
    expect(loadThemeMode(err)).toBe('system');
  });
});

describe('saveThemeMode', () => {
  it('写入持久化值', () => {
    const s = memoryStorage();
    saveThemeMode(s, 'dark');
    expect(s.getItem(THEME_MODE_KEY)).toBe('dark');
  });

  it('storage 抛错时静默不抛', () => {
    expect(() => saveThemeMode(memoryStorage(true), 'light')).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it('system 跟随系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });

  it('light/dark 固定，不随系统偏好', () => {
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('applyThemeRoot', () => {
  it('设置 data-theme 与 color-scheme', () => {
    const dataset: Record<string, string> = {};
    const style: Record<string, string> = {};
    // 最小 document stub：测试仅验证写入 data-theme 与 style.colorScheme。
    const prev = (globalThis as Record<string, unknown>).document;
    (globalThis as Record<string, unknown>).document = {
      documentElement: { dataset, style },
    };
    try {
      applyThemeRoot('light');
      expect(dataset.theme).toBe('light');
      expect(style.colorScheme).toBe('light');
    } finally {
      (globalThis as Record<string, unknown>).document = prev;
    }
  });
});