/* 对话页：组合侧栏、消息列表与输入区，承担会话状态、流式拼装与本地存储。 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatStartRequest } from '../../lib/chatIpcContract';
import type { ConfigEntry } from '../../lib/applyConfig';
import type { LoadStatus } from '../../lib/configStore';
import { loadConfigState } from '../../lib/configStore';
import type { ChatConfig, ChatMessage } from '../../lib/chatTypes';
import { normalizeEffort } from '../../lib/thinking';
import { finalizeMessage, reduceChunk } from '../../lib/chatStream';
import {
  clearSessions, deleteSession, listSessions, loadChatConfig, loadSession,
  saveActiveId, saveChatConfig, saveSession, type SessionMeta,
} from '../../lib/chatStore';
import { deriveTitle, normalizeMessages } from '../../lib/chatHistory';
import { Composer } from './Composer';
import { MessageItem } from './MessageList';
import { SessionsSidebar } from './SessionsSidebar';

/** 把当前会话消息转成 request 消息：空 content 的回复丢弃；合并相邻同角色；附件按类组装。 */
function toChatMessages(messages: ChatMessage[]): unknown[] {
  const merged: { role: 'user' | 'assistant'; blocks: unknown[] }[] = [];
  for (const m of messages) {
    const blocks: unknown[] = [];
    for (const a of m.attachments ?? []) {
      if (a.data === '') continue; // 持久化后 data 被剥离，不参与请求
      if (a.kind === 'image') {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
      } else {
        const name = a.name.replace(/"/g, "'");
        blocks.push({ type: 'text', text: `<attachment name="${name}">\n${a.data}\n</attachment>` });
      }
    }
    if (m.content.trim() !== '') blocks.push({ type: 'text', text: m.content });
    if (blocks.length === 0) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.blocks.push(...blocks);
    else merged.push({ role: m.role, blocks });
  }
  return merged.map(({ role, blocks }) => {
    if (blocks.every(b => (b as { type: string }).type === 'text')) {
      return { role, content: blocks.map(b => (b as { type: 'text'; text: string }).text).join('\n\n') };
    }
    return { role, content: blocks };
  });
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function activeKey(): string {
  return 'ccms.chat.v1.active';
}

function readActiveId(): string | null {
  try {
    return localStorage.getItem(activeKey());
  } catch {
    return null;
  }
}

/** 读取某个会话的创建时间；无记录返回 null。 */
function readCreatedAtId(id: string): number | null {
  try {
    const raw = String(localStorage.getItem(`ccms.chat.v1.session:${id}`));
    const parsed: unknown = JSON.parse(raw);
    return typeof (parsed as { createdAt?: unknown })?.createdAt === 'number'
      ? (parsed as { createdAt: number }).createdAt : null;
  } catch {
    return null;
  }
}

function codeText(code: string): string {
  switch (code) {
    case 'FORBIDDEN': return '请求被拒绝（来源不受信任）。';
    case 'RATE_LIMITED': return '当前已有对话生成中，请稍后再试。';
    case 'UNKNOWN_ENTRY': return '该模型配置已不存在，请重新选择。';
    case 'UNSUPPORTED_URL': return '网关地址不受支持。';
    case 'BODY_TOO_LARGE': return '请求内容超过 8 MiB 上限。';
    default: return `对话请求失败（${code}）。`;
  }
}

export function ChatPage() {
  // 配置状态自持，避免与配置页同时各调用一次 state 触发单在途 RATE_LIMITED。
  const [configStatus, setConfigStatus] = useState<LoadStatus>({ kind: 'loading' });
  const entries: ConfigEntry[] = configStatus.kind === 'ready' ? configStatus.state.entries : [];
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatConfig, setChatConfig] = useState<ChatConfig>(() => loadChatConfig(window.localStorage));
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => readActiveId());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [degraded, setDegraded] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const chatConfigRef = useRef(chatConfig);
  chatConfigRef.current = chatConfig;
  const isGeneratingRef = useRef(isGenerating);
  isGeneratingRef.current = isGenerating;
  const createdAtRef = useRef<number | null>(null);

  const modelKey = chatConfig.model;
  const currentEntry = entries.find(e => `${e.model}:${e.base_url}` === modelKey) ?? null;

  // 持久化选择与活动会话
  useEffect(() => { saveChatConfig(window.localStorage, chatConfig); }, [chatConfig]);
  useEffect(() => { saveActiveId(window.localStorage, activeId); }, [activeId]);

  const refreshSessions = useCallback(() => {
    setSessions(listSessions(window.localStorage).sessions);
  }, []);

  const persist = useCallback((msgs: ChatMessage[]) => {
    let createdAt = createdAtRef.current ?? Date.now();
    if (!sessionIdRef.current) createdAtRef.current = createdAt;
    const saved = saveSession(window.localStorage, {
      id: sessionIdRef.current,
      title: deriveTitle(msgs),
      createdAt,
      messages: msgs,
    });
    setDegraded(saved.degraded);
    setSessionId(saved.id);
    // 降级（内容未落盘）时不为不存在的 id 声明活动会话，避免重载后出现「幽灵」活动项。
    if (!saved.degraded) setActiveId(saved.id);
    refreshSessions();
  }, [refreshSessions]);

  // 首次进入：恢复本地活动会话；随后每次切回本页时刷新历史索引
  const initRef = useRef(false);
  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      const id = readActiveId();
      if (id) {
        const restored = loadSession(window.localStorage, id);
        if (restored.length > 0) {
          setMessages(normalizeMessages(restored));
          setSessionId(id);
          setActiveId(id);
          createdAtRef.current = readCreatedAtId(id);
        }
      }
    }
    refreshSessions();
  }, [refreshSessions]);

  // 加载最新配置列表：对话页独立请求，不依赖配置页的 hook 实例。
  const reloadConfig = useCallback(async () => {
    setConfigStatus(prev => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      setConfigStatus({ kind: 'ready', state: await loadConfigState() });
    } catch {
      setConfigStatus({ kind: 'error', message: '读取本机配置失败，请重试。', code: 'UNKNOWN_ERROR' });
    }
  }, []);

  useEffect(() => {
    void reloadConfig();
  }, [reloadConfig]);

  const changeActive = useCallback((id: string) => {
    if (isGeneratingRef.current) return;
    const msgs = loadSession(window.localStorage, id);
    setMessages(normalizeMessages(msgs));
    setSessionId(id);
    setActiveId(id);
    const created = readCreatedAtId(id);
    createdAtRef.current = created;
  }, []);

  const startNew = useCallback(() => {
    if (isGeneratingRef.current) return;
    setMessages([]);
    setSessionId(null);
    setActiveId(null);
    createdAtRef.current = null;
  }, []);

  const removeSession = useCallback((id: string) => {
    deleteSession(window.localStorage, id);
    refreshSessions();
    if (id === activeIdRef.current) {
      setMessages([]);
      setSessionId(null);
      setActiveId(null);
    }
  }, [refreshSessions]);

  const wipeAll = useCallback(() => {
    clearSessions(window.localStorage);
    setMessages([]);
    setSessionId(null);
    setActiveId(null);
    refreshSessions();
  }, [refreshSessions]);

  const streamIdRef = useRef<string | null>(null);
  const streamEndedRef = useRef(false);

  const stop = useCallback(() => {
    const id = streamIdRef.current;
    if (!id) return;
    void window.desktop?.chat?.cancel({ id });
    setMessages(prev => prev.map((m, idx) => {
      if (idx !== prev.length - 1 || m.role !== 'assistant' || m.status !== 'streaming') return m;
      const r = finalizeMessage(m, { ended: streamEndedRef.current, errorCode: undefined }, true);
      messagesRef.current = prev.map((mm, i) => (i === idx ? r.message : mm));
      return r.message;
    }));
    streamIdRef.current = null;
    setIsGenerating(false);
  }, []);

  const send = useCallback((text: string, attachments: AttachmentLike[]) => {
    if (!currentEntry || isGeneratingRef.current) return;
    const user: ChatMessage = {
      id: newId(), role: 'user', content: text, status: 'done',
      ...(attachments.length > 0 ? { attachments: attachments as ChatMessage['attachments'] } : {}),
    };
    const base = [...messagesRef.current, user];
    setMessages(base);
    messagesRef.current = base;
    persist(base);

    const assistant: ChatMessage = {
      id: newId(), role: 'assistant', content: '', status: 'streaming', model: currentEntry.model,
    };
    setMessages([...base, assistant]);
    messagesRef.current = [...base, assistant];
    setIsGenerating(true);

    const request: ChatStartRequest = {
      model: currentEntry.model,
      base_url: currentEntry.base_url,
      messages: toChatMessages(base) as ChatStartRequest['messages'],
      effort: normalizeEffort(currentEntry.model, chatConfigRef.current.effort),
      webSearch: chatConfigRef.current.webSearch,
    } as ChatStartRequest;

    const chat = window.desktop?.chat;
    if (!chat) {
      setIsGenerating(false);
      setMessages(prev => prev.map(m => m.id === assistant.id
        ? { ...m, status: 'error', error: '桌面对话桥接不可用。' } : m));
      return;
    }

    streamEndedRef.current = false;
    void chat.start(request).then(res => {
      if (!res.success) {
        // 只有仍处在该请求对应的生成中时才收尾，避免旧失败覆盖新流状态。
        if (streamIdRef.current !== null || isGeneratingRef.current) {
          setIsGenerating(false);
        }
        setMessages(prev => prev.map(m => m.id === assistant.id
          ? { ...m, status: 'error', error: codeText(res.code) } : m));
        return;
      }
      streamIdRef.current = res.id;
      const unsubscribe = chat.onChunk(chunk => {
        if (chunk.id !== res.id) return;
        setMessages(prev => {
          const idx = prev.findIndex(mm => mm.id === assistant.id);
          if (idx === -1) return prev;
          const { message, ended, errorCode, errorMessage } = reduceChunk(prev[idx]!, chunk);
          const updated = {
            ...message,
            ...(chunk.kind === 'done' || chunk.kind === 'error'
              ? finalizeMessage(message, { ended, errorCode, errorMessage }, false).message
              : {}),
          };
          const next = prev.map((mm, i) => (i === idx ? updated : mm));
          messagesRef.current = next;
          if (chunk.kind === 'done') streamEndedRef.current = true;
          return next;
        });
        if (chunk.kind === 'done' || chunk.kind === 'error') {
          if (chunk.kind === 'done') streamEndedRef.current = true;
          // 仅当当前在途仍是本条流时才复位全局状态，防止旧流迟到的终止 chunk
          // 把新发起流的 streamIdRef / isGenerating 冲空（停止会因此失效）。
          if (streamIdRef.current === res.id) {
            setIsGenerating(false);
            streamIdRef.current = null;
          }
          unsubscribe();
        }
      });
    });
  }, [currentEntry, persist]);

  const regenerate = useCallback((entry: ConfigEntry) => {
    if (isGeneratingRef.current) return;
    const current = messagesRef.current;
    let lastUser = -1;
    for (let i = current.length - 1; i >= 0; i--) {
      if (current[i]!.role === 'user') { lastUser = i; break; }
    }
    if (lastUser === -1) return;
    const lastUserMsg = current[lastUser]!;
    // 切到该条目的模型（仅当本地未持有）后以相同提问重发。
    // 持久化会剥离附件 data；若该用户消息的附件 data 已被剥离，则不给发空请求，
    // 提示需重新上传附件（或用户直接新发一条）。
    const hasRealAttachment = lastUserMsg.attachments?.some(a => a.data !== '') ?? false;
    if (lastUserMsg.content.trim() === '' && !hasRealAttachment) {
      return;
    }
    setChatConfig(prev => prev.model === `${entry.model}:${entry.base_url}`
      ? prev
      : { ...prev, model: `${entry.model}:${entry.base_url}` });
    setMessages(current.slice(0, lastUser + 1));
    messagesRef.current = current.slice(0, lastUser + 1);
    send(lastUserMsg.content, lastUserMsg.attachments ?? []);
  }, [send]);

  const canRegenerate = !isGenerating && messages[messages.length - 1]?.role === 'assistant';

  return (
    <div className="chat-page">
      <SessionsSidebar
        sessions={sessions}
        activeId={activeId}
        locked={isGenerating}
        onNew={startNew}
        onSelect={changeActive}
        onDelete={removeSession}
        onClearAll={wipeAll}
      />
      <div className="chat-main">
        <div className="chat-messages">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <h2>开始对话</h2>
              <p>
                {degraded
                  ? '会话未能持久化到本地存储，仅当前内存保留。'
                  : configStatus.kind === 'loading'
                    ? '正在读取模型配置…'
                    : configStatus.kind === 'error'
                      ? `读取配置失败：${configStatus.message}，请切到「模型切换」页确认。`
                      : entries.length === 0
                        ? '配置列表为空，请先到「模型切换」添加模型。'
                        : '选择模型后发送消息，可携带图片或文本附件。'}
              </p>
            </div>
          ) : (
            messages.map((m, idx) => (
              <MessageItem
                key={m.id}
                message={m}
                canRegenerate={idx === messages.length - 1 && canRegenerate}
                onRegenerate={() => currentEntry && regenerate(currentEntry)}
              />
            ))
          )}
        </div>
        <Composer
          entries={entries}
          model={modelKey}
          effort={chatConfig.effort}
          webSearch={chatConfig.webSearch}
          isGenerating={isGenerating}
          onModelChange={model => setChatConfig(prev => ({ ...prev, model }))}
          onEffortChange={effort => setChatConfig(prev => ({ ...prev, effort }))}
          onWebSearchChange={webSearch => setChatConfig(prev => ({ ...prev, webSearch }))}
          onSend={send}
          onStop={stop}
        />
      </div>
    </div>
  );
}

type AttachmentLike = NonNullable<ChatMessage['attachments']>[number];