import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const token = 'a'.repeat(64);
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
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json' },
  });
const fetchMock = vi.fn<typeof fetch>();
let client: typeof import('../apiClient');

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  client = await import('../apiClient');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bootstrap() {
  fetchMock.mockResolvedValueOnce(json({ success: true, data: { token } }));
}

describe('同源 API 客户端', () => {
  it('校验状态响应并使用仅内存会话与同源请求选项', async () => {
    bootstrap();
    fetchMock.mockResolvedValueOnce(json({ success: true, data: state }));

    expect(await client.getConfigState()).toEqual(state);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/bootstrap', {
      headers: { 'x-ccms-bootstrap': '1' },
      mode: 'same-origin', credentials: 'same-origin',
      redirect: 'error', cache: 'no-store',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/state', {
      headers: { 'x-ccms-token': token },
      mode: 'same-origin', credentials: 'same-origin',
      redirect: 'error', cache: 'no-store',
    });
  });

  it('并发读取共用一次 bootstrap', async () => {
    bootstrap();
    fetchMock.mockResolvedValueOnce(json({ success: true, data: state }));
    fetchMock.mockResolvedValueOnce(json({ success: true, data: state }));

    expect(await Promise.all([
      client.getConfigState(), client.getConfigState(),
    ])).toEqual([state, state]);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/bootstrap', '/api/state', '/api/state',
    ]);
  });

  it.each([
    ['apply', '/api/apply', 'POST', { expected }],
    ['add', '/api/entries', 'POST', { entry }],
    ['update', '/api/entries/2', 'PATCH', { expected, entry }],
    ['delete', '/api/entries/2', 'DELETE', { expected }],
  ] as const)('按业务协议发送 %s，204 不解析 JSON', async (operation, path, method, body) => {
    bootstrap();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const supplied = { ...entry, extra: '不得发送' };
    const actions = {
      apply: () => client.applyModelConfig(supplied),
      add: () => client.addEntry(supplied),
      update: () => client.updateEntry(2, supplied, supplied),
      delete: () => client.deleteEntry(2, supplied),
    };

    await expect(actions[operation]()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenNthCalledWith(2, path, {
      method,
      headers: { 'content-type': 'application/json', 'x-ccms-token': token },
      body: JSON.stringify(body),
      mode: 'same-origin', credentials: 'same-origin',
      redirect: 'error', cache: 'no-store',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['CONFLICT', 'WRITE_UNCERTAIN', 'RATE_LIMITED'])(
    '保留业务错误码 %s，不自动重放写请求',
    async code => {
      bootstrap();
      fetchMock.mockResolvedValueOnce(json({ success: false, code, error: '安全错误提示' }, 409));

      await expect(client.deleteEntry(0, entry)).rejects.toMatchObject({
        name: 'ApiError', code, message: '安全错误提示',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('会话失效后不重新 bootstrap 或自动重放写请求', async () => {
    bootstrap();
    for (let i = 0; i < 2; i++) {
      fetchMock.mockResolvedValueOnce(json({
        success: false, code: 'SESSION_EXPIRED', error: '请刷新网页后重试。',
      }, 403));
    }

    await expect(client.applyModelConfig(entry)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(client.applyModelConfig(entry)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/bootstrap', '/api/apply', '/api/apply',
    ]);
  });

  it('写入时网络中断提示结果不确定，不暴露异常原文或重放', async () => {
    bootstrap();
    fetchMock.mockRejectedValueOnce(new Error('private-marker'));

    await expect(client.addEntry(entry)).rejects.toMatchObject({
      code: 'WRITE_UNCERTAIN',
      message: '请求结果无法确认，请刷新状态后检查；不要直接重复写入。',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('bootstrap 失败后允许下一次显式读取重新连接', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private-marker'));
    await expect(client.getConfigState()).rejects.toMatchObject({
      code: 'NETWORK_ERROR', message: '无法连接本机服务，请确认服务已启动。',
    });
    bootstrap();
    fetchMock.mockResolvedValueOnce(json({ success: true, data: state }));

    expect(await client.getConfigState()).toEqual(state);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/bootstrap', '/api/bootstrap', '/api/state',
    ]);
  });

  it.each([
    { success: true, data: { token: 'invalid' } },
    { success: true, data: { token: 123 } },
    { success: false, data: { token } },
  ])('拒绝不合法 bootstrap 响应 %#', async value => {
    fetchMock.mockResolvedValueOnce(json(value));

    await expect(client.getConfigState()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...state, activeIndex: 1 },
    { ...state, entries: [{ ...entry, key: null }] },
    { ...state, groups: [{ url: entry.base_url, channels: [{
      channel: entry.channel, items: [{ entry, index: 1 }],
    }] }] },
    { ...state, groups: null },
  ])('拒绝无法安全渲染的状态响应 %#', async value => {
    bootstrap();
    fetchMock.mockResolvedValueOnce(json({ success: true, data: value }));

    await expect(client.getConfigState()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('接受空列表及无激活状态', async () => {
    const empty = { entries: [], groups: [], activeIndex: -1 };
    bootstrap();
    fetchMock.mockResolvedValueOnce(json({ success: true, data: empty }));

    expect(await client.getConfigState()).toEqual(empty);
  });

  it.each([200, 500])('不展示非 JSON 响应原文（HTTP %s）', async status => {
    bootstrap();
    fetchMock.mockResolvedValueOnce(new Response('private-marker', { status }));

    await expect(client.getConfigState()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE', message: '本机服务响应无效，请刷新网页确认状态。',
    });
  });

  it('写接口返回非 204 时不宣称成功，也不重放', async () => {
    bootstrap();
    fetchMock.mockResolvedValueOnce(json({ success: true }));

    await expect(client.addEntry(entry)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
