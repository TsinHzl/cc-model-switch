/* localStorage 会话存储：索引 + 单会话消息 + 活动会话。超限降级为内存并返回标记；保存时剥离附件 data。 */
import type { ChatConfig, ChatMessage } from './chatTypes';

const PREFIX = 'ccms.chat.v1.';
const sessionsKey = `${PREFIX}sessions`;
const configKey = `${PREFIX}config`;
const activeKey = `${PREFIX}active`;

export interface SessionMeta {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 会话使用的模型（`model:base_url`）。旧版本地会话无此字段时为 undefined。 */
  model?: string;
  messages: ChatMessage[];
}

export interface ListSessionsResult {
  /** 本地存储不可用（隐私模式 / 已禁用）时为 true；未设置任何会话不算降级。 */
  degraded: boolean;
  sessions: SessionMeta[];
}

export interface SaveSessionResult {
  /** 本次是否降级为内存态（会话未被持久化）。 */
  degraded: boolean;
  id: string;
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = { model: '', effort: 'off', webSearch: true };

/** 附件只保留展示占位的元数据，正文 data 不落盘。 */
function stripAttachments(message: ChatMessage): ChatMessage {
  if (!message.attachments) return message;
  return { ...message, attachments: message.attachments.map(a => ({ ...a, data: '' })) };
}

function stripMessage(message: ChatMessage): ChatMessage {
  return stripAttachments(message);
}

interface CountedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 读取会话索引。getItem 抛异常视为存储不可用（降级）；返回 null 或非法 JSON 视为无会话。
 * 结果按最近更新降序：旧数据按写入顺序追加在尾部，不能依赖存储顺序。
 */
export function listSessions(storage: CountedStorage): ListSessionsResult {
  let raw: string | null = null;
  let degraded = false;
  try {
    raw = storage.getItem(sessionsKey);
  } catch {
    degraded = true;
  }
  if (degraded) return { degraded: true, sessions: [] };
  if (raw === null) return { degraded: false, sessions: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { degraded: false, sessions: [] };
    const sessions = (parsed as SessionMeta[])
      .filter(s => s && typeof s === 'object')
      // 稳定排序：Array.prototype.sort 在 ES2019+ 保证稳定，同一 updatedAt 保持原序。
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    return { degraded: false, sessions };
  } catch {
    return { degraded: false, sessions: [] };
  }
}

function saveIndex(storage: CountedStorage, sessions: SessionMeta[]): boolean {
  try {
    storage.setItem(sessionsKey, JSON.stringify(sessions));
    return true;
  } catch {
    return false;
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface SaveSessionInput {
  id: string | null;
  title: string;
  createdAt: number;
  model: string;
  messages: ChatMessage[];
}

/**
 * 新建或覆盖一个会话。索引与消息任一步落盘失败都标记降级（会话仍在内存可用）。
 */
export function saveSession(storage: CountedStorage, input: SaveSessionInput): SaveSessionResult {
  const { sessions } = listSessions(storage);
  const id = input.id ?? newId();
  const now = Date.now();
  const meta: SessionMeta = {
    id,
    title: input.title,
    updatedAt: now,
    messageCount: input.messages.length,
  };
  const next = sessions.some(s => s.id === id)
    ? sessions.map(s => (s.id === id ? meta : s))
    : [...sessions, meta];
  const indexOk = saveIndex(storage, next);
  const content: ChatSession = {
    id,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: now,
    model: input.model,
    messages: input.messages.map(stripMessage),
  };
  let contentOk = false;
  try {
    storage.setItem(`${PREFIX}session:${id}`, JSON.stringify(content));
    contentOk = true;
  } catch {
    contentOk = false;
  }
  return { degraded: !indexOk || !contentOk, id };
}

/** 读取单会话消息；损坏 / 缺失返回空列表。 */
export function loadSession(storage: CountedStorage, id: string): ChatMessage[] {
  let raw: string | null = null;
  try {
    raw = storage.getItem(`${PREFIX}session:${id}`);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const messages = (parsed as { messages?: unknown }).messages;
    return Array.isArray(messages) ? (messages as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

/** 读取某个会话的模型（`model:base_url`）；缺失 / 损坏返回 null。 */
export function loadSessionModel(storage: CountedStorage, id: string): string | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(`${PREFIX}session:${id}`);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const model = (parsed as { model?: unknown }).model;
    return typeof model === 'string' && model !== '' ? model : null;
  } catch {
    return null;
  }
}

export function deleteSession(storage: CountedStorage, id: string): void {
  const { sessions } = listSessions(storage);
  saveIndex(
    storage,
    sessions.filter(s => s.id !== id),
  );
  try {
    storage.removeItem(`${PREFIX}session:${id}`);
    const active = loadActiveId(storage);
    if (active === id) saveActiveId(storage, null);
  } catch {
    // 尽力而为：索引已更新
  }
}

export function clearSessions(storage: CountedStorage): void {
  const { sessions } = listSessions(storage);
  try {
    storage.removeItem(sessionsKey);
    for (const s of sessions) storage.removeItem(`${PREFIX}session:${s.id}`);
    storage.removeItem(activeKey);
  } catch {
    // 尽力而为
  }
}

export function loadChatConfig(storage: CountedStorage): ChatConfig {
  let raw: string | null = null;
  try {
    raw = storage.getItem(configKey);
  } catch {
    return DEFAULT_CHAT_CONFIG;
  }
  if (raw === null) return DEFAULT_CHAT_CONFIG;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CHAT_CONFIG;
    const config = parsed as Partial<ChatConfig>;
    return {
      model: typeof config.model === 'string' ? config.model : '',
      effort: typeof config.effort === 'string' ? (config.effort as ChatConfig['effort']) : 'off',
      webSearch: typeof config.webSearch === 'boolean' ? config.webSearch : true,
    };
  } catch {
    return DEFAULT_CHAT_CONFIG;
  }
}

export function saveChatConfig(storage: CountedStorage, config: ChatConfig): void {
  try {
    storage.setItem(configKey, JSON.stringify(config));
  } catch {
    // 静默放弃：本地持久化仅是便利
  }
}

export function loadActiveId(storage: CountedStorage): string | null {
  try {
    return storage.getItem(activeKey);
  } catch {
    return null;
  }
}

export function saveActiveId(storage: CountedStorage, id: string | null): void {
  try {
    if (id === null) storage.removeItem(activeKey);
    else storage.setItem(activeKey, id);
  } catch {
    // 静默放弃
  }
}