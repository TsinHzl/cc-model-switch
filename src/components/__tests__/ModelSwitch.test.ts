import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ModelSwitch from '../ModelSwitch';
import { useConfigState, type LoadStatus } from '../../lib/configStore';
import { findActiveIndex, groupConfigs, readActive } from '../../lib/configModel';

vi.mock('../../lib/configStore', () => ({ useConfigState: vi.fn() }));

// 仅验证真实组件静态输出，不模拟挂载、点击或滚动。
function render(status: LoadStatus) {
  const reload = vi.fn().mockResolvedValue(true);
  const applyModel = vi.fn().mockResolvedValue(true);
  vi.mocked(useConfigState).mockReturnValue({ status, reload, applyModel });
  const html = renderToStaticMarkup(createElement(ModelSwitch));
  expect(reload).not.toHaveBeenCalled();
  expect(applyModel).not.toHaveBeenCalled();
  return html;
}

describe('桌面配置状态提示', () => {
  it.each([
    ['DESKTOP_UNAVAILABLE', '桌面配置桥接不可用，请使用桌面应用打开。'],
    ['IPC_ERROR', '配置通信失败，操作结果未知；请重新读取核对，勿自动重试。'],
    ['WRITE_UNCERTAIN', '配置可能已写入，请重新读取核对；不要直接重复写入。'],
  ])('错误 %s 保留安全提示并显示只读恢复入口', (code, message) => {
    const html = render({ kind: 'error', code, message });
    expect(html).toContain('<h2>无法读取本机配置</h2>');
    expect(html).toContain(message);
    expect(html).toContain('重新读取</button>');
    expect(html).toContain('若此前执行过写入，请先核对结果，不要直接重复写入。');
    expect(html).not.toContain('Node 服务');
    expect(html).not.toContain('浏览器文件授权');
    expect(html).not.toContain('刷新网页');
  });

  it.each([
    ['空来源', '{}'],
    ['非空但未匹配的来源', JSON.stringify({ env: { ANTHROPIC_MODEL: 'outside-list' } })],
  ])('%s 不误报为两个配置来源均为空', (_name, settings) => {
    const entries = [{
      model: 'fixture-model', base_url: 'https://example.invalid',
      key: 'fixture-key', channel: 'fixture-channel',
    }];
    const active = readActive(settings, '');
    const activeIndex = findActiveIndex(entries, active);
    expect(activeIndex).toBe(-1);
    if (settings !== '{}') expect(active?.model).toBe('outside-list');
    const html = render({
      kind: 'ready', state: { entries, groups: groupConfigs(entries), activeIndex },
    });
    expect(html).toContain('<h2>未匹配到激活配置</h2>');
    expect(html).toContain('settings.json 中的配置优先用于识别激活状态。');
    expect(html).not.toContain('均为空');
    expect(html).toContain('fixture-model');
    expect(html).toContain('~/change-ai-config.json');
    expect(html).toContain('当前仅支持 macOS 写入');
  });
});

describe('Env 复制平台说明', () => {
  const writeText = vi.fn();
  const entries = [{
    model: 'fixture-model', base_url: 'https://example.invalid',
    key: 'fixture-key', channel: 'fixture-channel',
  }];

  function renderPlatform(platform: string | undefined, activeIndex = 0) {
    writeText.mockClear();
    vi.stubGlobal('window', platform === undefined
      ? undefined : { desktop: { platform, clipboard: { writeText } } });
    const html = render({
      kind: 'ready', state: { entries, groups: groupConfigs(entries), activeIndex },
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(html).toContain('当前仅支持 macOS 写入');
    expect(html).toContain('不修改 settings.json');
    return html;
  }

  afterEach(() => vi.unstubAllGlobals());

  it.each(['darwin', 'linux'])('%s 保留 export 说明', platform => {
    const html = renderPlatform(platform);
    expect(html).toContain('title="复制 7 行 ANTHROPIC_* export"');
    expect(html).not.toContain('PowerShell');
  });

  it('Windows tooltip 与常驻说明明确版本、会话和空值语义', () => {
    const html = renderPlatform('win32');
    expect(html).toContain('title="复制 7 行 PowerShell 当前会话赋值文本（不持久化）"');
    expect(html).not.toContain('复制 7 行 ANTHROPIC_* export');
    expect(html).toContain('PowerShell 5.1 / 7.x');
    expect(html).toContain('不会自动执行；执行后仅影响当前会话，不写入持久配置。');
    expect(html).toContain('空值在 5.1、7.0–7.4 中删除对应环境变量，7.5 起保留为空字符串。');
    expect(html).not.toContain('toast-');
  });

  it('Windows 无激活条目时也显示兼容说明', () => {
    const html = renderPlatform('win32', -1);
    expect(html).toContain('未匹配到激活配置');
    expect(html).toContain('PowerShell 5.1 / 7.x');
    expect(html).toContain('7.5 起保留为空字符串');
  });

  it.each([undefined, '', 'freebsd'])('未知平台或无 window %# 不假定 shell', platform => {
    const html = renderPlatform(platform);
    expect(html).toContain('title="当前平台未知或不受支持，无法复制 Env"');
    expect(html).not.toContain('复制 7 行 ANTHROPIC_* export');
    expect(html).not.toContain('PowerShell');
  });
});
