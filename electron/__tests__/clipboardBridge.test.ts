import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build, normalizePath } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClipboardBridge } from '../clipboardBridge';
import {
  CLIPBOARD_TEXT_MAX_BYTES, type ClipboardBridge,
} from '../../src/lib/clipboardIpcContract';

const unknownResult = '剪贴板通信失败，操作结果未知；请自行核对，勿自动重试。';
const invalid = { success: false, code: 'INVALID_REQUEST' };
const oversized = { success: false, code: 'BODY_TOO_LARGE' };
const call = (bridge: ClipboardBridge, ...args: unknown[]) =>
  Reflect.apply(bridge.writeText, undefined, args) as Promise<unknown>;

async function expectUnknown(result: Promise<unknown>) {
  const error = await result.catch(value => value);
  assert.ok(error instanceof Error);
  expect(error.message).toBe(unknownResult);
  expect(Object.keys(error)).toEqual([]);
  expect('cause' in error).toBe(false);
}

afterEach(() => vi.restoreAllMocks());

describe('固定剪贴板桥接', () => {
  it('只公开冻结的 writeText，创建时不发送', () => {
    const invoke = vi.fn();
    const bridge = createClipboardBridge(invoke);
    expect(Object.keys(bridge)).toEqual(['writeText']);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['', ' \t\r\n ', '中文 😀 𐀀', 'export A=one\nexport B=two\n'])(
    '原样发送文本 %#，只调用固定通道一次', async text => {
      const response = { success: true };
      const invoke = vi.fn().mockResolvedValue(response);
      const result = await createClipboardBridge(invoke).writeText(text);
      expect(result).toEqual(response);
      expect(result).not.toBe(response);
      expect(invoke.mock.calls).toEqual([['clipboard:writeText', text]]);
    },
  );

  it.each([
    [], ['text', undefined], ['text', { type: 'selection' }],
    [undefined], [null], [42], [true], [{}], [['text']], [new String('text')],
    [() => 'text'], [Symbol('text')],
  ].map(args => ({ args })))('拒绝非法参数 %# 且不发送', async ({ args }) => {
    const invoke = vi.fn();
    expect(await call(createClipboardBridge(invoke), ...args)).toEqual(invalid);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('拒绝对象及 Proxy 时不访问属性或执行转换', async () => {
    const invoke = vi.fn();
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    const object = Object.defineProperty({
      toString: touched, [Symbol.toPrimitive]: touched,
    }, 'text', { get: touched });
    const proxy = new Proxy(object, {
      get: touched, ownKeys: touched, getPrototypeOf: touched,
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const bridge = createClipboardBridge(invoke);
    for (const input of [object, proxy, revoked.proxy]) {
      expect(await call(bridge, input)).toEqual(invalid);
    }
    expect(touched).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['a\0b', '\ud800', '\udfff', '\ud800x', 'x\udfff'])(
    '拒绝非法字符 %#，不编码、不发送', async text => {
      const invoke = vi.fn();
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      expect(await createClipboardBridge(invoke).writeText(text)).toEqual(invalid);
      expect(encode).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(['a', '中', '😀', '\n'])('按原始 UTF-8 校验 %j 的精确预算', async unit => {
    const bytes = Buffer.byteLength(unit, 'utf8');
    const text = unit.repeat(Math.floor(CLIPBOARD_TEXT_MAX_BYTES / bytes))
      + 'a'.repeat(CLIPBOARD_TEXT_MAX_BYTES % bytes);
    const invoke = vi.fn().mockResolvedValue({ success: true });
    const bridge = createClipboardBridge(invoke);
    expect(Buffer.byteLength(text, 'utf8')).toBe(1_048_576);
    expect(await bridge.writeText(text + 'a')).toEqual(oversized);
    expect(invoke).not.toHaveBeenCalled();
    expect(await bridge.writeText(text)).toEqual({ success: true });
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', text]]);
  });

  it('参数数量、码元上限及非法字符按顺序拒绝', async () => {
    const invoke = vi.fn();
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const bridge = createClipboardBridge(invoke);
    const tooLong = 'a'.repeat(CLIPBOARD_TEXT_MAX_BYTES) + '\0';
    expect(await call(bridge, tooLong, undefined)).toEqual(invalid);
    expect(await bridge.writeText(tooLong)).toEqual(oversized);
    const badUnicode = '中'.repeat(Math.floor(CLIPBOARD_TEXT_MAX_BYTES / 3) + 1) + '\0';
    expect(await bridge.writeText(badUnicode)).toEqual(invalid);
    expect(encode).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    'FORBIDDEN', 'INVALID_REQUEST', 'BODY_TOO_LARGE',
    'RATE_LIMITED', 'CLIPBOARD_WRITE_FAILED',
  ])('保留业务错误 %s 并返回副本', async code => {
    const response = { success: false, code };
    const invoke = vi.fn().mockResolvedValue(response);
    const result = await createClipboardBridge(invoke).writeText('text');
    expect(result).toEqual(response);
    expect(result).not.toBe(response);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'text']]);
  });

  it.each([
    undefined, null, 'fixture-sensitive', [], {},
    { success: 'true' }, { success: true, text: 'fixture-sensitive' },
    { success: false }, { success: false, code: 'UNKNOWN' },
    { success: false, code: 'WRITE_UNCERTAIN' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', message: 'fixture-sensitive' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', stack: 'fixture-sensitive' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', cleanupFailed: false },
  ].map(response => ({ response })))('损坏响应 %# 转为固定未知结果异常', async ({ response }) => {
    const invoke = vi.fn().mockResolvedValue(response);
    await expectUnknown(createClipboardBridge(invoke).writeText('text'));
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'text']]);
  });

  it.each(['sync', 'async'])('传输 %s 异常不泄露、不探查原异常、不重试', async mode => {
    const touched = vi.fn(() => { throw new Error('fixture-sensitive'); });
    const hostile = new Proxy({}, { get: touched, ownKeys: touched });
    for (const value of [
      new Error('fixture-sensitive'), 'fixture-sensitive', null,
      { success: false, code: 'FORBIDDEN' }, hostile,
    ]) {
      const invoke = vi.fn(() => {
        if (mode === 'sync') throw value;
        return Promise.reject(value);
      });
      await expectUnknown(createClipboardBridge(invoke).writeText('text'));
      expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'text']]);
    }
    expect(touched).not.toHaveBeenCalled();
  });

  it('响应解析抛错时不泄露原异常', async () => {
    const response = Object.defineProperty({}, 'success', {
      get() { throw new Error('fixture-sensitive'); },
    });
    const invoke = vi.fn().mockResolvedValue(response);
    await expectUnknown(createClipboardBridge(invoke).writeText('text'));
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'text']]);
  });

  it('本地编码意外抛错时安全失败且不发送', async () => {
    const invoke = vi.fn();
    vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(() => {
      throw new Error('fixture-sensitive');
    });
    await expectUnknown(createClipboardBridge(invoke).writeText('text'));
    expect(invoke).not.toHaveBeenCalled();
  });

  it('等待传输响应，不提前报告成功', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>(done => { resolve = done; });
    const invoke = vi.fn(() => pending);
    const settled = vi.fn();
    const result = createClipboardBridge(invoke).writeText('text')
      .then(value => { settled(); return value; });
    try {
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'text']]);
    } finally {
      resolve({ success: true });
      await Promise.allSettled([pending, result]);
    }
    expect(await result).toEqual({ success: true });
  });

  it('失败后不自动重放，允许后续显式调用', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error('fixture-sensitive'))
      .mockResolvedValueOnce({ success: true });
    const bridge = createClipboardBridge(invoke);
    await expectUnknown(bridge.writeText('first'));
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', 'first']]);
    expect(await bridge.writeText('next')).toEqual({ success: true });
    expect(invoke.mock.calls).toEqual([
      ['clipboard:writeText', 'first'], ['clipboard:writeText', 'next'],
    ]);
  });
});

describe('剪贴板桥接独立打包边界', () => {
  it('真实浏览器目标产物在无 Node 的 VM 中校验并调用固定通道', async () => {
    let code = '';
    const modules: string[] = [];
    await build({
      configFile: false, envFile: false, logLevel: 'silent',
      build: {
        write: false, minify: false, emptyOutDir: false,
        lib: {
          entry: fileURLToPath(new URL('../clipboardBridge.ts', import.meta.url)),
          name: 'ClipboardBridgeTest', formats: ['iife'],
        },
      },
      plugins: [{
        name: 'inspect-clipboard-bridge',
        generateBundle(_options, bundle) {
          modules.push(...[...this.getModuleIds()].map(normalizePath));
          const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
          expect(chunks).toHaveLength(1);
          expect(chunks[0].imports).toEqual([]);
          expect(chunks[0].dynamicImports).toEqual([]);
          code = chunks[0].code;
        },
      }],
    });
    expect(modules.some(id => id.endsWith('/src/lib/clipboardIpcContract.ts'))).toBe(true);
    expect(modules.some(id => id.includes('/node_modules/zod/'))).toBe(true);
    expect(modules.some(id =>
      id.startsWith('node:') || id.includes('/server/') || id.includes('browser-external')
        || id === 'electron'
        || (id.includes('/electron/') && !id.endsWith('/electron/clipboardBridge.ts')),
    )).toBe(false);
    const sandbox = { TextEncoder };
    const factory = runInNewContext(
      `${code}\nClipboardBridgeTest.createClipboardBridge`,
      sandbox, { timeout: 5_000 },
    ) as typeof createClipboardBridge;
    expect(runInNewContext('[typeof Buffer, typeof process, typeof require].join(",")', sandbox))
      .toBe('undefined,undefined,undefined');
    const invoke = vi.fn().mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, code: 'CLIPBOARD_WRITE_FAILED' })
      .mockResolvedValueOnce({ success: true, text: 'fixture-sensitive' });
    const bridge = factory(invoke);
    expect(await bridge.writeText('\ud800')).toEqual(invalid);
    expect(await bridge.writeText('😀'.repeat(CLIPBOARD_TEXT_MAX_BYTES / 4 + 1))).toEqual(oversized);
    expect(invoke).not.toHaveBeenCalled();
    expect(await bridge.writeText('中文 😀\n')).toEqual({ success: true });
    expect(await bridge.writeText('second')).toEqual({
      success: false, code: 'CLIPBOARD_WRITE_FAILED',
    });
    await expect(bridge.writeText('third')).rejects.toThrow(unknownResult);
    expect(invoke.mock.calls).toEqual([
      ['clipboard:writeText', '中文 😀\n'],
      ['clipboard:writeText', 'second'], ['clipboard:writeText', 'third'],
    ]);
  }, 30_000);
});
