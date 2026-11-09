import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigEntry } from '../applyConfig';
import { loadConfigState, useConfigState, type ConfigState } from '../configStore';
import { ApiError, applyModelConfig, getConfigState } from '../apiClient';

vi.mock('../apiClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../apiClient')>(),
  applyModelConfig: vi.fn(),
  getConfigState: vi.fn(),
}));

const entry: ConfigEntry = {
  model: 'test-model',
  base_url: 'https://example.invalid',
  key: 'test-key',
  channel: 'test',
};
const previous = { ...entry, model: 'previous-model' };
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
  vi.resetAllMocks();
  vi.mocked(getConfigState).mockResolvedValue(state);
  vi.mocked(applyModelConfig).mockResolvedValue(undefined);
});

describe('本机 API 配置状态', () => {
  it('直接返回服务端分组与激活态，不暴露原始配置文本', async () => {
    expect(await loadConfigState()).toBe(state);
    expect(await loadConfigState()).not.toHaveProperty('configText');
    expect(getConfigState).toHaveBeenCalledTimes(2);
  });

  it('读取失败保留 API 错误，交由状态层处理', async () => {
    const error = new ApiError('INVALID_CONFIG', '配置列表格式或写入值无效。');
    vi.mocked(getConfigState).mockRejectedValueOnce(error);

    await expect(loadConfigState()).rejects.toBe(error);
  });

  it('等待写入成功后才刷新，不预先读取或乐观更改激活态', async () => {
    let finish!: () => void;
    vi.mocked(applyModelConfig).mockImplementationOnce(() => new Promise<void>(resolve => {
      finish = resolve;
    }));

    const result = getActions().applyModel(entry);
    expect(applyModelConfig).toHaveBeenCalledExactlyOnceWith(entry);
    expect(getConfigState).not.toHaveBeenCalled();
    finish();

    await expect(result).resolves.toBe(true);
    expect(getConfigState).toHaveBeenCalledTimes(1);
    expect(state.activeIndex).toBe(0);
    expect(await loadConfigState()).toBe(state);
  });

  it.each(['CONFLICT', 'WRITE_UNCERTAIN', 'SESSION_EXPIRED'])(
    '写入失败 %s 不刷新或重放请求',
    async code => {
      const error = new ApiError(code, '安全错误提示');
      vi.mocked(applyModelConfig).mockRejectedValueOnce(error);

      await expect(getActions().applyModel(entry)).rejects.toBe(error);

      expect(applyModelConfig).toHaveBeenCalledExactlyOnceWith(entry);
      expect(getConfigState).not.toHaveBeenCalled();
    },
  );

  it('写入成功但刷新失败时返回 false，不伪装成写入失败或重放', async () => {
    vi.mocked(getConfigState).mockRejectedValueOnce(
      new ApiError('NETWORK_ERROR', '无法连接本机服务。'),
    );

    await expect(getActions().applyModel(entry)).resolves.toBe(false);

    expect(applyModelConfig).toHaveBeenCalledExactlyOnceWith(entry);
    expect(getConfigState).toHaveBeenCalledTimes(1);
  });

  it('显式刷新成功返回 true，不触发写入', async () => {
    await expect(getActions().reload()).resolves.toBe(true);

    expect(getConfigState).toHaveBeenCalledTimes(1);
    expect(applyModelConfig).not.toHaveBeenCalled();
  });

  it('未知刷新异常收敛为失败结果，不触发写入', async () => {
    vi.mocked(getConfigState).mockRejectedValueOnce(new Error('private-marker'));

    await expect(getActions().reload()).resolves.toBe(false);

    expect(applyModelConfig).not.toHaveBeenCalled();
  });
});
