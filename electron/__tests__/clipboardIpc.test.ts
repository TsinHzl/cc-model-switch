import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipboardHandler } from '../clipboardIpc';
import { createConfigHandlers } from '../configIpc';
import { createSource } from '../testing/ipcSource';
import {
  CLIPBOARD_TEXT_MAX_BYTES, clipboardIpcResponseSchema,
  type ClipboardIpcErrorCode,
} from '../../src/lib/clipboardIpcContract';
import type { GetTrustedWindow } from '../ipcSource';
import type { createService } from '../../server/service';

function pending() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const failed = (code: ClipboardIpcErrorCode) => ({ success: false, code });
type Source = ReturnType<typeof createSource>;

describe('剪贴板 handler 边界', () => {
  let source: Source;
  let current: ReturnType<GetTrustedWindow>;
  let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
  let handler: ReturnType<typeof createClipboardHandler>;

  beforeEach(() => {
    source = createSource();
    current = source.trusted;
    writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    handler = createClipboardHandler({ getTrustedWindow: () => current, writeText });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['', ' \t\r\n ', '中文 😀 𐀀', 'export A=one\nexport B=two\n'])(
    '原样写入合法文本 %#，不附加类型或格式参数', async text => {
      const result = await handler(source.event, text);
      expect(result).toEqual({ success: true });
      expect(clipboardIpcResponseSchema.parse(result)).toEqual(result);
      expect(writeText.mock.calls).toEqual([[text]]);
    },
  );

  it.each([
    [], ['text', undefined], ['text', { type: 'selection' }],
    [undefined], [null], [42], [true], [{}], [['text']], [new String('text')],
  ].map(args => ({ args })))('拒绝非法参数 %#，不写剪贴板', async ({ args }) => {
    expect(await handler(source.event, ...args)).toEqual(failed('INVALID_REQUEST'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('拒绝对象时不访问属性或执行字符串转换', async () => {
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    const proxy = new Proxy({}, { get: touched, ownKeys: touched, getPrototypeOf: touched });
    expect(await handler(source.event, proxy)).toEqual(failed('INVALID_REQUEST'));
    expect(touched).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each([
    ['其他窗口', (s) => { s.message.sender = { ...s.contents }; }],
    ['子 frame', (s) => { s.message.senderFrame = { ...s.frame }; }],
    ['替换主 frame', (s) => { s.contents.mainFrame = { ...s.frame }; }],
    ['空 frame', (s) => { s.message.senderFrame = null; }],
    ['detached frame', (s) => { s.frame.detached = true; }],
    ['销毁 frame', (s) => { s.frame.isDestroyed = () => true; }],
    ['销毁窗口', (s) => { s.window.isDestroyed = () => true; }],
    ['销毁 webContents', (s) => { s.contents.isDestroyed = () => true; }],
    ['错误 origin', (s) => { s.frame.origin = 'https://example.invalid'; }],
    ['不透明 origin', (s) => { s.frame.origin = 'null'; }],
  ] satisfies Array<[string, (source: Source) => void]>)(
    '拒绝 %s 且先于文本编码', async (_name, alter) => {
      alter(source);
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      expect(await handler(source.event, 'text')).toEqual(failed('FORBIDDEN'));
      expect(encode).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    },
  );

  it.each([
    'cc-model-switch://other/index.html', 'other-scheme://app/index.html',
    'cc-model-switch://app:123/index.html', 'cc-model-switch://fixture@app/index.html',
    'cc-model-switch://app/other.html', 'cc-model-switch://app/index.html?extra=1',
    'cc-model-switch://app/index.html#extra', 'about:blank', 'not-a-url',
  ])('拒绝不同页面地址 %#', async url => {
    source.frame.url = url;
    expect(await handler(source.event, 'text')).toEqual(failed('FORBIDDEN'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(['http://127.0.0.1:5173', 'http://127.0.0.1:5173/'])(
    '接受开发根地址 %s，拒绝端口及可信目标覆盖', async target => {
      source = createSource(target);
      current = source.trusted;
      expect(await handler(source.event, 'text')).toEqual({ success: true });
      writeText.mockClear();
      source.frame.url = 'http://127.0.0.1:5174/';
      expect(await handler(source.event, 'text')).toEqual(failed('FORBIDDEN'));
      source = createSource('https://example.invalid/');
      current = source.trusted;
      expect(await handler(source.event, 'text')).toEqual(failed('FORBIDDEN'));
      expect(writeText).not.toHaveBeenCalled();
    },
  );

  it('每次读取当前窗口，拒绝空窗口和旧事件', async () => {
    current = null;
    expect(await handler(source.event, 'text')).toEqual(failed('FORBIDDEN'));
    const replacement = createSource();
    current = replacement.trusted;
    expect(await handler(source.event, 'text')).toEqual(failed('FORBIDDEN'));
    expect(writeText).not.toHaveBeenCalled();
    expect(await handler(replacement.event, 'text')).toEqual({ success: true });
    expect(writeText.mock.calls).toEqual([['text']]);
  });

  it.each(['provider', 'getter'])('来源 %s 抛错时安全拒绝', async mode => {
    if (mode === 'provider') {
      handler = createClipboardHandler({
        getTrustedWindow() { throw new Error('fixture-sensitive'); }, writeText,
      });
    } else {
      Object.defineProperty(source.message, 'senderFrame', {
        get() { throw new Error('fixture-sensitive'); },
      });
    }
    expect(await handler(source.event, 'text')).toEqual(failed('FORBIDDEN'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(['a\0b', '\ud800', '\udfff', '\ud800x', 'x\udfff'])(
    '拒绝非法字符 %#，不进入编码和写入', async text => {
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      expect(await handler(source.event, text)).toEqual(failed('INVALID_REQUEST'));
      expect(encode).not.toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    },
  );

  it.each(['a', '中', '😀', '\n'])('按原始 UTF-8 验证 %j 的精确预算', async unit => {
    const bytes = Buffer.byteLength(unit, 'utf8');
    const text = unit.repeat(Math.floor(CLIPBOARD_TEXT_MAX_BYTES / bytes))
      + 'a'.repeat(CLIPBOARD_TEXT_MAX_BYTES % bytes);
    expect(Buffer.byteLength(text, 'utf8')).toBe(1_048_576);
    expect(await handler(source.event, text + 'a')).toEqual(failed('BODY_TOO_LARGE'));
    expect(writeText).not.toHaveBeenCalled();
    expect(await handler(source.event, text)).toEqual({ success: true });
    expect(writeText.mock.calls).toEqual([[text]]);
  });

  it('参数数量先于预算，码元超限先于字符检查', async () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const oversized = 'a'.repeat(CLIPBOARD_TEXT_MAX_BYTES) + '\0';
    expect(await handler(source.event, oversized, undefined)).toEqual(failed('INVALID_REQUEST'));
    expect(await handler(source.event, oversized)).toEqual(failed('BODY_TOO_LARGE'));
    const invalid = '中'.repeat(Math.floor(CLIPBOARD_TEXT_MAX_BYTES / 3) + 1) + '\0';
    expect(await handler(source.event, invalid)).toEqual(failed('INVALID_REQUEST'));
    expect(encode).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'])('等待 writer %s，期间拒绝新请求且不排队', async mode => {
    const gate = pending();
    writeText.mockReturnValueOnce(gate.promise);
    const settled = vi.fn();
    const first = handler(source.event, 'first').then(result => { settled(); return result; });
    try {
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(await handler(createSource().event, '\0')).toEqual(failed('FORBIDDEN'));
      expect(await handler(source.event, '\0')).toEqual(failed('INVALID_REQUEST'));
      expect(await handler(source.event, 'a'.repeat(CLIPBOARD_TEXT_MAX_BYTES + 1)))
        .toEqual(failed('BODY_TOO_LARGE'));
      expect(await handler(source.event, 'second')).toEqual(failed('RATE_LIMITED'));
      const replacement = createSource();
      current = replacement.trusted;
      expect(await handler(replacement.event, 'third')).toEqual(failed('RATE_LIMITED'));
      expect(writeText.mock.calls).toEqual([['first']]);
    } finally {
      if (mode === 'resolve') gate.resolve();
      else gate.reject(new Error('fixture-sensitive'));
      await Promise.allSettled([gate.promise, first]);
    }
    expect(await first).toEqual(mode === 'resolve'
      ? { success: true } : failed('CLIPBOARD_WRITE_FAILED'));
    expect(writeText.mock.calls).toEqual([['first']]);
    source = createSource();
    current = source.trusted;
    expect(await handler(source.event, 'next')).toEqual({ success: true });
    expect(writeText.mock.calls).toEqual([['first'], ['next']]);
  });

  it.each(['sync', 'async'])('writer %s 失败不泄露异常、不重试且释放名额', async mode => {
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    const error = Object.defineProperty({}, 'code', { get: touched });
    writeText.mockImplementationOnce(() => {
      if (mode === 'sync') throw error;
      return Promise.reject(error);
    });
    const result = await handler(source.event, 'fixture-sensitive');
    expect(result).toEqual(failed('CLIPBOARD_WRITE_FAILED'));
    expect(clipboardIpcResponseSchema.parse(result)).toEqual(result);
    expect(touched).not.toHaveBeenCalled();
    expect(writeText.mock.calls).toEqual([['fixture-sensitive']]);
    expect(await handler(source.event, 'next')).toEqual({ success: true });
    expect(writeText.mock.calls).toEqual([['fixture-sensitive'], ['next']]);
  });

  it('剪贴板与配置的在途名额互不占用', async () => {
    const configGate = pending();
    const clipboardGate = pending();
    const service: ReturnType<typeof createService> = {
      state: async () => ({ entries: [], groups: [], activeIndex: -1 }),
      apply: () => configGate.promise,
      change: async () => {},
    };
    const config = createConfigHandlers({ service, getTrustedWindow: () => current });
    const firstConfig = config.apply(source.event, {
      expected: { model: 'fixture-model', base_url: '', key: '' },
    });
    writeText.mockReturnValueOnce(clipboardGate.promise);
    const firstClipboard = handler(source.event, 'text');
    try {
      expect(writeText.mock.calls).toEqual([['text']]);
      configGate.resolve();
      expect(await firstConfig).toEqual({ success: true });
      expect(await config.state(source.event, {})).toEqual({
        success: true, data: { entries: [], groups: [], activeIndex: -1 },
      });
      expect(await handler(source.event, 'second')).toEqual(failed('RATE_LIMITED'));
    } finally {
      configGate.resolve();
      clipboardGate.resolve();
      await Promise.all([firstConfig, firstClipboard]);
    }
    expect(await firstClipboard).toEqual({ success: true });
    expect(writeText.mock.calls).toEqual([['text']]);
  });
});
