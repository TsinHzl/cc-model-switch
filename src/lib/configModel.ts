/* 分组与激活态判定（移植 sh 脚本内嵌 python 逻辑） */
import type { ConfigEntry } from './applyConfig';
import { MARKER_BEGIN, MARKER_END, ANTHROPIC_KEYS } from './applyConfig';

/** 与 sh 一致：按 base_url → channel 双级分组，保持 JSON 出现顺序；每条携带原数组下标（分组扁平序 ≠ 数组序） */
export interface GroupedItem {
  entry: ConfigEntry;
  /** 在原 entries 数组中的下标 */
  index: number;
}

export interface GroupedConfig {
  url: string;
  channels: { channel: string; items: GroupedItem[] }[];
}

export function groupConfigs(entries: ConfigEntry[]): GroupedConfig[] {
  const urlOrder: string[] = [];
  const urlMap = new Map<string, Map<string, GroupedItem[]>>();
  entries.forEach((e, index) => {
    const url = e.base_url ?? '';
    const channel = (e.channel ?? '').length > 0 ? e.channel : '默认渠道';
    if (!urlMap.has(url)) {
      urlMap.set(url, new Map());
      urlOrder.push(url);
    }
    const chans = urlMap.get(url)!;
    if (!chans.has(channel)) chans.set(channel, []);
    chans.get(channel)!.push({ entry: e, index });
  });
  return urlOrder.map((url) => ({
    url,
    channels: [...urlMap.get(url)!.entries()].map(([channel, items]) => ({ channel, items })),
  }));
}

export interface ActiveTriple {
  model: string;
  url: string;
  key: string;
}

/** settings.json env 三元组（env 非空但三元组不完整 → 视为无激活，回退 zshrc；与 sh 的 python 判定一致） */
export function readActiveFromSettings(settingsText: string): ActiveTriple | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(settingsText);
  } catch {
    return null;
  }
  const env = (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).env : null) as
    | Record<string, unknown>
    | null
    | undefined;
  if (!env || typeof env !== 'object') return null;
  const model = typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL : '';
  const url = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : '';
  const key = typeof env.ANTHROPIC_AUTH_TOKEN === 'string' ? env.ANTHROPIC_AUTH_TOKEN : '';
  if (!(model || url || key)) return null;
  return { model, url, key };
}

/** zshrc 标记块三元组回退（对应 sh 脚本 eval 标记块环境变量） */
export function readActiveFromZshrc(zshrc: string): ActiveTriple | null {
  const re = new RegExp(`^${escapeRe(MARKER_BEGIN)}\\n([\\s\\S]*?)^${escapeRe(MARKER_END)}`, 'm');
  const m = zshrc.match(re);
  if (!m) return null;
  const env: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const mm = line.match(/^export (ANTHROPIC_[A-Z_]+)=(.*)$/);
    if (mm) env[mm[1]!] = unquoteBash(mm[2]!);
  }
  const model = env.ANTHROPIC_MODEL ?? '';
  const url = env.ANTHROPIC_BASE_URL ?? '';
  const key = env.ANTHROPIC_AUTH_TOKEN ?? '';
  if (!(model || url || key)) return null;
  return { model, url, key };
}

/** 综合：settings 优先，为空/损坏时回退 zshrc */
export function readActive(settingsText: string, zshrcText: string): ActiveTriple | null {
  return readActiveFromSettings(settingsText) ?? readActiveFromZshrc(zshrcText);
}

/** 与 sh 一致：三元组完全相等才算激活（model==cur_model && url==cur_url && key==cur_key） */
export function findActiveIndex(entries: ConfigEntry[], active: ActiveTriple | null): number {
  if (!active) return -1;
  return entries.findIndex(
    (e) => e.model === active.model && e.base_url === active.url && e.key === active.key,
  );
}

/** bash 引用还原：'x' / a'b'c 拼接 / \转义（覆盖 shellQuote 的输出形态） */
function unquoteBash(s: string): string {
  if (!s.includes("'") && !s.includes('\\')) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) {
        out += s.slice(i + 1);
        break;
      }
      out += s.slice(i + 1, end);
      i = end + 1;
      // bash "'\''" 形态：右引号后紧跟 \' 时继续拼接
      if (s[i] === '\\' && s[i + 1] === "'") {
        out += "'";
        i += 2;
      }
    } else if (c === '\\') {
      out += s[i + 1] ?? '';
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { ANTHROPIC_KEYS };
