import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { applyThemeRoot, loadThemeMode, resolveTheme, systemPrefersLight } from './lib/theme';
import './styles/theme.css';
import './styles/components.css';

// render 前同步应用主题，杜绝首帧暗色闪烁（FOUC）：读取持久化模式，默认跟随系统。
applyThemeRoot(resolveTheme(loadThemeMode(window.localStorage), systemPrefersLight()));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
