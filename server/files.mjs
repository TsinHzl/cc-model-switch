import fs from 'node:fs/promises';
import { constants as C } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { FileStoreError, safeFileError, safeIO } from './errors.mjs';
import { assertPlainMetadata } from './metadata.mjs';

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const BIGINT = Object.freeze({ bigint: true });
const DIRECTORY_FIELDS = ['dev', 'ino', 'mode', 'uid', 'gid'];
const VERSION_FIELDS = [
  ...DIRECTORY_FIELDS, 'nlink', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs',
];
const PUBLISHED_FIELDS = VERSION_FIELDS.filter(field => field !== 'ctimeNs');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function same(a, b, fields = VERSION_FIELDS) {
  return fields.every(field => a[field] === b[field]);
}

function sameParents(a, b) {
  return a.length === b.length && a.every((entry, index) =>
    entry.path === b[index].path && same(entry.stat, b[index].stat, DIRECTORY_FIELDS));
}

async function parentStats(path) {
  const paths = [];
  for (let current = dirname(path); ; current = dirname(current)) {
    paths.unshift(current);
    if (dirname(current) === current) break;
  }
  const parents = [];
  for (const parent of paths) {
    const stat = await fs.lstat(parent, BIGINT);
    if (!stat.isDirectory()) throw new FileStoreError('UNSAFE_PATH');
    parents.push({ path: parent, stat });
  }
  return parents;
}

async function readBytes(handle, stat) {
  if (stat.size > BigInt(MAX_FILE_BYTES)) throw new FileStoreError('TOO_LARGE');
  const buffer = Buffer.alloc(Number(stat.size) + 1);
  let used = 0;
  while (used < buffer.length) {
    const { bytesRead } = await handle.read(buffer, used, buffer.length - used, null);
    if (bytesRead === 0) break;
    used += bytesRead;
  }
  if (used !== Number(stat.size)) throw new FileStoreError('CONFLICT');
  return buffer.subarray(0, used);
}

function decode(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new FileStoreError('INVALID_UTF8');
  }
}

function encode(text) {
  if (typeof text !== 'string') throw new FileStoreError('TRANSFORM_FAILED');
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw new FileStoreError('TOO_LARGE');
  }
  const bytes = Buffer.from(text, 'utf8');
  if (decode(bytes) !== text) throw new FileStoreError('INVALID_UTF8');
  return bytes;
}

async function snapshot(path) {
  return safeIO(async () => {
    const parents = await parentStats(path);
    const named = await fs.lstat(path, BIGINT);
    if (!named.isFile()) throw new FileStoreError('UNSAFE_PATH');
    const handle = await fs.open(path, C.O_RDONLY | C.O_NOFOLLOW | C.O_NONBLOCK);
    try {
      const stat = await handle.stat(BIGINT);
      if (!stat.isFile() || !same(named, stat)) throw new FileStoreError('CONFLICT');
      const bytes = await readBytes(handle, stat);
      if (!same(stat, await handle.stat(BIGINT))
          || !same(stat, await fs.lstat(path, BIGINT))
          || !sameParents(parents, await parentStats(path))) {
        throw new FileStoreError('CONFLICT');
      }
      return { path, stat, parents, text: decode(bytes) };
    } finally {
      await handle.close();
    }
  });
}

function assertWritable(stat) {
  if (!stat.isFile() || stat.nlink !== 1n || (stat.mode & 0o7000n) !== 0n
      || (stat.mode & 0o200n) === 0n
      || stat.uid !== BigInt(process.geteuid())
      || process.getuid() !== process.geteuid()) {
    throw new FileStoreError('UNSUPPORTED_FILE');
  }
}

async function verifySnapshots(snapshots) {
  for (const previous of snapshots) {
    const current = await snapshot(previous.path);
    if (!same(previous.stat, current.stat) || previous.text !== current.text
        || !sameParents(previous.parents, current.parents)) {
      throw new FileStoreError('CONFLICT');
    }
  }
}

async function syncDirectory(base) {
  const handle = await fs.open(
    dirname(base.path), C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW,
  );
  try {
    if (!same(base.parents.at(-1).stat, await handle.stat(BIGINT), DIRECTORY_FIELDS)) {
      throw new FileStoreError('CONFLICT');
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function disposeTemporary(path, handle, identity, renamed) {
  let failed = false;
  if (handle && !renamed) {
    try {
      const ours = identity ?? await handle.stat(BIGINT);
      const current = await fs.lstat(path, BIGINT);
      if (!same(ours, current, ['dev', 'ino'])) throw new FileStoreError('CONFLICT');
      await fs.unlink(path);
    } catch (error) {
      if (error?.code !== 'ENOENT') failed = true;
    }
  }
  try {
    await handle?.close();
  } catch {
    failed = true;
  }
  return failed;
}

async function replaceFile(base, next, bytes, dependencies) {
  const temporary = join(dirname(base.path), `.ccms-${randomUUID()}.tmp`);
  let handle, identity, failure;
  let renamed = false;
  try {
    await assertPlainMetadata(base.path);
    handle = await fs.open(
      temporary, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW, 0o600,
    );
    identity = await handle.stat(BIGINT);
    assertWritable(identity);
    if ((identity.mode & 0o077n) !== 0n) throw new FileStoreError('UNSUPPORTED_FILE');
    await assertPlainMetadata(temporary);
    await handle.writeFile(bytes);
    if (identity.uid !== base.stat.uid || identity.gid !== base.stat.gid) {
      await handle.chown(Number(base.stat.uid), Number(base.stat.gid));
    }
    await handle.chmod(Number(base.stat.mode & 0o777n));
    await handle.sync();
    const ready = await handle.stat(BIGINT);
    assertWritable(ready);
    if (!same(base.stat, ready, ['mode', 'uid', 'gid'])) {
      throw new FileStoreError('UNSUPPORTED_FILE');
    }
    await assertPlainMetadata(temporary);
    await assertPlainMetadata(base.path);
    await verifySnapshots(dependencies);
    if (!same(ready, await fs.lstat(temporary, BIGINT))) {
      throw new FileStoreError('CONFLICT');
    }
    // 检查与 rename 之间仍存在跨进程竞争窗口，不构成原子 CAS。
    await fs.rename(temporary, base.path);
    renamed = true;
    await syncDirectory(base);
    const written = await snapshot(base.path);
    if (!same(ready, written.stat, PUBLISHED_FIELDS) || written.text !== next
        || !sameParents(base.parents, written.parents)) {
      throw new FileStoreError('WRITE_UNCERTAIN');
    }
  } catch (error) {
    failure = renamed ? new FileStoreError('WRITE_UNCERTAIN') : safeFileError(error);
  }
  if (await disposeTemporary(temporary, handle, identity, renamed)) {
    failure = new FileStoreError(failure?.code ?? 'WRITE_UNCERTAIN', true);
  }
  if (failure) throw failure;
  return next;
}

async function updateFile(path, transform, pathFor) {
  if (process.platform !== 'darwin') throw new FileStoreError('UNSUPPORTED_PLATFORM');
  const base = await snapshot(path);
  const dependencies = new Map([[path, Promise.resolve(base)]]);
  let acceptingReads = true;
  const readDependency = async key => {
    if (!acceptingReads) throw new FileStoreError('TRANSFORM_FAILED');
    const dependencyPath = pathFor(key);
    if (!dependencies.has(dependencyPath)) {
      dependencies.set(dependencyPath, snapshot(dependencyPath));
    }
    return (await dependencies.get(dependencyPath)).text;
  };
  let next;
  try {
    next = await transform(base.text, readDependency);
  } catch (error) {
    throw error instanceof FileStoreError ? error : new FileStoreError('TRANSFORM_FAILED');
  } finally {
    acceptingReads = false;
  }
  const bytes = encode(next);
  const snapshots = await Promise.all(dependencies.values());
  if (next === base.text) {
    await verifySnapshots(snapshots);
    return next;
  }
  assertWritable(base.stat);
  return replaceFile(base, next, bytes, snapshots);
}

export async function createFileStore({ home } = {}) {
  if (process.getuid?.() === 0 || process.geteuid?.() === 0) {
    throw new FileStoreError('ROOT_FORBIDDEN');
  }
  if (typeof home !== 'string' || !isAbsolute(home) || resolve(home) !== home) {
    throw new FileStoreError('INVALID_HOME');
  }
  const paths = new Map([
    ['config', join(home, 'change-ai-config.json')],
    ['settings', join(home, '.claude', 'settings.json')],
    ['zshrc', join(home, '.zshrc')],
  ]);
  const pathFor = key => {
    if (typeof key !== 'string' || !paths.has(key)) {
      throw new FileStoreError('UNKNOWN_KEY');
    }
    return paths.get(key);
  };
  let queue = Promise.resolve();
  return Object.freeze({
    async read(key) {
      return (await snapshot(pathFor(key))).text;
    },
    update(key, transform) {
      const result = queue.then(() => {
        const path = pathFor(key);
        if (key === 'settings') throw new FileStoreError('READ_ONLY');
        return updateFile(path, transform, pathFor);
      });
      // 仅恢复调度链；返回原始 result，业务失败仍传给调用方。
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  });
}
