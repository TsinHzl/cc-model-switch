/* 历史会话侧栏：新建 / 选择 / 删除 / 清空。 */
import type { SessionMeta } from '../../lib/chatStore';

function formatTime(ms: number): string {
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(
    undefined,
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: '2-digit', day: '2-digit' },
  );
}

export function SessionsSidebar({
  sessions,
  activeId,
  locked,
  onNew,
  onSelect,
  onDelete,
  onClearAll,
}: {
  sessions: readonly SessionMeta[];
  activeId: string | null;
  locked: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  return (
    <aside className="chat-sidebar">
      <div className="chat-sidebar-head">
        <button type="button" className="chat-new" disabled={locked} onClick={onNew}>+ 新对话</button>
        <button
          type="button"
          className="chat-clear"
          disabled={locked || sessions.length === 0}
          title="清空全部历史"
          onClick={onClearAll}
        >
          清空
        </button>
      </div>
      <div className="chat-sidebar-label">历史</div>
      <div className="chat-sidebar-list">
        {sessions.length === 0 ? (
          <p className="chat-sidebar-empty">暂无历史对话</p>
        ) : (
          <ul>
            {sessions.map(s => {
              const active = s.id === activeId;
              return (
                <li key={s.id} className={`chat-session${active ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    className="chat-session-main"
                    disabled={locked && !active}
                    onClick={() => onSelect(s.id)}
                  >
                    <span className="chat-session-title">{s.title || '新对话'}</span>
                    <span className="chat-session-meta">
                      {formatTime(s.updatedAt)} · {s.messageCount} 条
                    </span>
                  </button>
                  <button
                    type="button"
                    className="chat-session-del"
                    disabled={locked && active}
                    title="删除该会话"
                    onClick={() => onDelete(s.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}