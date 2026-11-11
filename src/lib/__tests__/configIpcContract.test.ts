import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  configIpcRequestSchemas, configIpcResponseSchemas, writeIdentitySchema,
  type ConfigIpcMethod,
} from '../configIpcContract';

const identity = { model: ' model ', base_url: 'not-a-url', key: 'fixture-key' };
const entry = { ...identity, channel: '' };
const requests = [
  ['state', {}],
  ['apply', { expected: identity }],
  ['add', { entry }],
  ['edit', { index: 0, expected: identity, entry }],
  ['remove', { index: 0, expected: identity }],
] as const;
const state = {
  entries: [entry],
  groups: [{
    url: entry.base_url,
    channels: [{ channel: '', items: [{ entry, index: 0 }] }],
  }],
  activeIndex: 0,
};
const failure = { success: false, code: 'WRITE_UNCERTAIN', cleanupFailed: true };

describe('配置 IPC 请求契约', () => {
  it.each(requests)('接受 %s 正常请求并保留原值', (method, body) => {
    expect(configIpcRequestSchemas[method].parse(body)).toEqual(body);
  });

  it.each(requests)('拒绝 %s 顶层路径覆盖及非对象请求', (method, body) => {
    const schema = configIpcRequestSchemas[method];
    expect(schema.safeParse({ ...body, home: '../outside' }).success).toBe(false);
    for (const value of [null, undefined, [], 0, 'request']) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it('允许历史 expected 原值，但拒绝将其作为新写入身份', () => {
    const expected = { model: '', base_url: '\0legacy', key: '\ud800' };
    expect(configIpcRequestSchemas.apply.parse({ expected })).toEqual({ expected });
    expect(writeIdentitySchema.safeParse(expected).success).toBe(false);
  });

  it.each(['model', 'base_url', 'key'] as const)('校验 %s 类型及新写入边界', field => {
    for (const value of [undefined, null, 42]) {
      const candidate = { ...identity, [field]: value };
      expect(configIpcRequestSchemas.apply.safeParse({ expected: candidate }).success).toBe(false);
      expect(writeIdentitySchema.safeParse(candidate).success).toBe(false);
    }
    for (const value of ['', '   ', ' ', 'a\0b', '\ud800', '\udfff']) {
      expect(writeIdentitySchema.safeParse({ ...identity, [field]: value }).success).toBe(false);
    }
  });

  it('逐码元保持原 UTF-8 往返与控制字符校验语义', () => {
    for (let code = 0; code <= 0xffff; code++) {
      const value = String.fromCharCode(code);
      const legacyAllowed = !/[\x00-\x1f\x7f-\x9f]/.test(value)
        && Buffer.from(value, 'utf8').toString('utf8') === value;
      const actual = configIpcRequestSchemas.add.safeParse({
        entry: { ...entry, channel: value },
      }).success;
      expect(actual, `U+${code.toString(16)}`).toBe(legacyAllowed);
    }
  });

  it.each([
    ['', true],
    ['   ', true],
    ['中文 😀 𐀀 􏿿', true],
    ['\ud800x', false],
    ['x\udfff', false],
    ['\ud800𐀀', false],
    ['\udc00𐀀', false],
  ] as const)('校验组合字符串 %#', (channel, accepted) => {
    expect(configIpcRequestSchemas.add.safeParse({
      entry: { ...entry, channel },
    }).success).toBe(accepted);
  });

  it.each([
    ['apply', {}],
    ['add', {}],
    ['edit', { index: 0, entry }],
    ['remove', { index: 0 }],
    ['apply', { expected: { ...identity, channel: '' } }],
    ['add', { entry: { ...entry, path: '../outside' } }],
    ['edit', { index: 0, expected: { ...identity, home: '../outside' }, entry }],
    ['remove', { index: 0, expected: { ...identity, token: 'fixture-sensitive' } }],
  ] satisfies Array<[ConfigIpcMethod, unknown]>)('拒绝缺失或额外业务字段 %#', (method, body) => {
    expect(configIpcRequestSchemas[method].safeParse(body).success).toBe(false);
  });

  it.each(['edit', 'remove'] as const)('%s 只接受非负安全整数索引', method => {
    const body = method === 'edit' ? { expected: identity, entry } : { expected: identity };
    for (const index of [0, Number.MAX_SAFE_INTEGER]) {
      expect(configIpcRequestSchemas[method].safeParse({ ...body, index }).success).toBe(true);
    }
    for (const index of [-1, 0.5, '0', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      expect(configIpcRequestSchemas[method].safeParse({ ...body, index }).success).toBe(false);
    }
    expect(configIpcRequestSchemas[method].safeParse(body).success).toBe(false);
  });
});

describe('配置 IPC 响应契约', () => {
  it.each(requests)('接受 %s 成功及明确的不确定写入结果', (method) => {
    const response = method === 'state' ? { success: true, data: state } : { success: true };
    expect(configIpcResponseSchemas[method].parse(response)).toEqual(response);
    expect(configIpcResponseSchemas[method].parse(failure)).toEqual(failure);
    expect(configIpcResponseSchemas[method].parse({ ...failure, cleanupFailed: false }))
      .toEqual({ ...failure, cleanupFailed: false });
  });

  it.each(['apply', 'add', 'edit', 'remove'] as const)('%s 写成功不返回状态或错误', method => {
    expect(configIpcResponseSchemas[method].safeParse({ success: true, data: state }).success)
      .toBe(false);
    expect(configIpcResponseSchemas[method].safeParse({ success: true, code: 'IO_FAILED' }).success)
      .toBe(false);
  });

  it('复用状态索引边界，不收紧已有嵌套未知字段处理', () => {
    const schema = configIpcResponseSchemas.state;
    expect(schema.safeParse({ success: true }).success).toBe(false);
    expect(schema.safeParse({ success: true, data: { ...state, activeIndex: 1 } }).success)
      .toBe(false);
    expect(schema.safeParse({
      success: true, data: { entries: [], groups: [], activeIndex: 0 },
    }).success).toBe(false);
    expect(schema.parse({
      success: true, data: { entries: [], groups: [], activeIndex: -1 },
    })).toEqual({ success: true, data: { entries: [], groups: [], activeIndex: -1 } });
    expect(schema.safeParse({
      success: true,
      data: {
        ...state,
        groups: [{ url: '', channels: [{ channel: '', items: [{ entry, index: 1 }] }] }],
      },
    }).success).toBe(false);
    expect(schema.parse({
      success: true,
      data: { ...state, extra: true, entries: [{ ...entry, extra: true }] },
    })).toEqual({ success: true, data: state });
    expect(schema.safeParse({ success: true, data: state, extra: true }).success).toBe(false);
  });

  it.each(requests)('拒绝 %s 错误响应的任意异常正文和字段混合', method => {
    const schema = configIpcResponseSchemas[method];
    for (const field of ['message', 'error', 'stack', 'cause', 'path']) {
      expect(schema.safeParse({ ...failure, [field]: 'fixture-sensitive' }).success).toBe(false);
    }
    for (const value of [
      { success: false, code: 'IO_FAILED' },
      { ...failure, cleanupFailed: 'true' },
      { ...failure, success: 'false' },
      { ...failure, data: state },
    ]) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });

  it.each([
    'INVALID_REQUEST', 'CONFLICT', 'IO_FAILED', 'READ_ONLY',
    'FORBIDDEN', 'BODY_TOO_LARGE', 'RATE_LIMITED',
  ])('接受已有业务或边界错误码 %s', code => {
    expect(configIpcResponseSchemas.state.safeParse({ ...failure, code }).success).toBe(true);
  });

  it.each([
    'SESSION_EXPIRED', 'NOT_FOUND', 'UNSUPPORTED_MEDIA', 'REQUEST_TIMEOUT',
    'NETWORK_ERROR', 'INVALID_RESPONSE', 'fixture-sensitive', '', 42,
  ])('拒绝 HTTP 专属、客户端或未知错误码 %#', code => {
    expect(configIpcResponseSchemas.state.safeParse({ ...failure, code }).success).toBe(false);
  });
});
