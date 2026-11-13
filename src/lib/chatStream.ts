/* 把 desktop.chat 的流式事件转成消息状态更新；含取消、收尾与不完整标记。 */
import type { ChatChunk } from './chatIpcContract';
import type { ChatMessage, WebSearchCall } from './chatTypes';

export const STREAM_TRUNCATED_MESSAGE = '回复流意外结束，内容可能不完整；请重试。';

/** 上游把工具调用文本混进正文时的特征（作用于完整正文）：
 * 1) 一行内含 `mcp__工具…` 与 `→ Run`（工具入参 JSON 序列化）；
 * 2) 独立的 `mcp__工具{入参}` 块。
 * 仅用于渲染层展示过滤，不触碰存储数据；对正常正文是幂等的。 */
const TOOL_LEAK =
  /[^\n]*mcp__[\w-]+[^\n]*→\s*Run\s*→?[^\n]*|mcp__[\w-]+\s*\{[^{}]*\}/g;

function cleanupText(text: string): string {
  return text.trim();
}

/** 流式阶段只去工具泄漏片段，保留换行：此处若 trim 会吃掉尾部 `\n`，
 * 下一块 delta 便粘在同一行，表格 / 列表 / 标题因此失去 Markdown 结构。 */
function stripToolLeakIncremental(text: string): string {
  return text.replace(TOOL_LEAK, '');
}

/** 整段文本到齐后收敛首尾空白。不压缩行内空格、不动行首缩进，
 * 否则会破坏代码块与嵌套列表排版。 */
export function stripToolLeak(text: string): string {
  return cleanupText(stripToolLeakIncremental(text));
}

/** 仍为 searching 的搜索在流结束后改记为已中断。 */
export function settleSearches(message: ChatMessage): ChatMessage {
  if (!message.searches?.some(s => s.status === 'searching')) return message;
  return {
    ...message,
    searches: message.searches.map(s =>
      s.status === 'searching' ? { ...s, status: 'stopped' as const } : s),
  };
}

export interface StreamOutcome {
  /** 已收到 done 或错误类 chunk，流已在主进程侧结束。 */
  ended: boolean;
  /** 主进程报告的终止码：ABORTED=用户停止；其余错误。 */
  errorCode?: 'ABORTED' | 'UPSTREAM_ERROR' | 'NETWORK_ERROR' | 'TLS_ERROR' | 'IO_FAILED';
  message?: string;
}

/** 单个 chunk 归约结果：新的消息内容 + 是否结束。 */
export interface ReduceResult {
  message: ChatMessage;
  ended: boolean;
  errorCode?: StreamOutcome['errorCode'];
  errorMessage?: string;
}

/**
 * 按单个 assistant 消息累积流式增量。接受过滤后的同 id chunk，
 * 返回更新后的消息与是否结束；错误 chunk 视为结束。
 */
export function reduceChunk(message: ChatMessage, chunk: ChatChunk): ReduceResult {
  switch (chunk.kind) {
    case 'thinking':
      return { message: { ...message, reasoning: (message.reasoning ?? '') + chunk.delta }, ended: false };
    case 'text': {
      // 流式阶段不做 trim：保留块尾换行，后续 delta 才能落到新行。
      const clean = stripToolLeakIncremental((message.content ?? '') + chunk.delta);
      return { message: { ...message, content: clean }, ended: false };
    }
    case 'usage':
      return {
        message: {
          ...message,
          usage: {
            input: chunk.input ?? message.usage?.input ?? 0,
            output: chunk.output ?? message.usage?.output ?? 0,
            cached: chunk.cached ?? message.usage?.cached,
          },
        },
        ended: false,
      };
    case 'search_call': {
      const call: WebSearchCall = { id: chunk.searchId, query: chunk.query, status: 'searching', results: [] };
      // 同一 searchId 只保留一条，避免截图所示同类搜索块堆叠。
      const exists = (message.searches ?? []).some(s => s.id === chunk.searchId);
      if (exists) return { message, ended: false };
      return { message: { ...message, searches: [...(message.searches ?? []), call] }, ended: false };
    }
    case 'search_result':
      return {
        message: {
          ...message,
          searches: (message.searches ?? []).map(s =>
            s.id === chunk.searchId
              ? { ...s, status: chunk.failed ? ('error' as const) : ('done' as const), results: chunk.results }
              : s),
        },
        ended: false,
      };
    case 'done':
      return { message, ended: true };
    case 'error':
      return {
        message,
        ended: true,
        errorCode: isStreamErrorCode(chunk.code) ? chunk.code : undefined,
        errorMessage: chunk.message,
      };
  }
}

function isStreamErrorCode(code: string): code is NonNullable<StreamOutcome['errorCode']> {
  return code === 'ABORTED' || code === 'UPSTREAM_ERROR' || code === 'NETWORK_ERROR'
    || code === 'TLS_ERROR' || code === 'IO_FAILED';
}

export type FinalStatus = 'done' | 'stopped' | 'error';

/**
 * 流结束后把消息改为最终态。
 * @param aborted 是否由用户主动停止（client 已调用 cancel）。
 */
export function finalizeMessage(
  message: ChatMessage,
  result: Pick<ReduceResult, 'ended' | 'errorCode' | 'errorMessage'>,
  aborted: boolean,
): { message: ChatMessage; status: FinalStatus } {
  // 流结束才收敛正文首尾空白与残留空格，避免破坏流式过程中的换行结构。
  const base = settleSearches({ ...message, content: stripToolLeak(message.content) });
  if (aborted || result.errorCode === 'ABORTED') {
    return { message: { ...base, status: 'stopped' }, status: 'stopped' };
  }
  if (result.errorCode) {
    return {
      message: {
        ...base,
        status: 'error',
        error: result.errorMessage ?? (result.errorCode === 'UPSTREAM_ERROR'
          ? STREAM_TRUNCATED_MESSAGE : '与模型网关的通信失败。'),
      },
      status: 'error',
    };
  }
  if (!result.ended) {
    // 连接被中途干净地关闭，未收到 done 或错误：按截断失败处理
    return { message: { ...base, status: 'error', error: STREAM_TRUNCATED_MESSAGE }, status: 'error' };
  }
  return { message: { ...base, status: 'done' }, status: 'done' };
}