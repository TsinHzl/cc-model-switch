/* chatStream 单元测试：增量拼接、停止、错误、未结束截断。 */
import { describe, expect, it } from 'vitest';
import { finalizeMessage, reduceChunk, settleSearches, stripToolLeak } from '../chatStream';
import type { ChatChunk } from '../chatIpcContract';
import type { ChatMessage } from '../chatTypes';

const id = 'msg-1';
const chunk = (kind: ChatChunk['kind'], extra: Partial<ChatChunk> = {}): ChatChunk =>
  ({ id, kind, ...extra } as ChatChunk);

function drain(chunks: ChatChunk[]) {
  let message: ChatMessage = { id, role: 'assistant', content: '', status: 'streaming' };
  let last: ReturnType<typeof reduceChunk> | undefined;
  for (const c of chunks) {
    const r = reduceChunk(message, c);
    message = r.message;
    if (r.ended) last = r;
  }
  return { message, last };
}

describe('reduceChunk', () => {
  it('叠加思考与正文增量，跨块连续', () => {
    const { message } = drain([
      chunk('thinking', { delta: '反正' }), chunk('thinking', { delta: '要写' }),
      chunk('text', { delta: '你好' }),
    ]);
    expect(message.reasoning).toBe('反正要写');
    expect(message.content).toBe('你好');
    expect(message.status).toBe('streaming');
  });

  it('输出用量并保留缺席字段', () => {
    const { message } = drain([
      chunk('usage', { input: 10, output: 5 }),
      chunk('usage', { output: 7 }),
    ]);
    expect(message.usage).toEqual({ input: 10, output: 7, cached: undefined });
  });

  it('搜索调用累积为 searching，结果到来改为 done', () => {
    const { message } = drain([
      chunk('search_call', { searchId: 's1', query: 'q' }),
      chunk('search_result', { searchId: 's1', results: [{ title: 't', url: 'u', snippet: 's' }], failed: false }),
    ]);
    expect(message.searches).toHaveLength(1);
    expect(message.searches![0]).toMatchObject({ status: 'done', query: 'q' });
  });

  it('同一 searchId 重复的 search_call 只保留一条', () => {
    const r1 = reduceChunk(
      { id, role: 'assistant', content: '', status: 'streaming' },
      chunk('search_call', { searchId: 's1', query: 'q' }),
    ).message;
    const r2 = reduceChunk(r1, chunk('search_call', { searchId: 's1', query: 'q' })).message;
    const r3 = reduceChunk(r2, chunk('search_call', { searchId: 's2', query: 'q2' })).message;
    expect(r3.searches).toHaveLength(2);
    const deduped = r3.searches!.filter(s => s.id === 's1');
    expect(deduped).toHaveLength(1);
  });

  it('流中剥离泄漏进正文的工具调用片段', () => {
    const { message } = drain([
      chunk('text', { delta: 'Fetch Kiwi страница ' }),
      chunk('text', { delta: '{"id":"mcp__kiwi-tools__web_parse","url":"https://kiro.dev"}' }),
      chunk('text', { delta: ' → Run →\n\n结果内容' }),
    ]);
    expect(finalizeMessage(message, { ended: true }, false).message.content).toBe('结果内容');
  });

  it('分块到达的 Markdown 表格保留换行', () => {
    const { message } = drain([
      chunk('text', { delta: '| 模型 | 状态 |\n' }),
      chunk('text', { delta: '| --- | --- |\n' }),
      chunk('text', { delta: '| Opus | ✅ |' }),
    ]);
    const expected = '| 模型 | 状态 |\n| --- | --- |\n| Opus | ✅ |';
    expect(message.content).toBe(expected);
    expect(finalizeMessage(message, { ended: true }, false).message.content).toBe(expected);
  });

  it('分块到达的 Markdown 列表与标题保留换行', () => {
    const { message } = drain([
      chunk('text', { delta: '## 一、Anthropic\n' }),
      chunk('text', { delta: '- Claude Opus5.5\n' }),
      chunk('text', { delta: '- Claude Sonnet5.5\n' }),
    ]);
    expect(message.content).toBe('## 一、Anthropic\n- Claude Opus5.5\n- Claude Sonnet5.5\n');
  });

  it('正文中的正常文本不被工具泄漏过滤误删', () => {
    expect(stripToolLeak('正常 文本 。')).toBe('正常 文本 。');
    expect(stripToolLeak('想看的 mcp 与箭头符号')).toBe('想看的 mcp 与箭头符号');
  });

  it('结束标记在 done 时置位，错误置位并记录', () => {
    expect(drain([chunk('done')]).last?.ended).toBe(true);
    const error = drain([chunk('error', { code: 'UPSTREAM_ERROR', message: 'boom' })]);
    expect(error.last?.errorCode).toBe('UPSTREAM_ERROR');
    expect(error.last?.errorMessage).toBe('boom');
  });
});

describe('finalizeMessage', () => {
  it('正常结束标记为 done', () => {
    const r = finalizeMessage({ id, role: 'assistant', content: '', status: 'streaming' }, { ended: true }, false);
    expect(r.status).toBe('done');
  });

  it('用户停止标记为 stopped 且不报错', () => {
    const base: ChatMessage = { id, role: 'assistant', content: '部分', status: 'streaming' };
    const r = finalizeMessage(base, { ended: false }, true);
    expect(r).toEqual({ message: { ...base, status: 'stopped' }, status: 'stopped' });
    expect(r.message.error).toBeUndefined();
  });

  it('未收到结束事件视为截断，标记 error 且带固定文案', () => {
    const base: ChatMessage = { id, role: 'assistant', content: '半截', status: 'streaming' };
    const r = finalizeMessage(base, { ended: false }, false);
    expect(r.status).toBe('error');
    expect(r.message.error).toBe('回复流意外结束，内容可能不完整；请重试。');
    expect(r.message.content).toBe('半截');
  });

  it('ABORTED 错误码按停止处理', () => {
    const r = finalizeMessage(
      { id, role: 'assistant', content: 'c', status: 'streaming' },
      { ended: true, errorCode: 'ABORTED', errorMessage: '已中止' },
      false,
    );
    expect(r.status).toBe('stopped');
  });

  it('上游错误保留错误消息', () => {
    const r = finalizeMessage(
      { id, role: 'assistant', content: '', status: 'streaming' },
      { ended: true, errorCode: 'UPSTREAM_ERROR', errorMessage: '网关 500' },
      false,
    );
    expect(r.status).toBe('error');
    expect(r.message.error).toBe('网关 500');
  });
});

describe('settleSearches', () => {
  it('把仍 searching 的搜索改记为 stopped', () => {
    const message: ChatMessage = {
      id, role: 'assistant', content: '', status: 'done',
      searches: [
        { id: 's1', query: 'q', status: 'searching', results: [] },
        { id: 's2', query: 'q', status: 'done', results: [] },
      ],
    };
    expect(settleSearches(message).searches).toEqual([
      { id: 's1', query: 'q', status: 'stopped', results: [] },
      { id: 's2', query: 'q', status: 'done', results: [] },
    ]);
  });
});