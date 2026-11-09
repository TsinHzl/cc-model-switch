import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileStoreError } from './errors.mjs';

const exec = promisify(execFile);
const TOOL_TIMEOUT_MS = 3000;
const TOOL_MAX_BUFFER_BYTES = 64 * 1024;
const TOOL_OPTIONS = Object.freeze({
  encoding: 'utf8',
  timeout: TOOL_TIMEOUT_MS,
  maxBuffer: TOOL_MAX_BUFFER_BYTES,
  env: Object.freeze({ LC_ALL: 'C', PATH: '/usr/bin:/bin' }),
});

export async function assertPlainMetadata(path) {
  if (process.platform !== 'darwin') {
    throw new FileStoreError('UNSUPPORTED_PLATFORM');
  }
  let results;
  try {
    results = await Promise.all([
      exec('/bin/ls', ['-lde', path], TOOL_OPTIONS),
      exec('/usr/bin/xattr', [path], TOOL_OPTIONS),
      exec('/usr/bin/stat', ['-f', '%Sf', path], TOOL_OPTIONS),
    ]);
  } catch {
    throw new FileStoreError('METADATA_CHECK_FAILED');
  }
  const [acl, xattrs, flags] = results.map(result => result.stdout);
  const lines = acl.replace(/\n$/, '').split('\n');
  const permissions = lines[0].split(/\s+/)[0];
  if (lines.length !== 1 || !/^-[rwxstST-]{9}@?$/.test(permissions)
      || xattrs !== '' || flags.trim() !== '-') {
    throw new FileStoreError('METADATA_UNSUPPORTED');
  }
}
