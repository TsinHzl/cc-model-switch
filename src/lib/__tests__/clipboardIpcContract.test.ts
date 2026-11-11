import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build, normalizePath } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIPBOARD_TEXT_MAX_BYTES, clipboardIpcChannel,
  clipboardIpcRequestSchema, clipboardIpcResponseSchema,
} from '../clipboardIpcContract';

afterEach(() => vi.restoreAllMocks());

describe('只写剪贴板请求契约', () => {
  it('固定通道及一 MiB 原始文本预算', () => {
    expect(clipboardIpcChannel).toBe('clipboard:writeText');
    expect(CLIPBOARD_TEXT_MAX_BYTES).toBe(1_048_576);
  });

  it.each([
    '', ' \t\r\n ', '中文 😀 𐀀 􏿿',
    'export A=one\nexport B=two\n',
    '{"key":"fixture-key"}',
    "'\"`$()\\",
  ])('原样保留合法文本 %#', value => {
    const args = [value];
    const parsed = clipboardIpcRequestSchema.parse(args);
    expect(parsed).toEqual(args);
    expect(parsed).not.toBe(args);
  });

  it.each([
    [], ['text', undefined], ['text', { type: 'selection' }],
    [null], [undefined], [42], [true], [{}], [['text']],
    [new String('text')], 'text', { text: 'text' },
  ].map(args => ({ args })))('拒绝缺参、多参及非原始字符串 %#', ({ args }) => {
    expect(clipboardIpcRequestSchema.safeParse(args).success).toBe(false);
  });

  it('不调用对象的字符串转换', () => {
    const toString = vi.fn(() => { throw new Error('private-marker'); });
    expect(clipboardIpcRequestSchema.safeParse([{ toString }]).success).toBe(false);
    expect(toString).not.toHaveBeenCalled();
  });

  it.each(['a\0b', '\ud800', '\udfff', '\ud800x', 'x\udfff', '\ud800𐀀'])(
    '拒绝 NUL 或孤立代理项 %#，不进入编码阶段',
    value => {
      const encode = vi.spyOn(TextEncoder.prototype, 'encode');
      const result = clipboardIpcRequestSchema.safeParse([value]);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toBe('INVALID_REQUEST');
      expect(encode).not.toHaveBeenCalled();
    },
  );

  it.each(['a', 'é', '中', '😀'])('按 UTF-8 字节验证 %s 的精确边界', unit => {
    const bytes = Buffer.byteLength(unit, 'utf8');
    const value = unit.repeat(Math.floor(CLIPBOARD_TEXT_MAX_BYTES / bytes))
      + 'a'.repeat(CLIPBOARD_TEXT_MAX_BYTES % bytes);
    expect(Buffer.byteLength(value, 'utf8')).toBe(CLIPBOARD_TEXT_MAX_BYTES);
    expect(clipboardIpcRequestSchema.parse([value])).toEqual([value]);
    const result = clipboardIpcRequestSchema.safeParse([value + 'a']);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('BODY_TOO_LARGE');
  });

  it('先拒绝码元数已超限的文本，不再分配编码缓冲区', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    const result = clipboardIpcRequestSchema.safeParse([
      'a'.repeat(CLIPBOARD_TEXT_MAX_BYTES + 1),
    ]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('BODY_TOO_LARGE');
    expect(encode).not.toHaveBeenCalled();
  });

  it('预算不是 JSON 序列化大小，不改写多行文本', () => {
    const value = '\n'.repeat(CLIPBOARD_TEXT_MAX_BYTES);
    expect(Buffer.byteLength(JSON.stringify([value]), 'utf8'))
      .toBeGreaterThan(CLIPBOARD_TEXT_MAX_BYTES);
    expect(clipboardIpcRequestSchema.parse([value])).toEqual([value]);
  });
});

describe('只写剪贴板响应契约', () => {
  it('成功响应不包含复制内容', () => {
    const response = { success: true };
    expect(clipboardIpcResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    'FORBIDDEN', 'INVALID_REQUEST', 'BODY_TOO_LARGE',
    'RATE_LIMITED', 'CLIPBOARD_WRITE_FAILED',
  ])('接受固定错误码 %s', code => {
    const response = { success: false, code };
    expect(clipboardIpcResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    undefined, null, 'private-marker', {},
    { success: 'true' },
    { success: true, text: 'private-marker' },
    { success: true, code: 'CLIPBOARD_WRITE_FAILED' },
    { success: false },
    { success: false, code: 'UNKNOWN' },
    { success: false, code: 'WRITE_UNCERTAIN' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', message: 'private-marker' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', stack: 'private-marker' },
    { success: false, code: 'CLIPBOARD_WRITE_FAILED', cleanupFailed: false },
  ])('拒绝未知响应及额外字段 %#', response => {
    expect(clipboardIpcResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('剪贴板契约构建边界', () => {
  it('真实打包后仅使用 Web API 校验，不依赖 Electron 或 Node', async () => {
    let code = '';
    const modules: string[] = [];
    await build({
      configFile: false,
      envFile: false,
      logLevel: 'silent',
      build: {
        write: false, minify: false, emptyOutDir: false,
        lib: {
          entry: fileURLToPath(new URL('../clipboardIpcContract.ts', import.meta.url)),
          name: 'ClipboardContractTest', formats: ['iife'],
        },
      },
      plugins: [{
        name: 'inspect-clipboard-contract',
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
    expect(modules.some(id =>
      id.startsWith('node:') || id.includes('/server/') || id.includes('/electron/')
        || id.includes('browser-external') || id === 'electron',
    )).toBe(false);
    const sandbox = { TextEncoder };
    const contract = runInNewContext(
      `${code}\nClipboardContractTest`,
      sandbox,
      { timeout: 5_000 },
    ) as typeof import('../clipboardIpcContract');
    expect(runInNewContext('[typeof Buffer, typeof process, typeof require].join(",")', sandbox))
      .toBe('undefined,undefined,undefined');
    expect(contract.clipboardIpcRequestSchema.parse(['中文 😀\n'])).toEqual(['中文 😀\n']);
    expect(contract.clipboardIpcRequestSchema.safeParse(['\ud800']).success).toBe(false);
    expect(contract.clipboardIpcRequestSchema.safeParse([
      '😀'.repeat(CLIPBOARD_TEXT_MAX_BYTES / 4 + 1),
    ]).success).toBe(false);
    expect(contract.clipboardIpcResponseSchema.safeParse({
      success: false, code: 'CLIPBOARD_WRITE_FAILED', message: 'private-marker',
    }).success).toBe(false);
  });
});
