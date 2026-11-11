import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatHandlers } from '../chatIpc';
import { createSource } from '../testing/ipcSource';
import type { ChatChunk } from '../../src/lib/chatIpcContract';
import type { FileStore } from '../../server/files.js';

const ENTRY = {
  model: 'claude-sonnet-5', base_url: 'https://gateway.test', key: 'sk-fixture-secret',
  channel: '',
};

function storeWith(entries: unknown): FileStore {
  return {
    read: vi.fn(async () => JSON.stringify(entries)),
    update: vi.fn(async () => { throw new Error('不应写入'); }),
  } as unknown as FileStore;
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    model: ENTRY.model,
    base_url: ENTRY.base_url,
    messages: [{ role: 'user', content: '你好' }],
    effort: 'off',
    webSearch: false,
    ...overrides,
  };
}

/** 构造一个可控的 SSE 响应体。 */
function sseResponse(
  chunks: string[], { status = 200, stopped = true } = {},
): Response {
  const encoder = new TextEncoder();
  const payload = [
    ...chunks,
    ...(stopped ? ['data: {"type":"message_stop"}\n\n'] : []),
  ];
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= payload.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(payload[index]!));
      index++;
    },
  });
  return new Response(stream, { status });
}

function textFrames(text: string): string[] {
  return [`data: ${JSON.stringify({
    type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text },
  })}\n\n`];
}

describe('对话 handler 边界', () => {
  let source: ReturnType<typeof createSource>;
  let sent: ChatChunk[];
  let fetchMock: ReturnType<typeof vi.fn>;

  const build = (entries: unknown = [ENTRY]) => createChatHandlers({
    store: storeWith(entries),
    getTrustedWindow: () => source.trusted,
    send: chunk => { sent.push(chunk); },
    fetchImpl: fetchMock as unknown as typeof fetch,
  });

  beforeEach(() => {
    source = createSource();
    sent = [];
    fetchMock = vi.fn(async () => sseResponse(textFrames('hi')));
  });

  afterEach(() => vi.restoreAllMocks());

  it('拒绝非可信来源，不发起网络请求', async () => {
    const handlers = build();
    const stranger = createSource('https://evil.test/');
    expect(await handlers.start(stranger.event, request()))
      .toEqual({ success: false, code: 'FORBIDDEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('拒绝额外字段与携带密钥的请求', async () => {
    const handlers = build();
    expect(await handlers.start(source.event, request({ key: 'sk-secret' })))
      .toEqual({ success: false, code: 'INVALID_REQUEST' });
    expect(await handlers.start(source.event, request({ headers: { a: 'b' } })))
      .toEqual({ success: false, code: 'INVALID_REQUEST' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('拒绝参数个数不为 1', async () => {
    const handlers = build();
    expect(await handlers.start(source.event)).toEqual({ success: false, code: 'INVALID_REQUEST' });
    expect(await handlers.start(source.event, request(), request()))
      .toEqual({ success: false, code: 'INVALID_REQUEST' });
  });

  it('拒绝超预算请求', async () => {
    const handlers = build();
    const huge = request({
      messages: [{ role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }],
    });
    expect(await handlers.start(source.event, huge))
      .toEqual({ success: false, code: 'BODY_TOO_LARGE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('拒绝不在配置中的 model + base_url 组合', async () => {
    const handlers = build();
    expect(await handlers.start(source.event, request({ model: 'unknown-model' })))
      .toEqual({ success: false, code: 'UNKNOWN_ENTRY' });
    expect(await handlers.start(source.event, request({ base_url: 'https://other.test' })))
      .toEqual({ success: false, code: 'UNKNOWN_ENTRY' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('拒绝非 http(s) 的条目地址', async () => {
    const handlers = build([{ ...ENTRY, base_url: 'file:///etc/passwd' }]);
    expect(await handlers.start(source.event, request({ base_url: 'file:///etc/passwd' })))
      .toEqual({ success: false, code: 'INVALID_REQUEST' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('配置不可读时返回 IO_FAILED', async () => {
    const store = {
      read: vi.fn(async () => '{ broken'),
      update: vi.fn(),
    } as unknown as FileStore;
    const handlers = createChatHandlers({
      store, getTrustedWindow: () => source.trusted, send: () => {},
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    expect(await handlers.start(source.event, request()))
      .toEqual({ success: false, code: 'IO_FAILED' });
  });

  it('合法请求按条目的 base_url 与密钥发起，且事件中不含密钥', async () => {
    const handlers = build();
    const result = await handlers.start(source.event, request());
    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(sent.some(chunk => chunk.kind === 'done')).toBe(true));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [URL, RequestInit];
    expect(String(url)).toBe('https://gateway.test/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(ENTRY.key);
    expect(init.redirect).toBe('error');

    const serialized = JSON.stringify(sent);
    expect(serialized).not.toContain(ENTRY.key);
    expect(serialized).not.toContain('sk-fixture-secret');
  });

  it('流式文本按序推送并以 done 收尾', async () => {
    const handlers = build();
    const result = await handlers.start(source.event, request());
    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(sent.at(-1)?.kind).toBe('done'));
    const texts = sent.filter(chunk => chunk.kind === 'text')
      .map(chunk => (chunk as { delta: string }).delta);
    expect(texts.join('')).toBe('hi');
  });

  it('缺少 message_stop 时报告截断', async () => {
    fetchMock.mockResolvedValue(sseResponse(textFrames('partial'), { stopped: false }));
    const handlers = build();
    await handlers.start(source.event, request());
    await vi.waitFor(() => expect(sent.some(chunk => chunk.kind === 'error')).toBe(true));
    const error = sent.find(chunk => chunk.kind === 'error') as { message: string };
    expect(error.message).toContain('可能不完整');
  });

  it('上游非 2xx 转成错误事件，不抛异常', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    const handlers = build();
    await handlers.start(source.event, request());
    await vi.waitFor(() => expect(sent.some(chunk => chunk.kind === 'error')).toBe(true));
    const error = sent.find(chunk => chunk.kind === 'error') as { message: string };
    expect(error.message).toContain('401');
    expect(error.message).not.toContain(ENTRY.key);
  });

  it('并发请求被拒绝为 RATE_LIMITED', async () => {
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise(resolve => {
      release = () => { resolve(sseResponse(textFrames('slow'))); };
    }));
    const handlers = build();
    expect((await handlers.start(source.event, request())).success).toBe(true);
    expect(await handlers.start(source.event, request()))
      .toEqual({ success: false, code: 'RATE_LIMITED' });
    release();
    await vi.waitFor(() => expect(sent.at(-1)?.kind).toBe('done'));
    // 名额释放后可再次发起
    fetchMock.mockResolvedValue(sseResponse(textFrames('again')));
    expect((await handlers.start(source.event, request())).success).toBe(true);
  });

  it('两个并发 start 在同步校验后同时放行名额，也只有一个成功（原子占用）', async () => {
    // store.read 为异步，两并发 start 会在 readEntries 的 await 前都通过初次 empty 检查，
    // 必须由占用名额前的同步复查拒绝掉后到的一方，避免产生孤儿流。
    fetchMock.mockImplementation(() => new Promise(() => {})); // 永不释放，观察名额占用
    const handlers = build();
    const first = handlers.start(source.event, request());
    const second = handlers.start(source.event, request());
    const [a, b] = await Promise.all([first, second]);
    const successes = [a, b].filter(r => r.success === true);
    expect(successes).toHaveLength(1);
    // 后到的一方明确驳回，不进入网络
    const rejected = [a, b].find(r => r.success === false);
    expect(rejected).toEqual({ success: false, code: 'RATE_LIMITED' });
  });

  it('取消后推送 ABORTED 并释放名额', async () => {
    fetchMock.mockImplementation((_url, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }));
    const handlers = build();
    const started = await handlers.start(source.event, request());
    expect(started.success).toBe(true);
    if (!started.success) return;
    expect(await handlers.cancel(source.event, { id: started.id })).toEqual({ success: true });
    await vi.waitFor(() => expect(sent.some(
      chunk => chunk.kind === 'error' && chunk.code === 'ABORTED')).toBe(true));
    expect(sent.at(-1)?.kind).toBe('error');
  });

  it('取消未知 id 不报错也不影响在途请求', async () => {
    const handlers = build();
    expect(await handlers.cancel(source.event, { id: 'not-active' })).toEqual({ success: true });
  });

  it('取消来自不可信来源被拒', async () => {
    const handlers = build();
    const stranger = createSource('https://evil.test/');
    expect(await handlers.cancel(stranger.event, { id: 'x' }))
      .toEqual({ success: false, code: 'FORBIDDEN' });
  });

  it('网络异常转成 NETWORK_ERROR，不含密钥', async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed ${ENTRY.key}`));
    const handlers = build();
    await handlers.start(source.event, request());
    await vi.waitFor(() => expect(sent.some(chunk => chunk.kind === 'error')).toBe(true));
    expect(JSON.stringify(sent)).not.toContain(ENTRY.key);
    expect(sent.some(chunk => chunk.kind === 'error' && chunk.code === 'UPSTREAM_ERROR')).toBe(true);
  });

  it('dispose 中止在途请求', async () => {
    fetchMock.mockImplementation((_url, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }));
    const handlers = build();
    await handlers.start(source.event, request());
    handlers.dispose();
    await vi.waitFor(() => expect(sent.some(
      chunk => chunk.kind === 'error' && chunk.code === 'ABORTED')).toBe(true));
  });

  it('推送因窗口销毁抛错时中止，不抛出到调用方', async () => {
    const handlers = createChatHandlers({
      store: storeWith([ENTRY]),
      getTrustedWindow: () => source.trusted,
      send: () => { throw new Error('window destroyed'); },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await expect(handlers.start(source.event, request())).resolves.toMatchObject({ success: true });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it('联网开关与思考字段进入请求体', async () => {
    const handlers = build();
    await handlers.start(source.event, request({ effort: 'medium', webSearch: true }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0]! as [URL, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual([{
      type: 'web_search_20250305', name: 'web_search', max_uses: 5,
    }]);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'medium' });
    expect((init.headers as Record<string, string>)['x-web-search-mode']).toBe('model');
  });
});
