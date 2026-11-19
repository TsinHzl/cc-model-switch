/* 主题模式（白天 / 暗黑 / 跟随系统）纯逻辑与运行时接线。
   存储沿用 renderer localStorage（与 ccms.chat.v1.* 同族），读写经注入 storage，便于测试与降级。 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

export const THEME_MODE_KEY = 'ccms.theme.v1.mode';

/** 存储读写的最小接口；getItem/setItem 抛异常视为存储不可用（降级）。 */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** renderer 的 localStorage 实现；异常透传给调用方，由读取/写入函数内降级。 */
export const themeWebStorage: ThemeStorage = {
  getItem(key) {
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    window.localStorage.setItem(key, value);
  },
};

/** 读取主题模式；非法值或存储异常一律降级为 system（跟随系统），不阻塞启动。 */
export function loadThemeMode(storage: ThemeStorage): ThemeMode {
  try {
    const raw = storage.getItem(THEME_MODE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    return 'system';
  } catch {
    return 'system';
  }
}

/** 持久化主题模式；写入失败静默降级（跟随系统），不向调用方抛错。 */
export function saveThemeMode(storage: ThemeStorage, mode: ThemeMode): void {
  try {
    storage.setItem(THEME_MODE_KEY, mode);
  } catch {
    /* 存储不可用（隐私模式 / 配额）时静默丢弃，本进程内仍可切换。 */
  }
}

/** 由模式与系统偏好解析生效主题；system 跟随系统，light/dark 固定。 */
export function resolveTheme(mode: ThemeMode, systemLight: boolean): EffectiveTheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return systemLight ? 'light' : 'dark';
}

/** 把生效主题应用到根元素（data-theme + color-scheme），供 render 前调用防首帧闪屏。 */
export function applyThemeRoot(effective: EffectiveTheme): void {
  const root = document.documentElement;
  root.dataset.theme = effective;
  root.style.colorScheme = effective;
}

/** 读取系统外观偏好（prefers-color-scheme: light 是否匹配）。 */
export function systemPrefersLight(): boolean {
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** 订阅系统外观偏好变化；返回取消订阅函数。 */
export function onSystemPrefChange(listener: (light: boolean) => void): () => void {
  const mql = window.matchMedia(LIGHT_QUERY);
  const handler = (e: MediaQueryListEvent) => listener(e.matches);
  mql.addEventListener('change', handler);
  return () => mql.removeEventListener('change', handler);
}