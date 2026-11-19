/* useThemeMode：主题模式（白天 / 暗黑 / 跟随系统）的 React 状态与根元素副作用。
   状态在 App 持有并透传切换回调给导航；system 模式下订阅系统外观实时联动。 */
import { useCallback, useEffect, useState } from 'react';
import {
  applyThemeRoot,
  loadThemeMode,
  onSystemPrefChange,
  resolveTheme,
  saveThemeMode,
  systemPrefersLight,
  themeWebStorage,
  type EffectiveTheme,
  type ThemeMode,
} from '../lib/theme';

export interface ThemeState {
  /** 用户选择：system / light / dark。 */
  mode: ThemeMode;
  /** 当前生效主题（已解析，非 system）。 */
  effective: EffectiveTheme;
  setMode: (mode: ThemeMode) => void;
}

export function useThemeMode(): ThemeState {
  // 初始同步读取（renders 前状态已定，配合 main.tsx 预设根元素防 FOUC）。
  const [mode, setModeState] = useState<ThemeMode>(() => loadThemeMode(themeWebStorage));
  const [systemLight, setSystemLight] = useState<boolean>(() => systemPrefersLight());

  useEffect(() => {
    return onSystemPrefChange(setSystemLight);
  }, []);

  const effective = resolveTheme(mode, systemLight);

  // 生效主题变化 -> 同步根元素 data-theme / color-scheme。
  useEffect(() => {
    applyThemeRoot(effective);
  }, [effective]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    saveThemeMode(themeWebStorage, next);
  }, []);

  return { mode, effective, setMode };
}