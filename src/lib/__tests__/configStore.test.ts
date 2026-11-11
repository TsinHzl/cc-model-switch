import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigBridge } from '../../../electron/configBridge';
import type { ConfigEntry } from '../applyConfig';
import { loadConfigState, useConfigState, type ConfigState } from '../configStore';
import { ApiError } from '../apiClient';

const entry: ConfigEntry = {
  model: 'test-model',
  base_url: 'https://example.invalid',
  key: 'test-key',
  channel: 'test',
};
const previous = { ...entry, model: 'previous-model' };
const expected = { model: entry.model, base_url: entry.base_url, key: entry.key };
const invoke = vi.fn<(channel: string, body: unknown) => Promise<unknown>>();
const fetchMock = vi.fn<typeof fetch>();
const state: ConfigState = {
  entries: [previous, entry],
  groups: [{
    url: entry.base_url,
    channels: [{
      channel: entry.channel,
      items: [{ entry: previous, index: 0 }, { entry, index: 1 }],
    }],
  }],
  activeIndex: 0,
};

// 用真实 React 渲染取得回调；不模拟浏览器挂载或断言 UI 生命周期。
function getActions() {
  const captured: ReturnType<typeof useConfigState>[] = [];
  function Probe() {
    captured.push(useConfigState());
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return captured[0]!;
}

beforeEach(() => {
  invoke.mockReset();
  fetchMock.mockReset();
  invoke.mockImplementation(async channel => channel === 'config:state'
    ? { success: true, data: state } : { success: true });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    desktop: { platform: 'darwin', config: createConfigBridge(invoke) },
  });
});

afterEach(() => {
  try {
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

describe('桌面桥接配置状态', () => {
  it('直接返回服务端分组与激活态，不暴露原始配置文本', async () => {
    expect(await loadConfigState()).toEqual(state);
    expect(await loadConfigState()).not.toHaveProperty('configText');
    expect(invoke.mock.calls).toEqual([['config:state', {}], ['config:state', {}]]);
  });

  it('读取失败保留 API 错误，交由状态层处理', async () => {
    invoke.mockResolvedValueOnce({ success: false, code: 'INVALID_CONFIG', cleanupFailed: false });

    const result = loadConfigState();
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('等待写入成功后才刷新，不预先读取或乐观更改激活态', async () => {
    let finish!: (value: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise<unknown>(resolve => {
      finish = resolve;
    }));

    const result = getActions().applyModel(entry);
    expect(invoke.mock.calls).toEqual([['config:apply', { expected }]]);
    finish({ success: true });

    await expect(result).resolves.toBe(true);
    expect(invoke.mock.calls).toEqual([['config:apply', { expected }], ['config:state', {}]]);
    expect(state.activeIndex).toBe(0);
    expect(await loadConfigState()).toEqual(state);
  });

  it.each(['CONFLICT', 'WRITE_UNCERTAIN', 'RATE_LIMITED', 'IPC_ERROR'])(
    '写入失败 %s 不刷新或重放请求',
    async code => {
      if (code === 'IPC_ERROR') invoke.mockRejectedValueOnce(new Error('private-marker'));
      else invoke.mockResolvedValueOnce({ success: false, code, cleanupFailed: false });

      await expect(getActions().applyModel(entry)).rejects.toMatchObject({ name: 'ApiError', code });

      expect(invoke.mock.calls).toEqual([['config:apply', { expected }]]);
    },
  );

  it('写入成功但刷新失败时返回 false，不伪装成写入失败或重放', async () => {
    invoke.mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('private-marker'));

    const actions = getActions();
    await expect(actions.applyModel(entry)).resolves.toBe(false);

    expect(invoke.mock.calls).toEqual([['config:apply', { expected }], ['config:state', {}]]);
    await expect(actions.reload()).resolves.toBe(true);
    expect(invoke.mock.calls).toEqual([
      ['config:apply', { expected }], ['config:state', {}], ['config:state', {}],
    ]);
  });

  it('显式刷新成功返回 true，不触发写入', async () => {
    await expect(getActions().reload()).resolves.toBe(true);

    expect(invoke.mock.calls).toEqual([['config:state', {}]]);
  });

  it('未知刷新异常收敛为失败结果，不触发写入', async () => {
    invoke.mockRejectedValueOnce(new Error('private-marker'));

    await expect(getActions().reload()).resolves.toBe(false);

    expect(invoke.mock.calls).toEqual([['config:state', {}]]);
  });
});
