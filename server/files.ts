import fs, { type FileHandle } from 'node:fs/promises';
import { constants as C, type BigIntStats } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { FileStoreError, safeFileError, safeIO } from './errors.js';
import { assertPlainMetadata, applyXattrs, verifyXattrs } from './metadata.js';

export type FileKey = 'config' | 'settings' | 'zshrc';
export type ReadDependency = (key: FileKey) => Promise<string>;
export type FileTransform = (text: string, readDependency: ReadDependency) => string | Promise<string>;

export interface FileStore {
  readonly read: (key: FileKey) => Promise<string>;
  readonly update: (key: FileKey, transform: FileTransform) => Promise<string>;
}

interface ParentSnapshot {
  readonly path: string;
  readonly stat: BigIntStats;
}

interface Snapshot extends ParentSnapshot {
  readonly parents: readonly ParentSnapshot[];
  readonly text: string;
}

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
const BIGINT = Object.freeze({ bigint: true as const });
const DIRECTORY_FIELDS = ['dev', 'ino', 'mode', 'uid', 'gid'] as const;
const VERSION_FIELDS = [
  ...DIRECTORY_FIELDS, 'nlink', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs',
] as const;
const PUBLISHED_FIELDS = VERSION_FIELDS.filter(field => field !== 'ctimeNs');
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function same(
  a: BigIntStats, b: BigIntStats,
  fields: readonly (typeof VERSION_FIELDS[number])[] = VERSION_FIELDS,
): boolean {
  return fields.every(field => a[field] === b[field]);
}

function sameParents(a: readonly ParentSnapshot[], b: readonly ParentSnapshot[]): boolean {
  return a.length === b.length && a.every((entry, index) =>
    entry.path === b[index].path && same(entry.stat, b[index].stat, DIRECTORY_FIELDS));
}

async function parentStats(path: string): Promise<ParentSnapshot[]> {
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

async function readBytes(handle: FileHandle, stat: BigIntStats): Promise<Buffer> {
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

function decode(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new FileStoreError('INVALID_UTF8');
  }
}

function encode(text: string): Buffer {
  if (typeof text !== 'string') throw new FileStoreError('TRANSFORM_FAILED');
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
    throw new FileStoreError('TOO_LARGE');
  }
  const bytes = Buffer.from(text, 'utf8');
  if (decode(bytes) !== text) throw new FileStoreError('INVALID_UTF8');
  return bytes;
}

async function snapshot(path: string): Promise<Snapshot> {
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

function assertWritable(stat: BigIntStats): void {
  if (!stat.isFile() || stat.nlink !== 1n || (stat.mode & 0o7000n) !== 0n
      || (stat.mode & 0o200n) === 0n
      || stat.uid !== BigInt(process.geteuid!())
      || process.getuid!() !== process.geteuid!()) {
    throw new FileStoreError('UNSUPPORTED_FILE');
  }
}

async function verifySnapshots(snapshots: readonly Snapshot[]): Promise<void> {
  for (const previous of snapshots) {
    const current = await snapshot(previous.path);
    if (!same(previous.stat, current.stat) || previous.text !== current.text
        || !sameParents(previous.parents, current.parents)) {
      throw new FileStoreError('CONFLICT');
    }
  }
}

async function syncDirectory(base: Snapshot): Promise<void> {
  const handle = await fs.open(
    dirname(base.path), C.O_RDONLY | C.O_DIRECTORY | C.O_NOFOLLOW,
  );
  try {
    if (!same(base.parents.at(-1)!.stat, await handle.stat(BIGINT), DIRECTORY_FIELDS)) {
      throw new FileStoreError('CONFLICT');
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function disposeTemporary(
  path: string, handle: FileHandle | undefined, identity: BigIntStats | undefined, renamed: boolean,
): Promise<boolean> {
  let failed = false;
  if (handle && !renamed) {
    try {
      const ours = identity ?? await handle.stat(BIGINT);
      const current = await fs.lstat(path, BIGINT);
      if (!same(ours, current, ['dev', 'ino'])) throw new FileStoreError('CONFLICT');
      await fs.unlink(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null | undefined)?.code !== 'ENOENT') failed = true;
    }
  }
  try {
    await handle?.close();
  } catch {
    failed = true;
  }
  return failed;
}

async function replaceFile(
  base: Snapshot, next: string, bytes: Buffer, dependencies: readonly Snapshot[],
): Promise<string> {
  const temporary = join(dirname(base.path), `.ccms-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let identity: BigIntStats | undefined;
  let failure: FileStoreError | undefined;
  let renamed = false;
  try {
    // 先捕获原文件可保留 xattr，写入新 inode 后再复制，避免替换后静默丢失。
    const baseMeta = await assertPlainMetadata(base.path);
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
    // xattr 会更新临时文件 mtime，故在捕获 ready 前复制并核对。
    await applyXattrs(temporary, baseMeta.xattrs);
    await verifyXattrs(temporary, baseMeta.xattrs);
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
    // 发布后核对原 xattr 未被丢弃；不一致按 WRITE_UNCERTAIN 处理，不自动重试。
    await verifyXattrs(base.path, baseMeta.xattrs);
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

async function updateFile(
  path: string, transform: FileTransform, pathFor: (key: FileKey) => string,
): Promise<string> {
  if (process.platform !== 'darwin') throw new FileStoreError('UNSUPPORTED_PLATFORM');
  const base = await snapshot(path);
  const dependencies = new Map<string, Promise<Snapshot>>([[path, Promise.resolve(base)]]);
  let acceptingReads = true;
  const readDependency: ReadDependency = async key => {
    if (!acceptingReads) throw new FileStoreError('TRANSFORM_FAILED');
    const dependencyPath = pathFor(key);
    if (!dependencies.has(dependencyPath)) {
      dependencies.set(dependencyPath, snapshot(dependencyPath));
    }
    return (await dependencies.get(dependencyPath)!).text;
  };
  let next: string;
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

export async function createFileStore({ home }: { home?: string } = {}): Promise<FileStore> {
  if (process.getuid?.() === 0 || process.geteuid?.() === 0) {
    throw new FileStoreError('ROOT_FORBIDDEN');
  }
  if (typeof home !== 'string' || !isAbsolute(home) || resolve(home) !== home) {
    throw new FileStoreError('INVALID_HOME');
  }
  const paths = new Map<FileKey, string>([
    ['config', join(home, 'change-ai-config.json')],
    ['settings', join(home, '.claude', 'settings.json')],
    ['zshrc', join(home, '.zshrc')],
  ]);
  const pathFor = (key: FileKey): string => {
    if (typeof key !== 'string' || !paths.has(key)) {
      throw new FileStoreError('UNKNOWN_KEY');
    }
    return paths.get(key)!;
  };
  let queue = Promise.resolve();
  return Object.freeze<FileStore>({
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
