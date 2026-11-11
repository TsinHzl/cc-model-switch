import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { latencyText, measureLatency } from '../measureLatency';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', { setTimeout, clearTimeout });
  vi.spyOn(performance, 'now').mockReturnValue(0);
});

afterEach(() => {
  try {
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

describe('桌面 renderer 测速', () => {
  it.each(['http://127.0.0.1:12345/', 'https://example.invalid/'])(
    '仅向 HTTP(S) 地址 %s 发送受限 HEAD 请求',
    async (url) => {
      vi.mocked(performance.now).mockReturnValueOnce(100).mockReturnValueOnce(179.4);
      await expect(measureLatency(url)).resolves.toBe(79);
      expect(fetchMock.mock.calls).toEqual([[url, {
        method: 'HEAD',
        signal: expect.any(AbortSignal),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
      }]]);
      const signal = fetchMock.mock.calls[0]![1]!.signal!;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(signal.aborted).toBe(false);
    },
  );

  it.each([
    '', 'not a url', '/relative', '//example.invalid/',
    'file:///fixture', 'data:text/plain,fixture', 'javascript:void(0)',
    'app://renderer/', 'https://user@example.invalid/',
    'https://user:private-marker@example.invalid/',
  ])('拒绝不支持或内嵌凭据的地址 %s，不发请求', async (url) => {
    await expect(measureLatency(url)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('HEAD 异常后仅回退一次 GET，并保留所有请求限制', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private-marker'));
    await expect(measureLatency('https://example.invalid/')).resolves.toBe(0);
    expect(fetchMock.mock.calls).toEqual(
      ['HEAD', 'GET'].map(method => ['https://example.invalid/', {
        method,
        signal: expect.any(AbortSignal),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'error',
      }]),
    );
  });

  it.each([401, 405, 500])('HTTP %s 仍表示收到响应，不回退 GET', async (status) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(measureLatency('https://example.invalid/')).resolves.toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['同步异常', '异步拒绝'])('%s 不泄露错误或无限重试', async (kind) => {
    fetchMock.mockImplementation(() => {
      const error = new Error('private-marker');
      if (kind === '同步异常') throw error;
      return Promise.reject(error);
    });
    const result = await measureLatency('https://example.invalid/');
    expect(result).toBeNull();
    expect(latencyText(result)).toBe('测速失败');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('HEAD 与 GET 分别在五秒超时，并清理全部计时器', async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new Error('private-marker')), {
        once: true,
      });
    }));
    const result = measureLatency('https://example.invalid/');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals).toHaveLength(2);
    expect(signals[1]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signals[1]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeNull();
    expect(signals[1]!.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('测速状态文案', () => {
  it.each([
    [undefined, '测速中…'],
    [null, '测速失败'],
    [0, '0ms 响应极快'],
    [79, '79ms 响应极快'],
    [80, '80ms 响应较快'],
    [299, '299ms 响应较快'],
    [300, '300ms'],
  ])('状态 %s 显示 %s', (value, expected) => {
    expect(latencyText(value)).toBe(expected);
  });
});
