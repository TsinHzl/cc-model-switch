import { buildEnvironmentEntries, buildExportLines, type ConfigEntry } from './applyConfig';
import { writeClipboardText } from './clipboardClient';

type EnvClipboardResult =
  | { ok: true; format: 'shell' | 'powershell'; text: string }
  | { ok: false; code: 'UNSUPPORTED_PLATFORM' | 'INVALID_VALUE' };

function powerShellValue(value: string): string {
  const literal = value.replace(/'/g, "''").replace(
    /[\x01-\x1f\x7f-\x9f\u{2018}-\u{201b}\u{2028}\u{2029}]/gu,
    char => `' + [char]0x${char.charCodeAt(0).toString(16).padStart(4, '0')} + '`,
  );
  return `('${literal}')`;
}

/** 仅生成当前会话赋值文本，不执行、不持久化；空值遵循目标 PowerShell 版本语义。 */
export function formatEnvClipboard(
  entry: ConfigEntry,
  platform: string | undefined,
): EnvClipboardResult {
  if (platform === 'darwin' || platform === 'linux') {
    return { ok: true, format: 'shell', text: `${buildExportLines(entry).join('\n')}\n` };
  }
  if (platform !== 'win32') return { ok: false, code: 'UNSUPPORTED_PLATFORM' };
  const entries = buildEnvironmentEntries(entry);
  if (entries.some(([, value]) => /[\x00\ud800-\udfff]/u.test(value))) {
    return { ok: false, code: 'INVALID_VALUE' };
  }
  const lines = entries.map(([key, value]) => `$env:${key} = ${powerShellValue(value)}`);
  return { ok: true, format: 'powershell', text: `${lines.join('\n')}\n` };
}

/** 格式化拒绝时不提交；已提交操作等待客户端完成，不自动重试。 */
export async function copyEnvToClipboard(
  entry: ConfigEntry,
  platform: string | undefined,
): Promise<EnvClipboardResult> {
  const result = formatEnvClipboard(entry, platform);
  if (result.ok) await writeClipboardText(result.text);
  return result;
}
