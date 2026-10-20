/* 全局配置状态：读三个授权文件 → 解析分组/激活态 → 提供切换入口 */
import { useCallback, useEffect, useState } from 'react';
import { readFileText, writeFileAtomic } from './fileAccess';
import { cleanSettingsEnvKeys, applyToSettingsJson, insertZshrcBlock, removeZshrcBlock, type ConfigEntry } from './applyConfig';
import { groupConfigs, readActive, findActiveIndex, type GroupedConfig } from './configModel';

export type WriteTarget = 'zshrc' | 'settings';

export interface ConfigState {
  entries: ConfigEntry[];
  groups: GroupedConfig[];
  activeIndex: number;
  /** 磁盘原始文本（JSON 损坏时用于错误态展示） */
  configText: string;
}

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; state: ConfigState }
  | { kind: 'error'; message: string; needAuth?: boolean }
  | { kind: 'json-error'; raw: string };

/** 从磁盘读取三个文件并计算分组与激活态（每次都取最新，防外部修改） */
export async function loadConfigState(): Promise<ConfigState> {
  const configText = await readFileText('config');
  let entries: ConfigEntry[];
  try {
    entries = JSON.parse(configText) as ConfigEntry[];
  } catch (err) {
    throw Object.assign(new Error('change-ai-config.json 不是合法 JSON'), { kind: 'json-error', raw: configText });
  }
  if (!Array.isArray(entries)) throw new Error('change-ai-config.json 顶层不是数组');
  const settingsText = await readFileText('settings');
  const zshrcText = await readFileText('zshrc');
  const active = readActive(settingsText, zshrcText);
  return {
    entries,
    groups: groupConfigs(entries),
    activeIndex: findActiveIndex(entries, active),
    configText,
  };
}

export function useConfigState() {
  const [status, setStatus] = useState<LoadStatus>({ kind: 'idle' });

  const reload = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      setStatus({ kind: 'ready', state: await loadConfigState() });
    } catch (err) {
      if ((err as { kind?: string }).kind === 'json-error') {
        setStatus({ kind: 'json-error', raw: (err as { raw: string }).raw });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', message: msg, needAuth: msg.includes('授权') || msg.includes('Permission') });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 切换模型：按三元组在磁盘最新内容中定位条目（防分组序/并发编辑导致的 index 漂移），写目标文件 + 互斥清理另一目标 */
  const applyModel = useCallback(
    async (expected: ConfigEntry, target: WriteTarget): Promise<void> => {
      const { entries } = await loadConfigState();
      const idx = entries.findIndex(
        (e) => e.model === expected.model && e.base_url === expected.base_url && e.key === expected.key,
      );
      if (idx === -1) {
        throw new Error(`配置项已不存在或已被外部修改（${expected.model}），请刷新后重选`);
      }
      const entry = entries[idx]!;
      if (target === 'zshrc') {
        await writeFileAtomic('zshrc', (latest) => insertZshrcBlock(latest, entry));
        await writeFileAtomic('settings', (latest) => cleanSettingsEnvKeys(latest));
      } else {
        await writeFileAtomic('settings', (latest) => applyToSettingsJson(latest, entry));
        await writeFileAtomic('zshrc', (latest) => removeZshrcBlock(latest));
      }
      await reload();
    },
    [reload],
  );

  return { status, reload, applyModel };
}
