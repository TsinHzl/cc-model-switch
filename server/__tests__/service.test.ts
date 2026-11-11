import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createService } from '../service.js';
import { createFileStore, type FileKey } from '../files.js';
import type { ConfigEntry } from '../../src/lib/applyConfig';

const unsupported = process.platform !== 'darwin'
  || process.getuid?.() === 0 || process.geteuid?.() === 0;
const A: ConfigEntry = {
  model: 'model-a', base_url: 'https://example.invalid/a',
  key: 'fixture-only-key-a', channel: 'channel-a',
};
const B = { ...A, model: 'model-b', extra: { preserve: true } };
const ZSHRC = '# service-fixture\n';
const APPLIED_A = [
  '# >>> change-ai-config >>>',
  'export ANTHROPIC_MODEL=model-a',
  'export ANTHROPIC_BASE_URL=https://example.invalid/a',
  'export ANTHROPIC_AUTH_TOKEN=fixture-only-key-a',
  'export ANTHROPIC_SMALL_FAST_MODEL=model-a',
  'export ANTHROPIC_DEFAULT_OPUS_MODEL=model-a',
  'export ANTHROPIC_DEFAULT_SONNET_MODEL=model-a',
  'export ANTHROPIC_DEFAULT_HAIKU_MODEL=model-a',
  '# <<< change-ai-config <<<',
  '# service-fixture',
  '',
].join('\n');
const identity = ({ model, base_url, key }: ConfigEntry) => ({ model, base_url, key });
const serialize = (entries: unknown[]) => `${JSON.stringify(entries, null, 4)}\n`;

describe.skipIf(unsupported)('配置业务服务', () => {
  let home: string;
  let paths: Record<FileKey, string>;
  let service: ReturnType<typeof createService>;

  const capture = (keys: readonly FileKey[]) => Promise.all(keys.map(async key => {
    const text = await fs.readFile(paths[key], 'utf8');
    const stat = await fs.stat(paths[key], { bigint: true });
    return { key, text, ino: stat.ino, mtimeNs: stat.mtimeNs, mode: stat.mode };
  }));

  beforeEach(async () => {
    home = await fs.realpath(await fs.mkdtemp(join(os.tmpdir(), 'ccms-service-')));
    paths = {
      config: join(home, 'change-ai-config.json'),
      settings: join(home, '.claude', 'settings.json'),
      zshrc: join(home, '.zshrc'),
    };
    await fs.mkdir(join(home, '.claude'));
    await Promise.all([
      fs.writeFile(paths.config, serialize([A, B]), { mode: 0o600 }),
      fs.writeFile(paths.settings, '{}\n', { mode: 0o600 }),
      fs.writeFile(paths.zshrc, ZSHRC, { mode: 0o600 }),
    ]);
    service = createService(await createFileStore({ home }));
  });

  afterEach(async () => {
    if (home) await fs.rm(home, { recursive: true, force: true });
  });

  it('状态补齐缺失渠道并隐藏磁盘未知字段', async () => {
    await fs.writeFile(paths.config, serialize([{ ...identity(A), extra: 'private-field' }]));
    const entry = { ...A, channel: '' };
    const before = await capture(['config', 'settings', 'zshrc']);
    expect(await service.state()).toEqual({
      entries: [entry],
      groups: [{ url: A.base_url, channels: [{
        channel: '默认渠道', items: [{ entry, index: 0 }],
      }] }],
      activeIndex: -1,
    });
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
  });

  it.each([
    { name: '完整三元组', env: {
      ANTHROPIC_MODEL: B.model,
      ANTHROPIC_BASE_URL: B.base_url,
      ANTHROPIC_AUTH_TOKEN: B.key,
    }, activeIndex: 1 },
    { name: '仅 model', env: { ANTHROPIC_MODEL: B.model }, activeIndex: -1 },
    { name: '仅 URL', env: { ANTHROPIC_BASE_URL: A.base_url }, activeIndex: -1 },
    { name: '仅 key', env: { ANTHROPIC_AUTH_TOKEN: A.key }, activeIndex: -1 },
    { name: '全部为空', env: {
      ANTHROPIC_MODEL: '', ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '',
    }, activeIndex: 0 },
  ])('settings $name 时按既有优先级判定激活态', async ({ env, activeIndex }) => {
    await fs.writeFile(paths.settings, JSON.stringify({ env }));
    await fs.writeFile(paths.zshrc, APPLIED_A);
    const before = await capture(['config', 'settings', 'zshrc']);
    expect((await service.state()).activeIndex).toBe(activeIndex);
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
  });

  it('损坏 settings 回退 zshrc，读取不修复或改写文件', async () => {
    await fs.writeFile(paths.settings, '{broken-settings-private-marker');
    await fs.writeFile(paths.zshrc, APPLIED_A);
    const before = await capture(['config', 'settings', 'zshrc']);
    expect((await service.state()).activeIndex).toBe(0);
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
  });

  it('应用按最新三元组重定位并忽略渠道，settings 仍优先且重复应用不写', async () => {
    const selected = identity(A);
    expect((await service.state()).entries[0]).toEqual(A);
    await fs.writeFile(paths.config, serialize([
      B, { ...A, channel: 'external-channel', future: true },
    ]));
    await fs.writeFile(paths.settings, JSON.stringify({ env: {
      ANTHROPIC_MODEL: B.model,
      ANTHROPIC_BASE_URL: B.base_url,
      ANTHROPIC_AUTH_TOKEN: B.key,
    } }));
    const untouched = await capture(['config', 'settings']);
    const original = await capture(['zshrc']);
    await expect(service.apply({ expected: selected })).resolves.toBeUndefined();
    expect(await fs.readFile(paths.zshrc, 'utf8')).toBe(APPLIED_A);
    expect((await capture(['zshrc']))[0].ino).not.toBe(original[0].ino);
    expect(await capture(['config', 'settings'])).toEqual(untouched);
    const applied = await capture(['config', 'settings', 'zshrc']);
    expect((await service.state()).activeIndex).toBe(0);
    await service.apply({ expected: selected });
    expect(await capture(['config', 'settings', 'zshrc'])).toEqual(applied);
  });

  it.each(['model', 'base_url', 'key'] as const)(
    '应用拒绝磁盘 %s 已变化的过期三元组', async field => {
      await fs.writeFile(paths.config, serialize([A, { ...B, [field]: 'external' }]));
      const before = await capture(['config', 'settings', 'zshrc']);
      await expect(service.apply({ expected: identity(B) }))
        .rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
    },
  );

  it('同一存储上的并发新增保留全部增量及已有未知字段', async () => {
    const additions = [{ ...A, model: 'new-a' }, { ...A, model: 'new-b' }];
    const untouched = await capture(['settings', 'zshrc']);
    const results = await Promise.allSettled(additions.map(entry =>
      service.change('POST', undefined, { entry })));
    expect(results).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]);
    const text = await fs.readFile(paths.config, 'utf8');
    const entries = JSON.parse(text);
    expect(entries).toHaveLength(4);
    expect(entries.slice(0, 2)).toEqual([A, B]);
    expect(entries.slice(2)).toEqual(expect.arrayContaining(additions));
    expect(text).toBe(serialize(entries));
    expect(await capture(['settings', 'zshrc'])).toEqual(untouched);
  });

  it.each(['PATCH', 'DELETE'] as const)(
    '%s 拒绝下标漂移、三元组逐字段变化及越界，所有文件不变', async method => {
      await fs.writeFile(paths.config, serialize([B, A]));
      const cases = [
        { index: 0, expected: identity(A) },
        { index: 99, expected: identity(A) },
        ...(['model', 'base_url', 'key'] as const).map(field => ({
          index: 1, expected: { ...identity(A), [field]: 'stale' },
        })),
      ];
      const before = await capture(['config', 'settings', 'zshrc']);
      for (const { index, expected } of cases) {
        const body = method === 'PATCH'
          ? { expected, entry: { ...A, model: 'replacement' } } : { expected };
        await expect(service.change(method, index, body))
          .rejects.toMatchObject({ code: 'CONFLICT' });
        expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
      }
    },
  );

  it('缺渠道的条目仍可应用，重复应用不改文件', async () => {
    await fs.writeFile(paths.config, serialize([{ ...identity(A), extra: 'keep' }]));
    const untouched = await capture(['config', 'settings']);
    await expect(service.apply({ expected: identity(A) })).resolves.toBeUndefined();
    expect(await fs.readFile(paths.zshrc, 'utf8')).toBe(APPLIED_A);
    expect(await capture(['config', 'settings'])).toEqual(untouched);
    const applied = await capture(['zshrc']);
    await service.apply({ expected: identity(A) });
    expect(await capture(['zshrc'])).toEqual(applied);
  });

  it.each([' ', 'bad\nmodel', '\uD800'])(
    '旧磁盘非法写入值可读取和删除，但拒绝应用 %#', async model => {
      const entry = { ...A, model };
      await fs.writeFile(paths.config, serialize([entry]));
      expect((await service.state()).entries[0].model).toBe(model);
      const before = await capture(['config', 'settings', 'zshrc']);
      await expect(service.apply({ expected: identity(entry) }))
        .rejects.toMatchObject({ code: 'INVALID_CONFIG' });
      expect(await capture(['config', 'settings', 'zshrc'])).toEqual(before);
      await expect(service.change('DELETE', 0, { expected: identity(entry) })).resolves.toBeUndefined();
      expect(await fs.readFile(paths.config, 'utf8')).toBe('[]\n');
    },
  );

  it.each(['PATCH', 'DELETE'] as const)('%s 忽略渠道变化并保留未编辑条目的未知字段', async method => {
    await fs.writeFile(paths.config, serialize([{ ...A, channel: 'changed', extra: 'discard' }, B]));
    const untouched = await capture(['settings', 'zshrc']);
    const replacement = { ...A, model: 'replacement' };
    const body = method === 'PATCH'
      ? { expected: identity(A), entry: replacement } : { expected: identity(A) };
    await expect(service.change(method, 0, body)).resolves.toBeUndefined();
    expect(await fs.readFile(paths.config, 'utf8'))
      .toBe(serialize(method === 'PATCH' ? [replacement, B] : [B]));
    expect(await capture(['settings', 'zshrc'])).toEqual(untouched);
  });
});
