import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipboardBridge } from '../../../electron/clipboardBridge';
import { clipboardErrorMessage, writeClipboardText } from '../clipboardClient';

const unavailable = '桌面剪贴板桥接不可用，请使用桌面应用打开。';
const unknownResult = '剪贴板通信失败，操作结果未知；请自行核对，勿自动重试。';
const fallback = '复制结果无法确认，请自行核对，不要直接重复复制。';
const invalid = '复制文本格式无效，无法提交剪贴板请求。';
const oversized = '复制文本超过剪贴板大小限制，未截断文本。';
const invoke = vi.fn<(channel: string, text: string) => Promise<unknown>>();
const browserWrite = vi.fn();

async function expectFailure(result: Promise<unknown>, message: string) {
  const error: unknown = await result.catch(value => value);
  assert.ok(error instanceof Error);
  expect(error.message).toBe(message);
  expect('cause' in error).toBe(false);
  expect(clipboardErrorMessage(error)).toBe(message);
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ success: true });
  browserWrite.mockReset();
  vi.stubGlobal('navigator', { clipboard: { writeText: browserWrite } });
  vi.stubGlobal('window', {
    desktop: { clipboard: createClipboardBridge(invoke) },
  });
});

afterEach(() => {
  try {
    expect(browserWrite).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('桌面剪贴板客户端', () => {
  it.each([
    '', 'fixture-key', ' \t中文 😀\r\n ',
    '{\n  "model": "fixture-model"\n}', 'export ANTHROPIC_MODEL=fixture-model\n',
  ])('通过真实桥接原样发送文本 %#，成功返回 void', async text => {
    await expect(writeClipboardText(text)).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', text]]);
  });

  it.each([
    undefined, {}, { desktop: {} }, { desktop: { clipboard: {} } },
    { desktop: { clipboard: { writeText: 'not-a-function' } } },
  ].map(value => ({ value })))('缺少可调用桥接 %# 时明确拒绝，不回退浏览器', async ({ value }) => {
    vi.stubGlobal('window', value);
    await expectFailure(writeClipboardText('fixture-text'), unavailable);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['FORBIDDEN', '剪贴板请求来源未获授权。'],
    ['INVALID_REQUEST', invalid],
    ['BODY_TOO_LARGE', oversized],
    ['RATE_LIMITED', '当前有剪贴板操作正在进行，请等待其完成。'],
    ['CLIPBOARD_WRITE_FAILED', '剪贴板写入失败，内容可能已更改；请自行核对，不要直接重复复制。'],
  ])('业务失败 %s 不被误归类为通信失败', async (code, message) => {
    invoke.mockResolvedValueOnce({ success: false, code });
    await expectFailure(writeClipboardText('fixture-text'), message);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'fixture-text']]);
  });

  it.each([
    { text: 'a\0b', message: invalid },
    { text: '\ud800', message: invalid },
    { text: '😀'.repeat(262_145), message: oversized },
  ])('非法文本 %# 由真实桥接拒绝，不发送 IPC', async ({ text, message }) => {
    await expectFailure(writeClipboardText(text), message);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['sync', 'async'])('传输 %s 失败脱敏，不探查原异常或重试', async mode => {
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    const hostile = new Proxy({}, { get: touched, ownKeys: touched, getPrototypeOf: touched });
    const calls: Array<[string, string]> = [];
    const transport = (channel: string, text: string): Promise<unknown> => {
      calls.push([channel, text]);
      if (mode === 'sync') throw hostile;
      return Promise.reject(hostile);
    };
    vi.stubGlobal('window', {
      desktop: { clipboard: createClipboardBridge(transport) },
    });
    await expectFailure(writeClipboardText('fixture-text'), unknownResult);
    expect(touched).not.toHaveBeenCalled();
    expect(calls).toEqual([['clipboard:writeText', 'fixture-text']]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    null, 'fixture-sensitive', {},
    { success: true, text: 'fixture-sensitive' },
    { success: false, code: 'UNKNOWN' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', message: 'fixture-sensitive' },
  ].map(response => ({ response })))('真实桥接拒绝损坏响应 %#，客户端报告结果未知', async ({ response }) => {
    invoke.mockResolvedValueOnce(response);
    await expectFailure(writeClipboardText('fixture-text'), unknownResult);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'fixture-text']]);
  });

  it('客户端自身拒绝畸形桥接响应，并保留桥接调用接收者', async () => {
    const writeText = vi.fn().mockResolvedValue({ success: true, text: 'fixture-sensitive' });
    const clipboard = { writeText };
    vi.stubGlobal('window', { desktop: { clipboard } });
    await expectFailure(writeClipboardText('fixture-text'), unknownResult);
    expect(writeText.mock.calls).toEqual([['fixture-text']]);
    expect(writeText.mock.contexts).toEqual([clipboard]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'])('等待异步 %s，不提前报告成功', async mode => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
    invoke.mockReturnValueOnce(pending);
    const settled = vi.fn();
    const result = writeClipboardText('fixture-text');
    void result.then(settled, settled);
    try {
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'fixture-text']]);
    } finally {
      if (mode === 'resolve') resolve({ success: true });
      else reject(new Error('fixture-sensitive'));
      await Promise.allSettled([pending, result]);
    }
    if (mode === 'resolve') await expect(result).resolves.toBeUndefined();
    else await expectFailure(result, unknownResult);
    expect(settled).toHaveBeenCalledOnce();
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'fixture-text']]);
  });

  it('失败后不自动重放，仅后续显式调用发送新请求', async () => {
    invoke.mockRejectedValueOnce(new Error('fixture-sensitive'));
    await expectFailure(writeClipboardText('first'), unknownResult);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'first']]);
    await expect(writeClipboardText('next')).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([
      ['clipboard:writeText', 'first'], ['clipboard:writeText', 'next'],
    ]);
  });
});

describe('复制错误展示白名单', () => {
  it('未知异常或伪造 message 对象均使用固定兜底，不执行字符串转换', () => {
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    for (const error of [
      undefined, null, 'fixture-sensitive', new Error('fixture-sensitive'),
      { message: invalid, toString: touched },
      { [Symbol.toPrimitive]: touched },
    ]) {
      expect(clipboardErrorMessage(error)).toBe(fallback);
    }
    expect(touched).not.toHaveBeenCalled();
  });

  it('异常属性或原型检查抛错时仍返回固定兜底', () => {
    const error = Object.defineProperty(new Error(), 'message', {
      get() { throw new Error('fixture-sensitive'); },
    });
    const proxy = new Proxy({}, {
      getPrototypeOf() { throw new Error('fixture-sensitive'); },
    });
    expect(clipboardErrorMessage(error)).toBe(fallback);
    expect(clipboardErrorMessage(proxy)).toBe(fallback);
  });
});
