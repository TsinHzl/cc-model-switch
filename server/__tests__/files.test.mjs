import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFileStore, MAX_FILE_BYTES } from '../files.mjs';
import { FileStoreError } from '../errors.mjs';

const exec = promisify(execFile);
const unsupported = process.platform !== 'darwin'
  || process.getuid?.() === 0 || process.geteuid?.() === 0;

describe.skipIf(unsupported)('本机文件 store', () => {
  let home, paths, store;
  const noTemporaryFiles = async () => {
    expect((await fs.readdir(home)).filter(name => name.startsWith('.ccms-'))).toEqual([]);
  };

  beforeEach(async () => {
    home = await fs.realpath(await fs.mkdtemp(join(os.tmpdir(), 'ccms-files-')));
    paths = {
      config: join(home, 'change-ai-config.json'),
      settings: join(home, '.claude', 'settings.json'),
      zshrc: join(home, '.zshrc'),
    };
    await fs.mkdir(join(home, '.claude'));
    await Promise.all(Object.values(paths).map(path =>
      fs.writeFile(path, '0', { mode: 0o600 })));
    store = await createFileStore({ home });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (home) await fs.rm(home, { recursive: true, force: true });
  });

  it('读取磁盘最新值及只读 settings', async () => {
    await fs.writeFile(paths.config, 'latest');
    expect(await store.read('config')).toBe('latest');
    expect(await store.read('settings')).toBe('0');
    expect(await store.read('zshrc')).toBe('0');
  });

  it.each(['config', 'settings', 'zshrc'])('要求 %s 必须存在', async key => {
    await fs.unlink(paths[key]);
    await expect(store.read(key)).rejects.toMatchObject({ code: 'FILE_MISSING' });
    if (key !== 'settings') {
      await expect(store.update(key, () => 'new'))
        .rejects.toMatchObject({ code: 'FILE_MISSING' });
      await expect(fs.stat(paths[key])).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it.each(['unknown', '../.zshrc', '__proto__', 'constructor'])('拒绝未知 key %s', async key => {
    await expect(store.read(key)).rejects.toMatchObject({ code: 'UNKNOWN_KEY' });
    await expect(store.update(key, () => 'changed')).rejects.toMatchObject({ code: 'UNKNOWN_KEY' });
  });

  it('拒绝写 settings 和 root 启动', async () => {
    const transform = vi.fn(() => 'changed');
    await expect(store.update('settings', transform)).rejects.toMatchObject({ code: 'READ_ONLY' });
    expect(transform).not.toHaveBeenCalled();
    expect(await fs.readFile(paths.settings, 'utf8')).toBe('0');
    vi.spyOn(process, 'geteuid').mockReturnValue(0);
    await expect(createFileStore({ home })).rejects.toMatchObject({ code: 'ROOT_FORBIDDEN' });
  });

  it('拒绝目标符号链接', async () => {
    await fs.unlink(paths.config);
    await fs.symlink(paths.settings, paths.config);
    await expect(store.read('config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(store.update('config', () => '1')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    expect(await fs.readFile(paths.settings, 'utf8')).toBe('0');
  });

  it('拒绝父目录及注入 home 路径中的符号链接', async () => {
    await fs.rename(join(home, '.claude'), join(home, 'real-claude'));
    await fs.symlink(join(home, 'real-claude'), join(home, '.claude'));
    await expect(store.read('settings')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await fs.symlink(home, join(home, 'alias'));
    const aliased = await createFileStore({ home: join(home, 'alias') });
    await expect(aliased.read('config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });

  it('拒绝非普通目标', async () => {
    await fs.unlink(paths.config);
    await fs.mkdir(paths.config);
    await expect(store.read('config')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(store.update('config', () => '1')).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
  });

  it('允许读取但拒绝替换多硬链接文件', async () => {
    await fs.link(paths.config, join(home, 'config-link'));
    expect(await store.read('config')).toBe('0');
    await expect(store.update('config', () => '1'))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    await noTemporaryFiles();
  });

  it('保留普通 mode、uid、gid 并替换 inode', async () => {
    await fs.chmod(paths.config, 0o640);
    const before = await fs.stat(paths.config, { bigint: true });
    await expect(store.update('config', text => `${text}1`)).resolves.toBe('01');
    const after = await fs.stat(paths.config, { bigint: true });
    expect([after.mode, after.uid, after.gid]).toEqual([before.mode, before.uid, before.gid]);
    expect(after.ino).not.toBe(before.ino);
    await noTemporaryFiles();
  });

  it.each([0o4600, 0o400])('拒绝特殊权限或只读权限 %i', async mode => {
    await fs.chmod(paths.config, mode);
    await expect(store.update('config', () => '1'))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_FILE' });
    expect(await fs.readFile(paths.config, 'utf8')).toBe('0');
  });

  it('无变化不 rename、不改变 inode 或 mtime', async () => {
    const rename = vi.spyOn(fs, 'rename');
    const before = await fs.stat(paths.config, { bigint: true });
    await store.update('config', text => text);
    const after = await fs.stat(paths.config, { bigint: true });
    expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
    expect(rename).not.toHaveBeenCalled();
  });

  it.each(['target', 'dependency'])('拒绝外部修改 %s 并清理临时文件', async kind => {
    await expect(store.update('zshrc', async (text, readDependency) => {
      if (kind === 'dependency') expect(await readDependency('config')).toBe('0');
      await fs.writeFile(kind === 'target' ? paths.zshrc : paths.config, 'external');
      return `${text}1`;
    })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await fs.readFile(paths.zshrc, 'utf8')).toBe(kind === 'target' ? 'external' : '0');
    await noTemporaryFiles();
  });

  it('失败返回调用方，队列恢复且并发增量不丢失', async () => {
    const error = new FileStoreError('CONFLICT');
    const failed = store.update('config', () => { throw error; });
    const increment = () => store.update('config', text => String(Number(text) + 1));
    const first = increment();
    await expect(failed).rejects.toBe(error);
    await expect(first).resolves.toBe('1');
    await expect(Promise.all([increment(), increment(), increment()]))
      .resolves.toEqual(['2', '3', '4']);
    expect(await store.read('config')).toBe('4');
  }, 15000);

  it('拒绝真实 xattr，不改变原文件', async () => {
    await exec('/usr/bin/xattr', ['-w', 'com.cc-model-switch.test', 'present', paths.config], {
      timeout: 3000, maxBuffer: 65536, env: { LC_ALL: 'C', PATH: '/usr/bin:/bin' },
    });
    await expect(store.update('config', () => '1'))
      .rejects.toMatchObject({ code: 'METADATA_UNSUPPORTED' });
    expect(await fs.readFile(paths.config, 'utf8')).toBe('0');
    await noTemporaryFiles();
  });

  it('保留 UTF-8 BOM，拒绝损坏字节与孤立代理字符', async () => {
    await fs.writeFile(paths.config, '﻿中文');
    expect(await store.read('config')).toBe('﻿中文');
    await store.update('config', text => `${text}一`);
    expect(await fs.readFile(paths.config, 'utf8')).toBe('﻿中文一');
    await expect(store.update('config', () => '\uD800'))
      .rejects.toMatchObject({ code: 'INVALID_UTF8' });
    await fs.writeFile(paths.config, Buffer.from([0xc3, 0x28]));
    await expect(store.read('config')).rejects.toMatchObject({ code: 'INVALID_UTF8' });
  });

  it('大小限制包含边界，拒绝超限读取及输出', async () => {
    await fs.writeFile(paths.config, 'x'.repeat(MAX_FILE_BYTES));
    expect((await store.read('config')).length).toBe(MAX_FILE_BYTES);
    await expect(store.update('config', () => 'x'.repeat(MAX_FILE_BYTES + 1)))
      .rejects.toMatchObject({ code: 'TOO_LARGE' });
    await fs.appendFile(paths.config, 'x');
    await expect(store.read('config')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('真实 rename 后目录 sync 失败报告 WRITE_UNCERTAIN，不重放', async () => {
    const originalOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      if (args[0] !== home) return handle;
      return {
        stat: handle.stat.bind(handle),
        close: handle.close.bind(handle),
        sync: async () => { throw new Error('injected directory sync failure'); },
      };
    });
    const transform = vi.fn(() => 'written');
    await expect(store.update('config', transform))
      .rejects.toMatchObject({ code: 'WRITE_UNCERTAIN' });
    expect(transform).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(paths.config, 'utf8')).toBe('written');
    await noTemporaryFiles();
  });

  it('错误不包含真实路径、配置内容或回调异常正文', async () => {
    const secret = 'fixture-private-content';
    const error = await store.update('config', () => {
      throw new Error(`${home}: ${secret}`);
    }).catch(value => value);
    expect(error.code).toBe('TRANSFORM_FAILED');
    expect(error.message).not.toContain(home);
    expect(error.message).not.toContain(secret);
    await fs.unlink(paths.config);
    const missing = await store.read('config').catch(value => value);
    expect(missing.message).not.toContain(home);
    expect(missing.code).toBe('FILE_MISSING');
  });
});
