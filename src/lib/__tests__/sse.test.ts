import { describe, expect, it } from 'vitest';
import { createSseDecoder, createSseState, dispatchSseData, toChunks } from '../sse';

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;

describe('SSE 分帧', () => {
  it('跨 chunk 切分仍能还原完整帧', () => {
    const decoder = createSseDecoder();
    const text = frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } });
    const half = Math.floor(text.length / 2);
    expect(decoder.push(text.slice(0, half))).toEqual([]);
    expect(decoder.push(text.slice(half))).toEqual([{ kind: 'text', delta: '你好' }]);
  });

  it('归一化 CRLF 分帧', () => {
    const decoder = createSseDecoder();
    const text = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}\r\n\r\n';
    expect(decoder.push(text)).toEqual([{ kind: 'text', delta: 'a' }]);
  });

  it('末尾无空行时由 end() 补一帧', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"z"}}'))
      .toEqual([]);
    expect(decoder.end()).toEqual([{ kind: 'text', delta: 'z' }]);
  });

  it('忽略注释、event: 与非法 JSON', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(': ping\n\nevent: x\ndata: not-json\n\n')).toEqual([]);
  });

  it('缺失 message_stop 可由 state 判定', () => {
    const state = createSseState();
    const decoder = createSseDecoder(state);
    decoder.push(frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'a' } }));
    expect(state.messageStopped).toBe(false);
    decoder.push(frame({ type: 'message_stop' }));
    expect(state.messageStopped).toBe(true);
  });

  it('多帧按出现顺序回放', () => {
    const decoder = createSseDecoder();
    const events = decoder.push(
      frame({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想' } })
      + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '答' } }),
    );
    expect(events).toEqual([{ kind: 'thinking', delta: '想' }, { kind: 'text', delta: '答' }]);
  });
});

describe('SSE 事件分派', () => {
  it('用量把缓存读写加回输入总量', () => {
    const events = dispatchSseData(JSON.stringify({
      type: 'message_start',
      message: { usage: { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 } },
    }), createSseState());
    expect(events).toEqual([{ kind: 'usage', input: 17, cached: 5, output: undefined }]);
  });

  it('message_delta 带输出用量', () => {
    const events = dispatchSseData(
      JSON.stringify({ type: 'message_delta', usage: { output_tokens: 42 } }), createSseState(),
    );
    expect(events).toEqual([{ kind: 'usage', input: undefined, cached: undefined, output: 42 }]);
  });

  it('跨帧累积搜索查询词', () => {
    const state = createSseState();
    expect(dispatchSseData(JSON.stringify({
      type: 'content_block_start', index: 1,
      content_block: { type: 'server_tool_use', name: 'web_search', id: 's1' },
    }), state)).toEqual([]);
    expect(dispatchSseData(JSON.stringify({
      type: 'content_block_delta', index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"query":"天气' },
    }), state)).toEqual([]);
    expect(dispatchSseData(JSON.stringify({
      type: 'content_block_delta', index: 1,
      delta: { type: 'input_json_delta', partial_json: '"}' },
    }), state)).toEqual([]);
    expect(dispatchSseData(JSON.stringify({ type: 'content_block_stop', index: 1 }), state))
      .toEqual([{ kind: 'search_call', searchId: 's1', query: '天气' }]);
  });

  it('搜索结果成功与失败两种形态', () => {
    const ok = dispatchSseData(JSON.stringify({
      type: 'content_block_start',
      content_block: {
        type: 'web_search_tool_result', tool_use_id: 's1',
        content: [{ url: 'https://a.test', title: 'A', encrypted_content: '摘要' }],
      },
    }), createSseState());
    expect(ok).toEqual([{
      kind: 'search_result', searchId: 's1', failed: false,
      results: [{ url: 'https://a.test', title: 'A', snippet: '摘要' }],
    }]);

    const failed = dispatchSseData(JSON.stringify({
      type: 'content_block_start',
      content_block: {
        type: 'web_search_tool_result', tool_use_id: 's2',
        content: { type: 'web_search_tool_result_error' },
      },
    }), createSseState());
    expect(failed).toEqual([{ kind: 'search_result', searchId: 's2', results: [], failed: true }]);
  });

  it('上游 error 事件转成错误事件', () => {
    expect(dispatchSseData(JSON.stringify({ type: 'error', error: { message: 'boom' } }), createSseState()))
      .toEqual([{ kind: 'error', message: 'boom' }]);
  });

  it('忽略未知事件与畸形负载', () => {
    const state = createSseState();
    expect(dispatchSseData('{}', state)).toEqual([]);
    expect(dispatchSseData('null', state)).toEqual([]);
    expect(dispatchSseData(JSON.stringify({ type: 'ping' }), state)).toEqual([]);
  });
});

describe('事件转请求 id', () => {
  it('给每个事件附上请求 id', () => {
    expect(toChunks('req-1', [{ kind: 'text', delta: 'a' }]))
      .toEqual([{ id: 'req-1', kind: 'text', delta: 'a' }]);
    expect(toChunks('req-1', [{ kind: 'error', message: 'x' }]))
      .toEqual([{ id: 'req-1', kind: 'error', code: 'UPSTREAM_ERROR', message: 'x' }]);
  });
});
