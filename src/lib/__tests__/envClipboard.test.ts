import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClipboardBridge } from '../../../electron/clipboardBridge';
import { CLIPBOARD_TEXT_MAX_BYTES } from '../clipboardIpcContract';
import { buildExportLines, type ConfigEntry } from '../applyConfig';
import { copyEnvToClipboard, formatEnvClipboard } from '../envClipboard';

const entry: ConfigEntry = {
  model: 'fixture-model', base_url: 'https://fixture.invalid',
  key: 'fixture-key', channel: 'not-an-env-value',
};

describe('环境变量复制格式', () => {
  it('Windows 按固定顺序生成七条当前会话赋值，保留末尾换行', () => {
    expect(formatEnvClipboard(Object.freeze(entry), 'win32')).toEqual({
      ok: true,
      format: 'powershell',
      text: [
        "$env:ANTHROPIC_MODEL = ('fixture-model')",
        "$env:ANTHROPIC_BASE_URL = ('https://fixture.invalid')",
        "$env:ANTHROPIC_AUTH_TOKEN = ('fixture-key')",
        "$env:ANTHROPIC_SMALL_FAST_MODEL = ('fixture-model')",
        "$env:ANTHROPIC_DEFAULT_OPUS_MODEL = ('fixture-model')",
        "$env:ANTHROPIC_DEFAULT_SONNET_MODEL = ('fixture-model')",
        "$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = ('fixture-model')",
        '',
      ].join('\n'),
    });
  });

  it.each(['darwin', 'linux'])('%s 保留现有 shell 输出，包括历史特殊值', platform => {
    for (const value of ['', "a '$()`", 'a\r\nb\t', '中文 😀', '\0', '\ud800']) {
      const source = { ...entry, model: value, base_url: value, key: value };
      expect(formatEnvClipboard(source, platform)).toEqual({
        ok: true, format: 'shell', text: `${buildExportLines(source).join('\n')}\n`,
      });
    }
  });

  it.each([undefined, '', 'windows', 'freebsd', 'WIN32'])(
    '不支持的平台 %# 明确拒绝，不默认为 shell',
    platform => {
      expect(formatEnvClipboard(entry, platform)).toEqual({
        ok: false, code: 'UNSUPPORTED_PLATFORM',
      });
    },
  );

  it.each([
    { value: '', expression: "('')" },
    { value: '  ', expression: "('  ')" },
    { value: "a'b", expression: "('a''b')" },
    { value: "''", expression: "('''''')" },
    { value: '中文 😀 e\u{0301}\u{200b}\u{feff}', expression: "('中文 😀 e\u{0301}\u{200b}\u{feff}')" },
    { value: '"“”„', expression: "('\"“”„')" },
    { value: '$HOME ${env:PATH} $(Get-Item .) `n ; | & #', expression: "('$HOME ${env:PATH} $(Get-Item .) `n ; | & #')" },
    { value: "'; $env:FIXTURE_SENTINEL='changed'; #", expression: "('''; $env:FIXTURE_SENTINEL=''changed''; #')" },
    { value: '‘', expression: "('' + [char]0x2018 + '')" },
    { value: '’', expression: "('' + [char]0x2019 + '')" },
    { value: '‚', expression: "('' + [char]0x201a + '')" },
    { value: '‛', expression: "('' + [char]0x201b + '')" },
    { value: '\n', expression: "('' + [char]0x000a + '')" },
    { value: '\r', expression: "('' + [char]0x000d + '')" },
    { value: '\t', expression: "('' + [char]0x0009 + '')" },
    { value: '\x01', expression: "('' + [char]0x0001 + '')" },
    { value: '\x1b', expression: "('' + [char]0x001b + '')" },
    { value: '\x7f', expression: "('' + [char]0x007f + '')" },
    { value: '\x85', expression: "('' + [char]0x0085 + '')" },
    { value: '\x9f', expression: "('' + [char]0x009f + '')" },
    { value: '\u{2028}', expression: "('' + [char]0x2028 + '')" },
    { value: '\u{2029}', expression: "('' + [char]0x2029 + '')" },
    { value: "a‘'\r\nb", expression: "('a' + [char]0x2018 + '''' + [char]0x000d + '' + [char]0x000a + 'b')" },
  ])('Windows 字面量 %# 不展开输入，控制字符不产生额外物理行', ({ value, expression }) => {
    const result = formatEnvClipboard({
      ...entry, model: value, base_url: value, key: value,
    }, 'win32');
    assert.ok(result.ok);
    expect(result.format).toBe('powershell');
    const lines = result.text.split('\n');
    expect(lines).toHaveLength(8);
    expect(lines[7]).toBe('');
    for (const line of lines.slice(0, 7)) {
      expect(line.slice(line.indexOf(' = ') + 3)).toBe(expression);
      expect(line).not.toMatch(/[\x00-\x1f\x7f-\x9f\u{2018}-\u{201b}\u{2028}\u{2029}]/u);
    }
  });

  it.each(['model', 'base_url', 'key'] as const)(
    'Windows 拒绝 %s 中的 NUL 与孤立代理项，不泄露或修补原值',
    field => {
      for (const value of ['fixture\0secret', '\ud800', '\udfff', '\ud800x', '\udfff\ud800']) {
        expect(formatEnvClipboard({ ...entry, [field]: value }, 'win32')).toEqual({
          ok: false, code: 'INVALID_VALUE',
        });
      }
    },
  );

  it('Windows 不限制无关 channel 字段，也不修改输入', () => {
    const source = Object.freeze({ ...entry, channel: '\0\ud800' });
    expect(formatEnvClipboard(source, 'win32')).toEqual(formatEnvClipboard(entry, 'win32'));
    expect(source.channel).toBe('\0\ud800');
  });
});

describe('Env 复制生产流程', () => {
  const invoke = vi.fn<(channel: string, text: string) => Promise<unknown>>();
  const bridge = createClipboardBridge(invoke);
  const writeText = vi.fn((text: string) => bridge.writeText(text));
  const browserWrite = vi.fn();

  beforeEach(() => {
    invoke.mockReset().mockResolvedValue({ success: true });
    writeText.mockClear();
    browserWrite.mockClear();
    vi.stubGlobal('window', { desktop: { clipboard: { writeText } } });
    vi.stubGlobal('navigator', { clipboard: { writeText: browserWrite } });
  });

  afterEach(() => {
    try {
      expect(browserWrite).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['darwin', 'linux', 'win32'])('%s 将完整格式化结果提交一次', async platform => {
    const expected = formatEnvClipboard(entry, platform);
    assert.ok(expected.ok);
    await expect(copyEnvToClipboard(entry, platform)).resolves.toEqual(expected);
    expect(writeText.mock.calls).toEqual([[expected.text]]);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', expected.text]]);
  });

  it('Windows 特殊字符及空值沿真实客户端和桥接原样传输', async () => {
    const source = { ...entry, model: "a‘'\r\n", base_url: '', key: '$()`' };
    const expected = formatEnvClipboard(source, 'win32');
    assert.ok(expected.ok);
    await expect(copyEnvToClipboard(source, 'win32')).resolves.toEqual(expected);
    expect(invoke.mock.calls).toEqual([['clipboard:writeText', expected.text]]);
  });

  it.each([undefined, '', 'freebsd'])('未知平台 %# 不调用桥接', async platform => {
    await expect(copyEnvToClipboard(entry, platform)).resolves.toEqual({
      ok: false, code: 'UNSUPPORTED_PLATFORM',
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each(['model', 'base_url', 'key'] as const)('非法 %s 不调用桥接', async field => {
    for (const value of ['fixture\0secret', '\ud800', '\udfff']) {
      await expect(copyEnvToClipboard({ ...entry, [field]: value }, 'win32')).resolves.toEqual({
        ok: false, code: 'INVALID_VALUE',
      });
    }
    expect(writeText).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('按编码后的完整文本执行既有大小校验，不截断或拆分', async () => {
    const source = { ...entry, key: '‘'.repeat(60_000) };
    const expected = formatEnvClipboard(source, 'win32');
    assert.ok(expected.ok);
    expect(new TextEncoder().encode(source.key).byteLength).toBeLessThan(CLIPBOARD_TEXT_MAX_BYTES);
    expect(new TextEncoder().encode(expected.text).byteLength).toBeGreaterThan(CLIPBOARD_TEXT_MAX_BYTES);
    await expect(copyEnvToClipboard(source, 'win32')).rejects.toThrow(
      '复制文本超过剪贴板大小限制，未截断文本。',
    );
    expect(writeText.mock.calls).toEqual([[expected.text]]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('已知平台缺桥接时保留不可用提示，不回退浏览器', async () => {
    vi.stubGlobal('window', undefined);
    await expect(copyEnvToClipboard(entry, 'win32')).rejects.toThrow(
      '桌面剪贴板桥接不可用，请使用桌面应用打开。',
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['RATE_LIMITED', '当前有剪贴板操作正在进行，请等待其完成。'],
    ['CLIPBOARD_WRITE_FAILED', '剪贴板写入失败，内容可能已更改；请自行核对，不要直接重复复制。'],
  ])('业务失败 %s 不被误报为格式化拒绝', async (code, message) => {
    invoke.mockResolvedValueOnce({ success: false, code });
    await expect(copyEnvToClipboard(entry, 'win32')).rejects.toThrow(message);
    expect(writeText).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each(['sync', 'async', 'response'])('通信异常 %s 脱敏且不重放', async mode => {
    invoke.mockImplementationOnce(() => {
      if (mode === 'sync') throw new Error('fixture-sensitive');
      if (mode === 'async') return Promise.reject(new Error('fixture-sensitive'));
      return Promise.resolve({ success: true, text: 'fixture-sensitive' });
    });
    await expect(copyEnvToClipboard(entry, 'win32')).rejects.toThrow(
      '剪贴板通信失败，操作结果未知；请自行核对，勿自动重试。',
    );
    expect(writeText).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'])('等待底层异步 %s 后才结算', async mode => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<unknown>((done, fail) => { resolve = done; reject = fail; });
    invoke.mockReturnValueOnce(pending);
    const settled = vi.fn();
    const result = copyEnvToClipboard(entry, 'win32');
    void result.then(settled, settled);
    try {
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledOnce();
    } finally {
      if (mode === 'resolve') resolve({ success: true });
      else reject(new Error('fixture-sensitive'));
      await Promise.allSettled([pending, result]);
    }
    if (mode === 'resolve') {
      await expect(result).resolves.toEqual(formatEnvClipboard(entry, 'win32'));
    } else {
      await expect(result).rejects.toThrow(
        '剪贴板通信失败，操作结果未知；请自行核对，勿自动重试。',
      );
    }
    expect(settled).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledOnce();
  });
});
