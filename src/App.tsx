import { useState } from 'react';
import ModelSwitch from './components/ModelSwitch';
import { ChatPage } from './components/chat/ChatPage';
import { useThemeMode } from './hooks/useThemeMode';
import type { ThemeMode } from './lib/theme';
import './styles/chat.css';

type Tab = 'config' | 'chat';

const THEME_LABELS: Array<{ mode: ThemeMode; label: string }> = [
  { mode: 'light', label: '白天' },
  { mode: 'dark', label: '暗黑' },
  { mode: 'system', label: '跟随系统' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('config');
  const { mode, setMode } = useThemeMode();

  return (
    <div className="app-shell">
      <nav className="tabs" role="tablist" aria-label="主导航">
        <div className="tabs-item" role="presentation">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'config'}
            className={`tab${tab === 'config' ? ' is-active' : ''}`}
            onClick={() => setTab('config')}
          >
            模型切换
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={`tab${tab === 'chat' ? ' is-active' : ''}`}
            onClick={() => setTab('chat')}
          >
            对话
          </button>
        </div>
        <div className="tabs-right" role="group" aria-label="主题模式">
          {THEME_LABELS.map(({ mode: m, label }) => (
            <button
              key={m}
              type="button"
              className={`theme-toggle${mode === m ? ' is-active' : ''}`}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      {tab === 'config' ? <ModelSwitch /> : <ChatPage />}
    </div>
  );
}