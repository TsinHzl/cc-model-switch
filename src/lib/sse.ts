import type { ChatChunk } from './chatIpcContract';

/** 流式解析中可按内容块下标跟踪的状态。 */
export interface SseState {
  /** content_block_start 里记录的 server_tool_use 搜索块 */
  readonly searches: Map<number, { readonly id: string; json: string }>;
  /** 客户端 tool_use 块：不支持服务端搜索的网关用它返回搜索意图。 */
  readonly toolUses: Map<number, { readonly id: string; readonly name: string; json: string }>;
  /** 是否收到 message_stop；没有它说明流被中途干净地关闭了 */
  messageStopped: boolean;
  /** message_delta 的 stop_reason；tool_use 表示本轮到客户端执行工具。 */
  stopReason: string | null;
}

export function createSseState(): SseState {
  return {
    searches: new Map(), toolUses: new Map(), messageStopped: false, stopReason: null,
  };
}

/** 一帧 SSE 的 data 负载解析结果，按出现顺序回放。 */
export type SseEvent =
  | { readonly kind: 'thinking'; readonly delta: string }
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'usage'; readonly input?: number; readonly output?: number; readonly cached?: number }
  | { readonly kind: 'search_call'; readonly searchId: string; readonly query: string }
  | {
    readonly kind: 'search_result'; readonly searchId: string;
    readonly results: readonly { title: string; url: string; snippet: string }[];
    readonly failed: boolean;
  }
  | { readonly kind: 'error'; readonly message: string };

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Anthropic 的 input_tokens 只含未命中缓存的部分，输入总量要加回缓存读写。
function toUsage(usage: unknown, withOutput: boolean) {
  const record = (usage ?? {}) as Record<string, unknown>;
  const fresh = num(record.input_tokens);
  const cached = num(record.cache_read_input_tokens);
  const created = num(record.cache_creation_input_tokens);
  return {
    input: fresh === undefined ? undefined : fresh + (cached ?? 0) + (created ?? 0),
    cached,
    output: withOutput ? num(record.output_tokens) : undefined,
  };
}

function toSearchResults(content: unknown) {
  if (!Array.isArray(content)) return [];
  return content.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    if (typeof record.url !== 'string') return [];
    return [{
      url: record.url,
      title: typeof record.title === 'string' && record.title !== '' ? record.title : record.url,
      snippet: typeof record.encrypted_content === 'string' ? record.encrypted_content : '',
    }];
  });
}

function parseQuery(json: string): string {
  try {
    const query = (JSON.parse(json) as { query?: unknown }).query;
    return typeof query === 'string' ? query : '';
  } catch {
    return '';
  }
}

/** 客户端工具调用：入参由 input_json_delta 拼接，解析失败时为 null。 */
export interface ClientToolUse {
  readonly id: string;
  readonly name: string;
  readonly input: Record<string, unknown> | null;
}

function parseObject(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** 本轮流结束后可供回填 tool_result 的客户端工具调用，按块下标顺序。 */
export function clientToolUses(state: SseState): ClientToolUse[] {
  return [...state.toolUses.values()].map(tool => ({
    id: tool.id, name: tool.name, input: parseObject(tool.json),
  }));
}

/** 从工具入参里取搜索词：各网关字段名不一致（query / PARAMETER_NAME）。 */
export function toolQuery(input: Record<string, unknown> | null): string {
  if (!input) return '';
  for (const key of ['query', 'q', 'PARAMETER_NAME']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return '';
}

/** 分派单个 SSE data 负载；搜索结果按内容块下标在 state 中跨帧累积。 */
export function dispatchSseData(data: string, state: SseState): SseEvent[] {
  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object') return [];
    event = parsed as Record<string, unknown>;
  } catch {
    return [];
  }
  const block = event.content_block as Record<string, unknown> | undefined;
  switch (event.type) {
    case 'message_start': {
      const message = event.message as Record<string, unknown> | undefined;
      return [{ kind: 'usage', ...toUsage(message?.usage, false) }];
    }
    case 'content_block_start': {
      if (block?.type === 'server_tool_use' && block.name === 'web_search'
          && typeof block.id === 'string' && typeof event.index === 'number') {
        state.searches.set(event.index, { id: block.id, json: '' });
      } else if (block?.type === 'tool_use' && typeof block.id === 'string'
          && typeof block.name === 'string' && typeof event.index === 'number') {
        // 不支持服务端搜索的网关把搜索意图作为普通工具调用返回，本轮不会有正文。
        state.toolUses.set(event.index, { id: block.id, name: block.name, json: '' });
      } else if (block?.type === 'web_search_tool_result'
          && typeof block.tool_use_id === 'string') {
        return [{
          kind: 'search_result',
          searchId: block.tool_use_id,
          results: toSearchResults(block.content),
          failed: !Array.isArray(block.content),
        }];
      }
      return [];
    }
    case 'content_block_delta': {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        return [{ kind: 'thinking', delta: delta.thinking }];
      }
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ kind: 'text', delta: delta.text }];
      }
      if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string'
          && typeof event.index === 'number') {
        const tool = state.toolUses.get(event.index);
        if (tool) {
          tool.json += delta.partial_json;
          return [];
        }
        const search = state.searches.get(event.index);
        if (search) search.json += delta.partial_json;
      }
      return [];
    }
    case 'content_block_stop': {
      if (typeof event.index !== 'number') return [];
      const search = state.searches.get(event.index);
      if (!search) return [];
      state.searches.delete(event.index);
      return [{ kind: 'search_call', searchId: search.id, query: parseQuery(search.json) }];
    }
    case 'message_delta': {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (typeof delta?.stop_reason === 'string') state.stopReason = delta.stop_reason;
      return [{ kind: 'usage', ...toUsage(event.usage, true) }];
    }
    case 'message_stop':
      state.messageStopped = true;
      return [];
    case 'error': {
      const error = event.error as Record<string, unknown> | undefined;
      return [{
        kind: 'error',
        message: typeof error?.message === 'string' ? error.message : 'Upstream stream error',
      }];
    }
    default:
      return [];
  }
}

function frameData(frame: string): string {
  return frame
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
}

/**
 * 增量 SSE 分帧器：喂入任意切分的文本块，返回已完整的事件。
 * 只处理 `data:` 行；注释、event: 与 id: 行忽略。搜索块状态跨帧保存在 state 中。
 */
export function createSseDecoder(state: SseState = createSseState()) {
  let buffer = '';
  return {
    state,
    push(chunk: string): SseEvent[] {
      buffer = (buffer + chunk).replace(/\r\n/g, '\n');
      const events: SseEvent[] = [];
      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const data = frameData(buffer.slice(0, separator));
        if (data !== '') events.push(...dispatchSseData(data, state));
        buffer = buffer.slice(separator + 2);
        separator = buffer.indexOf('\n\n');
      }
      return events;
    },
    /** 结束输入；返回剩余帧（若上游未以空行收尾）。 */
    end(): SseEvent[] {
      const rest = buffer;
      buffer = '';
      const data = frameData(rest);
      return data === '' ? [] : dispatchSseData(data, state);
    },
  };
}

export type SseDecoder = ReturnType<typeof createSseDecoder>;

/** 把纯事件转换为带请求 id 的渲染进程事件。 */
export function toChunks(id: string, events: readonly SseEvent[]): ChatChunk[] {
  return events.map(event => {
    switch (event.kind) {
      case 'thinking': return { id, kind: 'thinking' as const, delta: event.delta };
      case 'text': return { id, kind: 'text' as const, delta: event.delta };
      case 'usage': return {
        id, kind: 'usage' as const, input: event.input, output: event.output, cached: event.cached,
      };
      case 'search_call': return {
        id, kind: 'search_call' as const, searchId: event.searchId, query: event.query,
      };
      case 'search_result': return {
        id, kind: 'search_result' as const, searchId: event.searchId,
        results: [...event.results], failed: event.failed,
      };
      case 'error': return { id, kind: 'error' as const, code: 'UPSTREAM_ERROR' as const, message: event.message };
    }
  });
}
