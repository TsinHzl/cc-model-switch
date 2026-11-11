import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfigBridge } from '../../../electron/configBridge';
import { configIpcErrorCodeSchema } from '../configIpcContract';
import * as client from '../apiClient';

const entry = {
  model: 'fixture-model', base_url: 'https://example.invalid',
  key: 'fixture-key', channel: 'fixture-channel',
};
const expected = { model: entry.model, base_url: entry.base_url, key: entry.key };
const state = {
  entries: [entry],
  groups: [{
    url: entry.base_url,
    channels: [{ channel: entry.channel, items: [{ entry, index: 0 }] }],
  }],
  activeIndex: 0,
};
const invoke = vi.fn<(channel: string, body: unknown) => Promise<unknown>>();
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  invoke.mockReset();
  fetchMock.mockReset();
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

describe('桌面配置客户端', () => {
  it('通过固定桥接读取并解析状态，不暴露额外字段', async () => {
    invoke.mockResolvedValueOnce({
      success: true,
      data: { ...state, secret: 'private-marker', entries: [{ ...entry, secret: 'private-marker' }] },
    });

    expect(await client.getConfigState()).toEqual(state);
    expect(invoke.mock.calls).toEqual([['config:state', {}]]);
  });

  it('显式读取每次调用桥接，不新增鉴权或缓存', async () => {
    invoke.mockResolvedValue({ success: true, data: state });

    expect(await Promise.all([
      client.getConfigState(), client.getConfigState(),
    ])).toEqual([state, state]);
    expect(invoke.mock.calls).toEqual([
      ['config:state', {}], ['config:state', {}],
    ]);
  });

  it.each([
    ['apply', 'config:apply', { expected }],
    ['add', 'config:add', { entry }],
    ['update', 'config:edit', { index: 2, expected, entry }],
    ['delete', 'config:remove', { index: 2, expected }],
  ] as const)('按固定通道发送 %s，写成功不读取状态', async (operation, channel, body) => {
    invoke.mockResolvedValueOnce({ success: true });
    const supplied = { ...entry, extra: '不得发送' };
    const actions = {
      apply: () => client.applyModelConfig(supplied),
      add: () => client.addEntry(supplied),
      update: () => client.updateEntry(2, supplied, supplied),
      delete: () => client.deleteEntry(2, supplied),
    };

    await expect(actions[operation]()).resolves.toBeUndefined();
    expect(invoke.mock.calls).toEqual([[channel, body]]);
  });

  it.each(configIpcErrorCodeSchema.options)(
    '保留业务错误码 %s，不自动重放写请求',
    async code => {
      invoke.mockResolvedValueOnce({ success: false, code, cleanupFailed: false });

      await expect(client.deleteEntry(0, entry)).rejects.toMatchObject({
        name: 'ApiError', code, message: expect.any(String),
      });
      expect(invoke.mock.calls).toEqual([['config:remove', { index: 0, expected }]]);
    },
  );

  it('保留不确定写入与清理失败提示', async () => {
    invoke.mockResolvedValueOnce({ success: false, code: 'WRITE_UNCERTAIN', cleanupFailed: true });
    await expect(client.applyModelConfig(entry)).rejects.toMatchObject({
      code: 'WRITE_UNCERTAIN',
      message: '配置可能已写入，请重新读取核对；不要直接重复写入。 文件资源清理失败，需人工检查。',
    });
    expect(invoke.mock.calls).toEqual([['config:apply', { expected }]]);
  });

  it.each(['sync', 'async'])('通信异常 %s 不泄露原文或重放', async mode => {
    invoke.mockImplementationOnce(() => {
      if (mode === 'sync') throw new Error('private-marker');
      return Promise.reject(new Error('private-marker'));
    });
    await expect(client.addEntry(entry)).rejects.toMatchObject({
      code: 'IPC_ERROR',
      message: '配置通信失败，操作结果未知；请重新读取核对，勿自动重试。',
    });
    expect(invoke.mock.calls).toEqual([['config:add', { entry }]]);
  });

  it('通信失败后允许下一次显式读取，不自动重试', async () => {
    invoke.mockRejectedValueOnce(new Error('private-marker'));
    await expect(client.getConfigState()).rejects.toMatchObject({
      code: 'IPC_ERROR',
    });
    expect(invoke.mock.calls).toEqual([['config:state', {}]]);
    invoke.mockResolvedValueOnce({ success: true, data: state });

    expect(await client.getConfigState()).toEqual(state);
    expect(invoke.mock.calls).toEqual([
      ['config:state', {}], ['config:state', {}],
    ]);
  });

  it.each([undefined, {}, { desktop: { platform: 'darwin' } }])(
    '缺少桥接时明确报错且不回退 HTTP %#', async value => {
      vi.stubGlobal('window', value);
      for (const action of [client.getConfigState, () => client.applyModelConfig(entry)]) {
        await expect(action()).rejects.toMatchObject({
          code: 'DESKTOP_UNAVAILABLE',
          message: '桌面配置桥接不可用，请使用桌面应用打开。',
        });
      }
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it('非法索引由真实桥接拒绝，不发送请求', async () => {
    await expect(client.updateEntry(-1, entry, entry)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(client.deleteEntry(0.5, entry)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    { ...state, activeIndex: 1 },
    { ...state, entries: [{ ...entry, key: null }] },
    { ...state, groups: [{ url: entry.base_url, channels: [{
      channel: entry.channel, items: [{ entry, index: 1 }],
    }] }] },
    { ...state, groups: null },
  ])('拒绝无法安全渲染的状态响应 %#', async value => {
    invoke.mockResolvedValueOnce({ success: true, data: value });

    await expect(client.getConfigState()).rejects.toMatchObject({ code: 'IPC_ERROR' });
    expect(invoke.mock.calls).toEqual([['config:state', {}]]);
  });

  it('接受空列表及无激活状态', async () => {
    const empty = { entries: [], groups: [], activeIndex: -1 };
    invoke.mockResolvedValueOnce({ success: true, data: empty });

    expect(await client.getConfigState()).toEqual(empty);
  });

  it.each([
    undefined, 'private-marker', { success: true, data: state },
    { success: false, code: 'private-marker', cleanupFailed: false },
    { success: false, code: 'IO_FAILED', cleanupFailed: false, message: 'private-marker' },
  ])('客户端再次拒绝损坏的桥接响应，不宣称写成功 %#', async value => {
    const add = vi.fn().mockResolvedValue(value);
    vi.stubGlobal('window', { desktop: { config: { add } } });
    await expect(client.addEntry(entry)).rejects.toMatchObject({
      code: 'IPC_ERROR',
      message: '配置通信失败，操作结果未知；请重新读取核对，勿自动重试。',
    });
    expect(add.mock.calls).toEqual([[{ entry }]]);
  });
});
