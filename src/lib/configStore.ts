/* 全局配置状态：读取本机 API → 展示分组/激活态 → 提供切换入口 */
import { useCallback, useEffect, useState } from 'react';
import { ApiError, applyModelConfig, getConfigState, type ApiConfigState } from './apiClient';
import type { ConfigEntry } from './applyConfig';

export type ConfigState = ApiConfigState;

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; state: ConfigState }
  | { kind: 'error'; message: string; code: string };

/** 服务端每次读取最新文件，保留 settings 优先的激活态。 */
export async function loadConfigState(): Promise<ConfigState> {
  return getConfigState();
}

export function useConfigState() {
  const [status, setStatus] = useState<LoadStatus>({ kind: 'idle' });

  const reload = useCallback(async (): Promise<boolean> => {
    setStatus((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      setStatus({ kind: 'ready', state: await loadConfigState() });
      return true;
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof ApiError ? err.message : '读取本机配置失败，请重试。',
        code: err instanceof ApiError ? err.code : 'UNKNOWN_ERROR',
      });
      return false;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 写入失败向调用方抛错；写入成功后返回状态刷新结果，不重放写请求。 */
  const applyModel = useCallback(
    async (expected: ConfigEntry): Promise<boolean> => {
      await applyModelConfig(expected);
      return reload();
    },
    [reload],
  );

  return { status, reload, applyModel };
}
