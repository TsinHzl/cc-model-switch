/* 消息列表：思考折叠、搜索块、错误/中断标记、复制、重生成、用量。 */
import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, WebSearchCall } from '../../lib/chatTypes';
import { writeClipboardText, clipboardErrorMessage } from '../../lib/clipboardClient';
import { Markdown } from './Markdown';

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function ReasoningBlock({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const thinking = message.status === 'streaming' && message.reasoningMs === undefined;
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thinking && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [message.reasoning, thinking]);
  const label = thinking
    ? '思考中…'
    : message.reasoningMs !== undefined ? `思考 ${(message.reasoningMs / 1000).toFixed(1)}s` : '思考过程';
  return (
    <div className="chat-block">
      <button type="button" className="chat-collapse" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {label}
      </button>
      {open && <div ref={boxRef} className="chat-reasoning">{message.reasoning}</div>}
    </div>
  );
}

function SearchBlock({ search }: { search: WebSearchCall }) {
  const [open, setOpen] = useState(false);
  const searching = search.status === 'searching';
  const detail = search.status === 'error'
    ? '搜索失败'
    : search.status === 'stopped' ? '搜索已中断'
      : searching ? null
        : search.results.length === 0 ? '无结果' : `${search.results.length} 条结果`;
  const expandable = search.results.length > 0;
  return (
    <div className="chat-block">
      <button
        type="button"
        className="chat-collapse"
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen(!open)}
      >
        {searching ? '···' : '🌐'} 搜索「{search.query || '…'}」{detail && <span>· {detail}</span>}
      </button>
      {open && expandable && (
        <ul className="chat-search-results">
          {search.results.map((r, i) => (
            <li key={`${r.url}-${i}`}>
              {isHttpUrl(r.url) ? (
                <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a>
              ) : (
                <span>{r.title}</span>
              )}
              {r.snippet && <p>{r.snippet}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UsageStats({ usage }: { usage: NonNullable<ChatMessage['usage']> }) {
  const n = (v: number) => v.toLocaleString();
  return (
    <span className="chat-usage" title="输入 / 输出 tokens">
      ↓{n(usage.input)} ↑{n(usage.output)}
    </span>
  );
}

export function MessageItem({
  message,
  canRegenerate,
  onRegenerate,
}: {
  message: ChatMessage;
  canRegenerate: boolean;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await writeClipboardText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(clipboardErrorMessage(err));
    }
  };

  if (message.role === 'user') {
    return (
      <div className="chat-message user">
        {message.attachments && message.attachments.length > 0 && (
          <div className="chat-attachments-inline">
            {message.attachments.map(a => <span key={a.id} className="chat-attach-name">📎 {a.name}</span>)}
          </div>
        )}
        {message.content !== '' && <div className="chat-bubble">{message.content}</div>}
      </div>
    );
  }

  const streaming = message.status === 'streaming';
  const searchPending = message.searches?.some(s => s.status === 'searching') ?? false;
  const waiting = streaming && message.content === '' && !message.reasoning && !searchPending;

  return (
    <div className="chat-message assistant">
      {message.reasoning && <ReasoningBlock message={message} />}
      {message.searches?.map(s => <SearchBlock key={s.id} search={s} />)}
      {message.content !== '' && <Markdown text={message.content} />}
      {waiting && <span className="chat-caret">▍</span>}
      {message.status === 'stopped' && <p className="chat-status">已停止生成。</p>}
      {message.status === 'error' && <p className="chat-status error">{message.error ?? '对话请求失败。'}</p>}
      {!streaming && (
        <div className="chat-actions">
          {message.content !== '' && (
            <button type="button" className="chat-action" onClick={() => void copy()}>
              {copied ? '已复制' : '复制'}
            </button>
          )}
          {canRegenerate && (
            <button type="button" className="chat-action" onClick={onRegenerate}>重生成</button>
          )}
          {message.model && <span className="chat-model">{message.model}</span>}
          {message.usage && <UsageStats usage={message.usage} />}
        </div>
      )}
    </div>
  );
}