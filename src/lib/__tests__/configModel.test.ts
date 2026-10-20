import { describe, it, expect } from 'vitest';
import {
  groupConfigs,
  readActiveFromSettings,
  readActiveFromZshrc,
  readActive,
  findActiveIndex,
} from '../configModel';
import { insertZshrcBlock, type ConfigEntry } from '../applyConfig';

// ~/change-ai-config.json 结构快照（2026-10-20 实测 46 条，原序；key 已替换为等长占位防泄露，url/model/channel 保留真实值）
const REAL_ENTRIES: ConfigEntry[] = [
  ...Array.from({ length: 4 }, (_, i) => ({
    base_url: 'https://kiro2ccproxy.zeabur.app',
    key: 'sk-38xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    model: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-opus-5'][i]!,
    channel: 'kiro反代cc专属',
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    base_url: 'https://kiro2ccproxy.zeabur.app',
    key: 'sk-9dxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    model: ['claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5'][i]!,
    channel: 'kiro反代cc专属-个人',
  })),
  { base_url: 'https://kiro2ccproxy.zeabur.app', key: 'sk-9dxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'gpt-5.6-terra', channel: 'kiro反代cc 专属-个人' },
  { base_url: 'https://kiro2ccproxy.zeabur.app', key: 'sk-9dxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'gpt-5.6-luna', channel: 'kiro反代cc 专属-个人' },
  ...Array.from({ length: 8 }, (_, i) => ({
    base_url: 'http://127.0.0.1:5678',
    key: 'sk-b8xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    model: ['claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-sonnet-5', 'claude-opus-5', 'claude-opus-5-5', 'gpt-5.6-luna'][i]!,
    channel: 'kiro反代cc本地',
  })),
  { base_url: 'http://127.0.0.1:5678', key: 'sk-b8xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'kimi-k3', channel: 'kiro反代cc本地' },
  { base_url: 'https://aihouse.zeabur.app', key: 'sk-Vpxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'claude-opus-5', channel: 'aihouse' },
  { base_url: 'https://aihouse.zeabur.app', key: 'sk-Vpxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'claude-sonnet-4-6', channel: 'aihouse' },
  { base_url: 'https://aihouse.zeabur.app', key: 'sk-Vpxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'claude-sonnet-5', channel: 'aihouse' },
  { base_url: 'https://aihouse.zeabur.app', key: 'sk-e5xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'gemini-3.8-flash-tiered', channel: 'aihouse' },
  { base_url: 'http://43.153.11.66:12345', key: 'sk-agxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'claude-sonnet-4-6', channel: '反重力' },
  { base_url: 'http://43.153.11.66:12345', key: 'sk-agxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'gemini-3.8-flash-high', channel: '反重力' },
  { base_url: 'https://api.taotoken.net/coding', key: 'sk-jexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'glm-5.3-flash', channel: 'taotoken' },
  { base_url: 'https://api.taotoken.net/coding', key: 'sk-jexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'deepseek-v4-flash', channel: 'taotoken' },
  { base_url: 'https://api.apikey.fan', key: 'sk-56xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'claude-sonnet-5', channel: 'fan' },
  { base_url: 'https://api.apikey.fan', key: 'sk-d5xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'deepseek-flash', channel: 'fan' },
  { base_url: 'https://open.bigmodel.cn/api/anthropic', key: '9e82xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'glm-5.3-flash', channel: 'z.ai' },
  { base_url: 'https://open.bigmodel.cn/api/anthropic', key: '9e82xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'glm-5.3', channel: 'z.ai' },
  { base_url: 'http://43.153.11.66:8788', key: 'd2ffxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'deepseek-v4.1-flash', channel: 'workbuddy-global' },
  { base_url: 'http://43.153.11.66:8788', key: 'd2ffxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'glm-5.3', channel: 'workbuddy-global' },
  { base_url: 'http://43.153.11.66:8788', key: '74e6xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'deepseek-v4.1-flash', channel: 'workbuddy-internal' },
  { base_url: 'http://43.153.11.66:8788', key: '74e6xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'glm-5.3', channel: 'workbuddy-internal' },
  { base_url: 'http://127.0.0.1:51818', key: 'sk-76xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'glm-5.3-flash', channel: 'codearts' },
  { base_url: 'http://127.0.0.1:51818', key: 'sk-76xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'glm-5.3', channel: 'codearts' },
  { base_url: 'http://127.0.0.1:51818', key: 'sk-76xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'deepseek-v4.1-flash', channel: 'codearts' },
  { base_url: 'http://127.0.0.1:51818', key: 'sk-76xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'deepseek-v4-pro-0813', channel: 'codearts' },
  { base_url: 'http://127.0.0.1:7864', key: 'dev-xxxxxxxxxxxxxx', model: 'deepseek-v4.1-flash', channel: 'trae' },
  { base_url: 'http://127.0.0.1:7864', key: 'dev-xxxxxxxxxxxxxx', model: 'glm-5.3', channel: 'trae' },
  { base_url: 'http://43.153.11.66:8989', key: 'sk-81xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'gpt-5.6-sol', channel: 'codex' },
  { base_url: 'http://43.153.11.66:8989', key: 'sk-81xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'gpt-6.1-sol', channel: 'codex' },
  { base_url: 'http://43.153.11.66:8989', key: 'sk-81xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', model: 'gpt-6-astra', channel: 'codex' },
];

describe('groupConfigs — 真实配置分组快照', () => {
  const groups = groupConfigs(REAL_ENTRIES);

  it('共 46 条、11 个 URL 组（真实文件实测）', () => {
    expect(REAL_ENTRIES).toHaveLength(46);
    expect(new Set(REAL_ENTRIES.map((e) => e.base_url)).size).toBe(11);
    expect(groups).toHaveLength(11);
    expect(groups.map((g) => g.url)).toEqual([
      'https://kiro2ccproxy.zeabur.app',
      'http://127.0.0.1:5678',
      'https://aihouse.zeabur.app',
      'http://43.153.11.66:12345',
      'https://api.taotoken.net/coding',
      'https://api.apikey.fan',
      'https://open.bigmodel.cn/api/anthropic',
      'http://43.153.11.66:8788',
      'http://127.0.0.1:51818',
      'http://127.0.0.1:7864',
      'http://43.153.11.66:8989',
    ]);
  });

  it('一级 URL 内按 channel 二级分组，同 channel 条目按出现顺序排列', () => {
    const kiro = groups.find((g) => g.url === 'https://kiro2ccproxy.zeabur.app')!;
    expect(kiro.channels.map((c) => c.channel)).toEqual([
      'kiro反代cc专属',
      'kiro反代cc专属-个人',
      'kiro反代cc 专属-个人',
    ]);
    expect(kiro.channels[0]!.items).toHaveLength(4);
    expect(kiro.channels[1]!.items).toHaveLength(6);
  });

  it('总条目数守恒', () => {
    const total = groups.reduce((n, g) => n + g.channels.reduce((m, c) => m + c.items.length, 0), 0);
    expect(total).toBe(46);
  });

  it('空 channel 回退"默认渠道"（与 sh python 逻辑一致）', () => {
    const [g] = groupConfigs([{ base_url: 'u', key: 'k', model: 'm', channel: '' }]);
    expect(g!.channels[0]!.channel).toBe('默认渠道');
  });
});

describe('激活态判定', () => {
  const target = REAL_ENTRIES[3]!; // kiro / claude-opus-5

  it('settings env 三元组精确命中', () => {
    const settings = JSON.stringify({
      env: { ANTHROPIC_MODEL: target.model, ANTHROPIC_BASE_URL: target.base_url, ANTHROPIC_AUTH_TOKEN: target.key },
    });
    expect(findActiveIndex(REAL_ENTRIES, readActive(settings, ''))).toBe(3);
  });

  it('env 为空 → 回退 zshrc 标记块命中（sh 行为：env 清空后走 zshrc）', () => {
    const zshrc = insertZshrcBlock('# tail\n', target);
    expect(findActiveIndex(REAL_ENTRIES, readActive('{}', zshrc))).toBe(3);
  });

  it('边界：env 三元组不完整（仅 model）→ 不与完整配置项匹配', () => {
    const settings = JSON.stringify({ env: { ANTHROPIC_MODEL: target.model } });
    // env 非空但 url/key 缺失 → 不等于任何完整三元组 → 无命中
    expect(findActiveIndex(REAL_ENTRIES, readActiveFromSettings(settings))).toBe(-1);
  });

  it('三元组任一不同即不命中（sh：model==cur_model && url==cur_url && key==cur_key）', () => {
    const settings = JSON.stringify({
      env: { ANTHROPIC_MODEL: target.model, ANTHROPIC_BASE_URL: target.base_url, ANTHROPIC_AUTH_TOKEN: 'other-key' },
    });
    expect(findActiveIndex(REAL_ENTRIES, readActiveFromSettings(settings))).toBe(-1);
  });

  it('zshrc 无标记块且 settings 空 → 无激活', () => {
    expect(readActive('{}', '# nothing\n')).toBeNull();
  });

  it('zshrc 块值含转义字符可还原（unquote 往返）', () => {
    const special: ConfigEntry = { base_url: 'https://a b.com', key: "k'1", model: 'm 1', channel: 'c' };
    const zshrc = insertZshrcBlock('', special);
    const active = readActiveFromZshrc(zshrc)!;
    expect(active).toEqual({ model: 'm 1', url: 'https://a b.com', key: "k'1" });
  });

  it('settings.json 损坏 → 按 null 处理并回退 zshrc（不抛错，sh 同）', () => {
    const zshrc = insertZshrcBlock('', target);
    expect(findActiveIndex(REAL_ENTRIES, readActive('{broken', zshrc))).toBe(3);
  });
});
