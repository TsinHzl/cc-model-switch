/* 对话共享类型：消息 / 会话 / 参数。与 chatIpcContract 的传输类型独立，本页文件供 UI 与本地存储共用。 */
import type { ChatEffort } from './chatIpcContract';

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'error';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchCall {
  id: string;
  query: string;
  status: 'searching' | 'done' | 'error' | 'stopped';
  results: WebSearchResult[];
}

export interface Attachment {
  id: string;
  kind: 'image' | 'text';
  name: string;
  mediaType: string;
  /** 原文件字节数，仅用于展示 */
  size: number;
  data: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  reasoning?: string;
  reasoningMs?: number;
  searches?: WebSearchCall[];
  status: MessageStatus;
  error?: string;
  model?: string;
  usage?: { input: number; output: number; cached?: number };
}

/** 本地保存时会话级选择：模型 + 思考力度 + 联网搜索。不含密钥。 */
export interface ChatConfig {
  model: string;
  effort: ChatEffort;
  webSearch: boolean;
}