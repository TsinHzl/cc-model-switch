import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestResources, type TestResources } from '../testing/resources';
import { createFileStore } from '../../server/files.js';

const fields = ['home', 'userData', 'sessionData', 'logs', 'crashDumps'] as const;
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
const writeUnsupported = process.platform !== 'darwin'
  || process.getuid?.() === 0 || process.geteuid?.() === 0;
const allocated: TestResources[] = [];

function create(): TestResources {
  const resources = createTestResources();
  allocated.push(resources);
  return resources;
}

afterEach(() => {
  vi.restoreAllMocks();
  const errors: unknown[] = [];
  for (const resources of allocated.splice(0).reverse()) {
    try {
      resources.cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, '测试资源清理失败');
});

describe('桌面测试资源隔离', () => {
  it('同步创建固定且独立的目录，POSIX 权限为 0700', () => {
    const resources = create();
    expect(fs.realpathSync(resources.root)).toBe(resources.root);
    expect(new Set(fields.map(field => resources[field])).size).toBe(fields.length);
    for (const field of fields) {
      expect(dirname(resources[field])).toBe(resources.root);
      expect(resources[field]).toBe(join(resources.root, field));
    }
    for (const path of [resources.root, ...fields.map(field => resources[field])]) {
      const stat = fs.lstatSync(path);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.isSymbolicLink()).toBe(false);
      if (process.platform !== 'win32') expect(stat.mode & 0o777).toBe(0o700);
    }
    expect(Object.isFrozen(resources)).toBe(true);
    expect(Object.isFrozen(resources.registry)).toBe(true);
  });

  it('每次创建独立根和专属注册表目标，清理不影响另一实例', () => {
    const first = create();
    const second = create();
    expect(first.root).not.toBe(second.root);
    expect(first.registry.subKey).not.toBe(second.registry.subKey);
    for (const resources of [first, second]) {
      expect(resources.registry.hive).toBe('HKEY_CURRENT_USER');
      expect(resources.registry.subKey)
        .toMatch(/^Software\\cc-model-switch\\Tests\\[0-9a-f-]{36}$/);
    }
    const sentinel = join(second.home, 'sentinel');
    fs.writeFileSync(sentinel, 'keep');
    fs.writeFileSync(join(first.home, 'remove'), 'fixture');
    first.cleanup();
    expect(fs.existsSync(first.root)).toBe(false);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
  });

  it.each([
    undefined,
    '../outside',
    { home: '../outside' },
    { userData: '../outside' },
    { registry: { hive: 'HKEY_CURRENT_USER', subKey: 'Environment' } },
  ])('拒绝额外初始化参数 %#', value => {
    expect(() => {
      allocated.push(Reflect.apply(createTestResources, undefined, [value]));
    }).toThrow(TypeError);
  });

  it('清理拒绝路径实参，且不能通过 this 改向', () => {
    const first = create();
    const second = create();
    expect(() => Reflect.apply(first.cleanup, { root: second.root }, [second.root]))
      .toThrow(TypeError);
    expect(fs.existsSync(first.root)).toBe(true);
    Reflect.apply(first.cleanup, { root: second.root }, []);
    expect(fs.existsSync(first.root)).toBe(false);
    expect(fs.existsSync(second.root)).toBe(true);
  });

  it.each([false, true])('清理幂等且不删除后来重建的目录：先外部删除=%s', removed => {
    const resources = create();
    if (removed) fs.rmSync(resources.root, { recursive: true });
    resources.cleanup();
    fs.mkdirSync(resources.root);
    const sentinel = join(resources.root, 'replacement');
    try {
      fs.writeFileSync(sentinel, 'keep');
      resources.cleanup();
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
    } finally {
      fs.rmSync(resources.root, { recursive: true });
    }
  });

  it('根目录被替换时拒绝删除新目录', () => {
    const resources = create();
    const other = create();
    const saved = join(other.root, 'saved');
    fs.renameSync(resources.root, saved);
    try {
      fs.mkdirSync(resources.root);
      const sentinel = join(resources.root, 'replacement');
      fs.writeFileSync(sentinel, 'keep');
      expect(resources.cleanup).toThrow('测试资源根目录已改变');
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
      expect(fs.existsSync(join(saved, 'home'))).toBe(true);
    } finally {
      fs.rmSync(resources.root, { recursive: true, force: true });
      fs.renameSync(saved, resources.root);
    }
  });

  it('根目录变为链接时拒绝清理外部目标', () => {
    const resources = create();
    const other = create();
    const saved = join(other.root, 'saved');
    const sentinel = join(other.home, 'sentinel');
    fs.writeFileSync(sentinel, 'keep');
    fs.renameSync(resources.root, saved);
    try {
      fs.symlinkSync(other.root, resources.root, linkType);
      expect(resources.cleanup).toThrow('测试资源根目录已改变');
      expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
    } finally {
      if (fs.existsSync(resources.root)) fs.unlinkSync(resources.root);
      fs.renameSync(saved, resources.root);
    }
  });

  it('清理内部目录链接时保留链接目标', () => {
    const resources = create();
    const other = create();
    const sentinel = join(other.home, 'sentinel');
    fs.writeFileSync(sentinel, 'keep');
    fs.symlinkSync(other.home, join(resources.home, 'outside'), linkType);
    resources.cleanup();
    expect(fs.existsSync(resources.root)).toBe(false);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('keep');
  });

  it('子目录创建失败时回收本次根并保留原错误', () => {
    const failure = new Error('fixture mkdir failure');
    const created = vi.spyOn(fs, 'mkdtempSync');
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => { throw failure; });
    try {
      expect(createTestResources).toThrow(failure);
      const root = created.mock.results[0]?.value;
      expect(typeof root).toBe('string');
      expect(fs.existsSync(root)).toBe(false);
    } finally {
      const root = created.mock.results[0]?.value;
      vi.restoreAllMocks();
      if (typeof root === 'string') fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('创建失败后的清理异常不能覆盖原始错误', () => {
    const failure = new Error('fixture mkdir failure');
    const cleanupFailure = new Error('fixture cleanup failure');
    const created = vi.spyOn(fs, 'mkdtempSync');
    vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => { throw failure; });
    vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => { throw cleanupFailure; });
    let thrown: unknown;
    try {
      try {
        createTestResources();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AggregateError);
      expect((thrown as AggregateError).errors).toEqual([failure, cleanupFailure]);
      const root = created.mock.results[0]?.value;
      expect(typeof root).toBe('string');
      expect(fs.existsSync(root)).toBe(true);
    } finally {
      const root = created.mock.results[0]?.value;
      vi.restoreAllMocks();
      if (typeof root === 'string') fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.skipIf(writeUnsupported)('FileStore 只操作夹具 home，settings 保持只读', async () => {
    const resources = create();
    const other = create();
    fs.mkdirSync(join(resources.home, '.claude'));
    const config = join(resources.home, 'change-ai-config.json');
    const settings = join(resources.home, '.claude', 'settings.json');
    const zshrc = join(resources.home, '.zshrc');
    const sentinel = join(other.home, 'change-ai-config.json');
    fs.writeFileSync(config, '[]\n', { mode: 0o600 });
    fs.writeFileSync(settings, '{}\n', { mode: 0o600 });
    fs.writeFileSync(zshrc, '# fixture\n', { mode: 0o600 });
    fs.writeFileSync(sentinel, 'untouched', { mode: 0o600 });
    const settingsBefore = fs.statSync(settings, { bigint: true });
    const store = await createFileStore({ home: resources.home });
    expect(await store.read('config')).toBe('[]\n');
    expect(await store.read('settings')).toBe('{}\n');
    expect(await store.read('zshrc')).toBe('# fixture\n');
    await store.update('config', text => text + '\n');
    await store.update('zshrc', text => text + '# updated\n');
    await expect(store.update('settings', () => 'changed')).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(fs.readFileSync(config, 'utf8')).toBe('[]\n\n');
    expect(fs.readFileSync(zshrc, 'utf8')).toBe('# fixture\n# updated\n');
    expect(fs.readFileSync(settings, 'utf8')).toBe('{}\n');
    const settingsAfter = fs.statSync(settings, { bigint: true });
    expect(settingsAfter.ino).toBe(settingsBefore.ino);
    expect(settingsAfter.mtimeNs).toBe(settingsBefore.mtimeNs);
    expect(fs.readFileSync(sentinel, 'utf8')).toBe('untouched');
  });
});
