import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import type { IpcMainInvokeEvent } from 'electron';
import {
  chatCancelRequestSchema, chatStartRequestSchema,
  type ChatChunk, type ChatErrorCode, type ChatStartRequest,
} from '../src/lib/chatIpcContract';
import {
  clientToolUses, createSseDecoder, createSseState, toChunks, toolQuery,
  type ClientToolUse, type SseState,
} from '../src/lib/sse';
import { thinkingRequestFields } from '../src/lib/thinking';
import type { FileStore } from '../server/files.js';
import { isTrusted, type GetTrustedWindow } from './ipcSource';

const MAX_OUTPUT_TOKENS = 16384;
const WEB_SEARCH_MAX_USES = 5;
const CHUNK_CHANNEL = 'chat:chunk';
const TRUNCATED_MESSAGE = '回复流意外结束，内容可能不完整；请重试。';
/** 网关不支持服务端搜索时，自动回填的 tool_result 内容。 */
const SEARCH_UNAVAILABLE = '联网搜索在本网关不可用，请基于已有知识直接回答，不要再调用搜索工具。';
/** 网关把搜索当客户端 tool_use 时最多回填的轮数，防止反复触发造成无限请求。 */
const MAX_TOOL_ROUNDS = 2;
const TOOL_UNSUPPORTED_MESSAGE = '该网关不执行联网搜索，且未能生成正文；请关闭联网搜索后重试。';
/** 回填用尽后正文仍停在过渡前言：明确告知不完整，避免被当成完整答复。 */
const INCOMPLETE_MESSAGE = '回复只输出了开头就停止了（网关未执行联网搜索）；请重试或关闭联网搜索。';
const EMPTY_ANSWER_MESSAGE = '模型网关未返回任何正文内容；请重试或更换模型。';

export interface ChatHandlerOptions {
  readonly store: FileStore;
  readonly getTrustedWindow: GetTrustedWindow;
  /** 投递流式事件；窗口销毁时应抛错以终止推送。 */
  readonly send: (chunk: ChatChunk) => void;
  readonly fetchImpl?: typeof fetch;
}

interface ConfigTriple {
  readonly model: string;
  readonly base_url: string;
  readonly key: string;
}

type Failure = { readonly success: false; readonly code: ChatErrorCode };
const failure = (code: ChatErrorCode): Failure => ({ success: false, code });

/** 严格读取请求对象：拒绝 Proxy、访问器与额外字段；超预算单独区分。 */
function readRequest(value: unknown): ChatStartRequest | Failure {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) {
    return failure('INVALID_REQUEST');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return failure('INVALID_REQUEST');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return failure('INVALID_REQUEST');
  }
  const parsed = chatStartRequestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return parsed.error.issues.some(issue => issue.message === 'BODY_TOO_LARGE')
    ? failure('BODY_TOO_LARGE') : failure('INVALID_REQUEST');
}

/** 只读取已存在的条目；不创建、不修改配置文件。 */
async function readEntries(store: FileStore): Promise<ConfigTriple[] | undefined> {
  try {
    const parsed: unknown = JSON.parse(await store.read('config'));
    if (!Array.isArray(parsed)) return undefined;
    return parsed.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (typeof record.model !== 'string' || typeof record.base_url !== 'string'
          || typeof record.key !== 'string') return [];
      return [{ model: record.model, base_url: record.base_url, key: record.key }];
    });
  } catch {
    return undefined;
  }
}

function classifyError(error: unknown): ChatErrorCode {
  const record = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof record?.code === 'string'
    ? record.code
    : typeof record?.cause?.code === 'string' ? record.cause.code : undefined;
  if (record?.name === 'AbortError' || code === 'ABORT_ERR') return 'ABORTED';
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || code === 'CERT_HAS_EXPIRED'
      || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN'
      || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'ERR_INVALID_CERTIFICATE'
      || code === 'EPROTO') return 'TLS_ERROR';
  return 'NETWORK_ERROR';
}

export function createChatHandlers(options: ChatHandlerOptions) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  /** 全局只允许一条在途对话流；忙时拒绝、不排队。 */
  let active: { readonly id: string; readonly controller: AbortController } | null = null;

  function emit(chunk: ChatChunk): boolean {
    try {
      options.send(chunk);
      return true;
    } catch {
      return false;
    }
  }

  async function run(
    id: string, entry: ConfigTriple, request: ChatStartRequest, controller: AbortController,
  ): Promise<void> {
    let answered = false;
    const push = (events: Parameters<typeof toChunks>[1]) => {
      for (const event of events) {
        if (event.kind === 'text' && event.delta.trim() !== '') answered = true;
      }
      for (const chunk of toChunks(id, events)) {
        if (!emit(chunk)) controller.abort();
      }
    };
    let finished = false;
    try {
      const url = new URL(entry.base_url);
      const endpoint = new URL(`${url.pathname.replace(/\/+$/, '')}/v1/messages`, url);
      const baseHeaders: Record<string, string> = {
        'content-type': 'application/json',
        'x-api-key': entry.key,
        'anthropic-version': '2023-06-01',
      };
      // 回填轮明确不再联网，带该头会与「已拒绝搜索」的语义冲突。
      const searchHeaders = request.webSearch
        ? { ...baseHeaders, 'x-web-search-mode': 'model' } : baseHeaders;

      /** 执行单轮请求并回放事件；出错时返回 null（错误事件已推送）。 */
      const requestRound = async (
        body: Record<string, unknown>, headers: Record<string, string>,
      ): Promise<SseState | null> => {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          push([{
            kind: 'error',
            message: detail.trim() === ''
              ? `模型网关返回错误 (HTTP ${response.status})`
              : `${detail.trim().slice(0, 300)} (HTTP ${response.status})`,
          }]);
          return null;
        }
        if (!response.body) {
          push([{ kind: 'error', message: '模型网关返回了空响应。' }]);
          return null;
        }
        const state = createSseState();
        const decoder = createSseDecoder(state);
        const textDecoder = new TextDecoder();
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          push(decoder.push(textDecoder.decode(value, { stream: true })));
        }
        push(decoder.end());
        if (!state.messageStopped) {
          push([{ kind: 'error', message: TRUNCATED_MESSAGE }]);
          return null;
        }
        return state;
      };

      const body: Record<string, unknown> = {
        model: entry.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: true,
        messages: request.messages,
        ...thinkingRequestFields(entry.model, request.effort),
      };
      if (request.webSearch) {
        body.tools = [{
          type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES,
        }];
      }

      // 部分网关不执行服务端搜索，而是把搜索意图作为普通 tool_use 返回并结束本轮，
      // 该轮没有正文；个别网关回填一次后仍重复同一行为。最多回填 MAX_TOOL_ROUNDS 轮，
      // 每轮都不带 tools / thinking，让模型改用已有知识作答。
      let messages: unknown[] = [...request.messages];
      let sawToolUse = false;
      /** 回填上限用尽时本轮仍停在 tool_use：正文只可能是过渡前言，必须按失败收尾。 */
      let stalled = false;
      let state = await requestRound(body, searchHeaders);
      for (let round = 0; state; round += 1) {
        // 只回填搜索工具：其它客户端工具不属于本功能的处理范围，否则会给出错误的工具结果。
        const toolUses: ClientToolUse[] = clientToolUses(state)
          .filter(tool => tool.name.includes('web_search'));
        if (toolUses.length > 0) sawToolUse = true;
        // stop_reason=tool_use 表示本轮尚未答完（在等工具结果）。此时即使已经输出过
        // 过渡性前言（"让我先搜索一下…"），也必须有后续正文，否则回复会停在半句。
        const blocked = request.webSearch && state.stopReason === 'tool_use'
          && toolUses.length > 0;
        if (!blocked) break;
        // 已产出正文但本轮未答完时同样要回填；只有回填次数用尽才按失败收尾。
        if (round >= MAX_TOOL_ROUNDS) {
          stalled = true;
          break;
        }
        for (const tool of toolUses) {
          push([
            { kind: 'search_call', searchId: tool.id, query: toolQuery(tool.input) },
            { kind: 'search_result', searchId: tool.id, results: [], failed: true },
          ]);
        }
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: toolUses.map(tool => ({
              type: 'tool_use', id: tool.id, name: tool.name, input: tool.input ?? {},
            })),
          },
          {
            role: 'user',
            content: toolUses.map(tool => ({
              type: 'tool_result',
              tool_use_id: tool.id,
              is_error: true,
              content: SEARCH_UNAVAILABLE,
            })),
          },
        ];
        state = await requestRound({
          model: entry.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          stream: true,
          messages,
        }, baseHeaders);
      }
      if (!state) {
        finished = true;
        return;
      }

      // 回填用尽仍停在 tool_use：已收到的只是过渡前言，不能当成完整答复。
      // 正文全为空（例如只剩换行）时给明确提示，避免页面出现一个没有任何内容的回复气泡。
      if (stalled) {
        push([{
          kind: 'error',
          message: answered ? INCOMPLETE_MESSAGE : TOOL_UNSUPPORTED_MESSAGE,
        }]);
        finished = true;
        return;
      }
      if (!answered) {
        push([{
          kind: 'error',
          message: sawToolUse ? TOOL_UNSUPPORTED_MESSAGE : EMPTY_ANSWER_MESSAGE,
        }]);
        finished = true;
        return;
      }
      emit({ id, kind: 'done' });
      finished = true;
    } catch (error) {
      const code = classifyError(error);
      if (code === 'ABORTED') {
        emit({ id, kind: 'error', code: 'ABORTED', message: '对话已中止，已收到的内容已保留。' });
      } else {
        push([{ kind: 'error', message: code === 'TLS_ERROR'
          ? '与模型网关的安全连接失败，请检查证书。' : '无法连接模型网关，请检查网络与地址。' }]);
      }
      finished = true;
    } finally {
      if (active?.id === id) active = null;
      if (!finished) emit({ id, kind: 'error', code: 'IO_FAILED', message: '对话流异常结束。' });
    }
  }

  async function start(
    event: IpcMainInvokeEvent, ...args: unknown[]
  ): Promise<{ success: true; id: string } | Failure> {
    try {
      if (!isTrusted(event, options.getTrustedWindow)) return failure('FORBIDDEN');
      if (args.length !== 1) return failure('INVALID_REQUEST');
      // 快速路径：已占用名额直接拒绝。真正的并发守卫在 readEntries 之后的原子复查处。
      if (active) return failure('RATE_LIMITED');
      const request = readRequest(args[0]);
      if ('success' in request) return request;

      const entries = await readEntries(options.store);
      if (!entries) return failure('IO_FAILED');
      const entry = entries.find(item =>
        item.model === request.model && item.base_url === request.base_url);
      if (!entry) return failure('UNKNOWN_ENTRY');

      let target: URL;
      try {
        target = new URL(entry.base_url);
      } catch {
        return failure('UNSUPPORTED_URL');
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return failure('UNSUPPORTED_URL');
      }

      // readEntries 是异步的，两并发 start 可能在首个 await 前都通过 empty 检查。
      // 在真正占用名额前再同步复查一次：此检查与下面赋值之间无 await，属原子区，
      // 后到的一方会在此被 RATE_LIMITED 拒绝，避免产生不可取消的孤儿流。
      if (active) return failure('RATE_LIMITED');
      const id = randomUUID();
      const controller = new AbortController();
      active = { id, controller };
      void run(id, entry, request, controller);
      return { success: true, id };
    } catch {
      return failure('IO_FAILED');
    }
  }

  async function cancel(
    event: IpcMainInvokeEvent, ...args: unknown[]
  ): Promise<{ readonly success: true } | Failure> {
    try {
      if (!isTrusted(event, options.getTrustedWindow)) return failure('FORBIDDEN');
      if (args.length !== 1) return failure('INVALID_REQUEST');
      const request = chatCancelRequestSchema.safeParse(args[0]);
      if (!request.success) return failure('INVALID_REQUEST');
      if (active?.id === request.data.id) active.controller.abort();
      return { success: true };
    } catch {
      return failure('IO_FAILED');
    }
  }

  return Object.freeze({
    start,
    cancel,
    /** 中止在途请求并释放名额；用于窗口关闭与应用退出。 */
    dispose(): void {
      active?.controller.abort();
      active = null;
    },
  });
}

export const chatChunkChannel = CHUNK_CHANNEL;
