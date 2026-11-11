import { useState } from 'react';
import ModelSwitch from './components/ModelSwitch';
import { ChatPage } from './components/chat/ChatPage';
import { useConfigState } from './lib/configStore';
import './styles/chat.css';

type Tab = 'config' | 'chat';

export default function App() {
  const [tab, setTab] = useState<Tab>('config');
  const { status } = useConfigState();
  const config = status.kind === 'ready' ? status.state : null;

  return (
    <div className="app-shell">
      <nav className="tabs" role="tablist" aria-label="主导航">
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
      </nav>
      {tab === 'config' ? (
        <ModelSwitch />
      ) : (
        <ChatPage config={config} />
      )}
    </div>
  );
}