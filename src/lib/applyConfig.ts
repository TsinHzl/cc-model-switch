/* 配置应用纯函数：zshrc 标记块管理 / settings.json env 键管理（与 ~/change-ai-config.sh 逐字节兼容） */
import { shellQuote } from './shellQuote';

export const MARKER_BEGIN = '# >>> change-ai-config >>>';
export const MARKER_END = '# <<< change-ai-config <<<';

/** sh 脚本写入的 7 个 ANTHROPIC_* 键 */
export const ANTHROPIC_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

export interface ConfigEntry {
  base_url: string;
  key: string;
  model: string;
  channel: string;
}

export function buildExportLines(entry: ConfigEntry): string[] {
  return [
    `export ANTHROPIC_MODEL=${shellQuote(entry.model)}`,
    `export ANTHROPIC_BASE_URL=${shellQuote(entry.base_url)}`,
    `export ANTHROPIC_AUTH_TOKEN=${shellQuote(entry.key)}`,
    `export ANTHROPIC_SMALL_FAST_MODEL=${shellQuote(entry.model)}`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${shellQuote(entry.model)}`,
    `export ANTHROPIC_DEFAULT_SONNET_MODEL=${shellQuote(entry.model)}`,
    `export ANTHROPIC_DEFAULT_HAIKU_MODEL=${shellQuote(entry.model)}`,
  ];
}

/** 删除 zshrc 中已存在的标记块（幂等，对应 sh 脚本 remove_zshrc_block） */
export function removeZshrcBlock(zshrc: string): string {
  const re = new RegExp(
    `^${escapeRe(MARKER_BEGIN)}\\n[\\s\\S]*?^${escapeRe(MARKER_END)}\\n?`,
    'gm',
  );
  return zshrc.replace(re, '');
}

/** 标记块插入 zshrc 最前面（对应 sh 脚本"配置块置于文件最前面"） */
export function insertZshrcBlock(zshrc: string, entry: ConfigEntry): string {
  const rest = removeZshrcBlock(zshrc);
  const block = [
    MARKER_BEGIN,
    ...buildExportLines(entry),
    MARKER_END,
  ].join('\n');
  // 与 sh 一致：块后换行 + 原文件内容（rest 可能以换行开头，保持原样拼接）
  return `${block}\n${rest}`;
}

/** settings.json 文本 → env 块中写入 7 键（保留其他内容）；返回新文本 */
export function applyToSettingsJson(settingsText: string, entry: ConfigEntry): string {
  const parsed = JSON.parse(settingsText) as Record<string, unknown>;
  const env = (parsed.env && typeof parsed.env === 'object' ? parsed.env : {}) as Record<string, unknown>;
  for (const k of ANTHROPIC_KEYS) {
    env[k] = k === 'ANTHROPIC_BASE_URL' ? entry.base_url : k === 'ANTHROPIC_AUTH_TOKEN' ? entry.key : entry.model;
  }
  const next = { ...parsed, env };
  // jq --indent 2 输出格式：2 空格缩进 + 末尾换行
  return `${JSON.stringify(next, null, 2)}\n`;
}

/** settings.json 文本 → 删除 env 块中 7 键（对应 sh 脚本 remove_settings_env_keys；env 空则保留空对象） */
export function cleanSettingsEnvKeys(settingsText: string): string {
  const parsed = JSON.parse(settingsText) as Record<string, unknown>;
  if (!parsed.env || typeof parsed.env !== 'object') return settingsText;
  const env = { ...(parsed.env as Record<string, unknown>) };
  for (const k of ANTHROPIC_KEYS) delete env[k];
  const next = { ...parsed, env };
  return `${JSON.stringify(next, null, 2)}\n`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
