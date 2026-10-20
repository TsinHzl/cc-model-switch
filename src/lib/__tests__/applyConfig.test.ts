import { describe, it, expect } from 'vitest';
import {
  MARKER_BEGIN,
  MARKER_END,
  ANTHROPIC_KEYS,
  buildExportLines,
  removeZshrcBlock,
  insertZshrcBlock,
  applyToSettingsJson,
  cleanSettingsEnvKeys,
  type ConfigEntry,
} from '../applyConfig';

const entry: ConfigEntry = {
  base_url: 'https://kiro2ccproxy.zeabur.app',
  key: 'sk-38xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  model: 'claude-opus-5',
  channel: 'kiro反代cc专属',
};

describe('zshrc 标记块', () => {
  it('7 个键与 sh 脚本一致', () => {
    expect(ANTHROPIC_KEYS).toHaveLength(7);
    expect(buildExportLines(entry)).toEqual([
      'export ANTHROPIC_MODEL=claude-opus-5',
      'export ANTHROPIC_BASE_URL=https://kiro2ccproxy.zeabur.app',
      'export ANTHROPIC_AUTH_TOKEN=sk-38xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'export ANTHROPIC_SMALL_FAST_MODEL=claude-opus-5',
      'export ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5',
      'export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-opus-5',
      'export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-opus-5',
    ]);
  });

  it('插入到文件最前面，原内容保留', () => {
    const zshrc = '# 原有内容\nexport PATH=/usr/bin\n';
    const out = insertZshrcBlock(zshrc, entry);
    expect(out.startsWith(`${MARKER_BEGIN}\n`)).toBe(true);
    expect(out).toContain(MARKER_END);
    expect(out).toContain('# 原有内容');
    expect(out).toContain('export PATH=/usr/bin');
  });

  it('重复插入幂等（旧块先删除）', () => {
    const once = insertZshrcBlock('# tail\n', entry);
    const twice = insertZshrcBlock(once, entry);
    expect(twice.match(new RegExp(MARKER_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(twice.endsWith('# tail\n')).toBe(true);
  });

  it('removeZshrcBlock 删除既有块', () => {
    const withBlock = insertZshrcBlock('# tail\n', entry);
    const removed = removeZshrcBlock(withBlock);
    expect(removed).toBe('# tail\n');
    expect(removeZshrcBlock('# no block here\n')).toBe('# no block here\n');
  });
});

describe('settings.json env 键管理（jq --indent 2 基准）', () => {
  const base = '{\n  "permissions": {\n    "allow": [\n      "Bash"\n    ]\n  },\n  "other": 1\n}\n';

  it('写入 7 键且保留其他内容（格式 = jq --indent 2 + 末尾换行）', () => {
    const out = applyToSettingsJson(base, entry);
    const parsed = JSON.parse(out) as { env: Record<string, string>; permissions: unknown; other: number };
    expect(parsed.env.ANTHROPIC_MODEL).toBe('claude-opus-5');
    expect(parsed.env.ANTHROPIC_BASE_URL).toBe('https://kiro2ccproxy.zeabur.app');
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-38xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(parsed.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('claude-opus-5');
    expect(Object.keys(parsed.env)).toHaveLength(7);
    expect(parsed.other).toBe(1);
    expect(parsed.permissions).toEqual({ allow: ['Bash'] });
    // 实测 jq 输出：2 空格缩进、数组展开、末尾单个换行
    expect(out).toBe(
      JSON.stringify(
        {
          permissions: { allow: ['Bash'] },
          other: 1,
          env: {
            ANTHROPIC_MODEL: 'claude-opus-5',
            ANTHROPIC_BASE_URL: 'https://kiro2ccproxy.zeabur.app',
            ANTHROPIC_AUTH_TOKEN: 'sk-38xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
            ANTHROPIC_SMALL_FAST_MODEL: 'claude-opus-5',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-opus-5',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-opus-5',
          },
        },
        null,
        2,
      ) + '\n',
    );
  });

  it('无 env 块时创建 env', () => {
    const out = applyToSettingsJson('{"a":1}', entry);
    expect((JSON.parse(out) as { env: object }).env).toBeTruthy();
  });

  it('cleanSettingsEnvKeys 删除 7 键、保留其他 env 键', () => {
    const withEnv = applyToSettingsJson(base, entry);
    const cleaned = cleanSettingsEnvKeys(withEnv);
    const parsed = JSON.parse(cleaned) as { env: Record<string, string>; other: number };
    expect(parsed.env).toEqual({});
    expect(parsed.other).toBe(1);
  });

  it('无 env 块时 clean 原样返回', () => {
    const noEnv = '{"a":1}\n';
    expect(cleanSettingsEnvKeys(noEnv)).toBe(noEnv);
  });

  it('损坏 JSON 抛错（不静默）', () => {
    expect(() => applyToSettingsJson('{broken', entry)).toThrow();
  });
});
