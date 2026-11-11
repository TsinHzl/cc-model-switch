import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileStoreError } from './errors.js';

const exec = promisify(execFile);
const TOOL_TIMEOUT_MS = 3000;
const TOOL_MAX_BUFFER_BYTES = 64 * 1024;
const TOOL_OPTIONS = Object.freeze({
  encoding: 'utf8' as const,
  timeout: TOOL_TIMEOUT_MS,
  maxBuffer: TOOL_MAX_BUFFER_BYTES,
  env: Object.freeze({ LC_ALL: 'C', PATH: '/usr/bin:/bin' }),
});

export interface Xattr {
  readonly name: string;
  readonly hex: string;
}

export interface FileMetadata {
  readonly xattrs: readonly Xattr[];
}

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    return (await exec(cmd, args, TOOL_OPTIONS)).stdout;
  } catch {
    throw new FileStoreError('METADATA_CHECK_FAILED');
  }
}

async function readXattrs(path: string): Promise<Xattr[]> {
  const names = (await run('/usr/bin/xattr', [path])).split('\n').filter(Boolean);
  const xattrs = [];
  for (const name of names) {
    // 读到值说明可复制保留；任一属性读不出都算无法确认，拒绝写入。
    const hex = (await run('/usr/bin/xattr', ['-px', name, path])).replace(/\s+/g, '');
    xattrs.push({ name, hex });
  }
  return xattrs;
}

// 校验普通文件元数据并返回可复制保留的 xattr 清单；ACL/flags 仍拒绝。
export async function assertPlainMetadata(path: string): Promise<FileMetadata> {
  if (process.platform !== 'darwin') {
    throw new FileStoreError('UNSUPPORTED_PLATFORM');
  }
  const [acl, flags] = await Promise.all([
    run('/bin/ls', ['-lde', path]),
    run('/usr/bin/stat', ['-f', '%Sf', path]),
  ]);
  const lines = acl.replace(/\n$/, '').split('\n');
  const permissions = lines[0].split(/\s+/)[0];
  if (lines.length !== 1 || !/^-[rwxstST-]{9}@?$/.test(permissions) || flags.trim() !== '-') {
    throw new FileStoreError('METADATA_UNSUPPORTED');
  }
  return { xattrs: await readXattrs(path) };
}

// 把原文件 xattr 复制到目标（新 inode）；任一失败即无法可靠保留。
export async function applyXattrs(path: string, xattrs: readonly Xattr[]): Promise<void> {
  for (const { name, hex } of xattrs) {
    await run('/usr/bin/xattr', ['-wx', name, hex, path]);
  }
}

// 逐项核对 xattr 名称与值与原文件一致（含空集合的相等情况）。
export async function verifyXattrs(path: string, xattrs: readonly Xattr[]): Promise<void> {
  const expected = new Map(xattrs.map(({ name, hex }) => [name, hex]));
  const actual = new Map((await readXattrs(path)).map(({ name, hex }) => [name, hex]));
  if (expected.size !== actual.size) throw new FileStoreError('METADATA_UNSUPPORTED');
  for (const [name, hex] of expected) {
    if (actual.get(name) !== hex) throw new FileStoreError('METADATA_UNSUPPORTED');
  }
}