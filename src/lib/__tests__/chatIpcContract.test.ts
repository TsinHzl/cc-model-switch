import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  CHAT_MAX_REQUEST_BYTES, chatChannels, chatChunkSchema, chatStartRequestSchema,
  chatCancelRequestSchema,
} from '../chatIpcContract';

const base = () => ({
  model: 'claude-sonnet-4-5',
  base_url: 'https://api.example.com',
  messages: [{ role: 'user', content: '你好' }],
  effort: 'off',
  webSearch: false,
});

describe('对话 IPC 通道契约', () => {
  it('固定三通道名称', () => {
    expect(chatChannels).toEqual({
      start: 'chat:start', cancel: 'chat:cancel', chunk: 'chat:chunk',
    });
    expect(CHAT_MAX_REQUEST_BYTES).toBe(8 * 1024 * 1024);
  });

  it('接受合法请求并剥离原对象引用', () => {
    const request = base();
    const parsed = chatStartRequestSchema.parse(request);
    expect(parsed.model).toBe(request.model);
    expect(parsed.messages[0]!.content).toBe('你好');
    expect(parsed).not.toBe(request);
  });

  it('请求不含密钥字段', () => {
    expect(Object.keys(chatStartRequestSchema.shape).sort())
      .toEqual(['base_url', 'effort', 'messages', 'model', 'webSearch']);
  });

  it('拒绝携带 key 或其他额外字段的请求', () => {
    const withKey = { ...base(), key: 'sk-secret' };
    expect(chatStartRequestSchema.safeParse(withKey).success).toBe(false);
    expect(chatStartRequestSchema.safeParse({ ...base(), headers: { a: 'b' } }).success)
      .toBe(false);
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com',
    'https://user:pw@example.com',
    'not a url',
    '',
  ])('拒绝非 http(s) 或无凭据目标 %#', url => {
    expect(chatStartRequestSchema.safeParse({ ...base(), base_url: url }).success).toBe(false);
  });

  it('拒绝超 8 MiB 的紧凑 JSON 请求', () => {
    const big = { ...base(), messages: [{ role: 'user', content: 'x'.repeat(CHAT_MAX_REQUEST_BYTES) }] };
    const result = chatStartRequestSchema.safeParse(big);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.message === 'BODY_TOO_LARGE')).toBe(true);
    }
  });

  it('恰好 8 MiB 以内仍然接受', () => {
    const request = { ...base(), messages: [{ role: 'user', content: 'x' }] };
    expect(Buffer.byteLength(JSON.stringify(request), 'utf8')).toBeLessThan(CHAT_MAX_REQUEST_BYTES);
    expect(chatStartRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each(['off', 'low', 'medium', 'high', 'xhigh', 'max'])('接受档位 %s', effort => {
    expect(chatStartRequestSchema.safeParse({ ...base(), effort }).success).toBe(true);
  });

  it.each(['', 'auto', 'OFF', 1, null])('拒绝非法档位 %#', effort => {
    expect(chatStartRequestSchema.safeParse({ ...base(), effort }).success).toBe(false);
  });

  it.each([
    [{ role: 'system', content: 'x' }],
    [{ role: 'user', content: '' }],
    [{ role: 'user', content: [] }],
    [{ role: 'user', content: [{ type: 'text', text: 'ok', extra: 1 }] }],
    [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/bmp', data: 'AA' } }] }],
    [{ role: 'user', content: 'a\0b' }],
  ])('拒绝非法消息 %#', messages => {
    expect(chatStartRequestSchema.safeParse({ ...base(), messages }).success).toBe(false);
  });

  it('接受图片与文本混合内容块', () => {
    const messages = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==\n' } },
        { type: 'text', text: '看这张图' },
      ],
    }];
    expect(chatStartRequestSchema.safeParse({ ...base(), messages }).success).toBe(true);
  });

  it('取消请求只接受请求 id', () => {
    expect(chatCancelRequestSchema.parse({ id: 'abc' })).toEqual({ id: 'abc' });
    expect(chatCancelRequestSchema.safeParse({ id: 'abc', extra: 1 }).success).toBe(false);
    expect(chatCancelRequestSchema.safeParse({ id: '' }).success).toBe(false);
    expect(chatCancelRequestSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    { id: 'a', kind: 'text', delta: 'hi' },
    { id: 'a', kind: 'thinking', delta: '想' },
    { id: 'a', kind: 'usage', input: 1, output: 2 },
    { id: 'a', kind: 'usage', input: 1, output: 2, cached: 3 },
    { id: 'a', kind: 'search_call', searchId: 's1', query: 'q' },
    { id: 'a', kind: 'search_result', searchId: 's1', results: [], failed: false },
    { id: 'a', kind: 'done' },
    { id: 'a', kind: 'error', code: 'UPSTREAM_ERROR', message: '上游错误' },
  ])('接受流式事件 %#', event => {
    expect(chatChunkSchema.safeParse(event).success).toBe(true);
  });

  it.each([
    { id: 'a', kind: 'unknown' },
    { id: '', kind: 'text', delta: 'x' },
    { id: 'a', kind: 'text' },
    { id: 'a', kind: 'text', delta: 'x', key: 'sk-secret' },
    { kind: 'done' },
    { id: 'a', kind: 'error', code: 'SOMETHING' },
  ])('拒绝非法流式事件 %#', event => {
    expect(chatChunkSchema.safeParse(event).success).toBe(false);
  });
});
