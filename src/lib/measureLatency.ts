const REQUEST_TIMEOUT_MS = 5_000;

/** 网关常用 302 跳登录页且不带 CORS 头；测速只需 RTT，
    故用 no-cors 跟随重定向，避免跨源读取限制把可用网关误判为失败。 */
async function probe(url: string, method: 'HEAD' | 'GET'): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = performance.now();
  try {
    await fetch(url, {
      method,
      mode: 'no-cors',
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      redirect: 'follow',
    });
    return Math.round(performance.now() - start);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 仅测 HTTP(S) 响应时延；HEAD 异常时回退 GET，每次请求最多等待 5 秒。 */
export async function measureLatency(url: string): Promise<number | null> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(target.protocol)
    || target.username || target.password
  ) return null;

  return (await probe(target.href, 'HEAD')) ?? probe(target.href, 'GET');
}

/** 测速失败不展示原始异常；数值沿用现有快慢分级。 */
export function latencyText(ms: number | null | undefined): string {
  if (ms === undefined) return '测速中…';
  if (ms === null) return '测速失败';
  if (ms < 80) return `${ms}ms 响应极快`;
  if (ms < 300) return `${ms}ms 响应较快`;
  return `${ms}ms`;
}
