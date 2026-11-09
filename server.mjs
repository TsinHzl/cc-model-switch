/* 本机 API 与静态文件服务器，仅在直接执行时监听。 */
import { createServer } from 'node:http';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './server/api.mjs';
import { FileStoreError } from './server/errors.mjs';

const PORT = 15858;
const ROOT = fileURLToPath(new URL('./dist', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function locate(root, pathname) {
  let current = root;
  for (const segment of pathname.split('/').filter(Boolean)) {
    const candidate = join(current, segment);
    try {
      await lstat(candidate);
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    try {
      current = await realpath(candidate);
    } catch {
      throw new FileStoreError('UNSAFE_PATH');
    }
    const fromRoot = relative(root, current);
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) {
      throw new FileStoreError('UNSAFE_PATH');
    }
  }
  return { path: current, stat: await stat(current) };
}

async function serveStatic(root, pathname, req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    throw new FileStoreError('NOT_FOUND');
  }
  let target = await locate(root, pathname);
  if (target?.stat.isDirectory()) {
    target = await locate(root, `${pathname}/index.html`);
  }
  target ??= await locate(root, '/index.html');
  if (!target?.stat.isFile()) throw new FileStoreError('NOT_FOUND');
  const body = await readFile(target.path);
  res.writeHead(200, {
    'Content-Type': MIME[extname(target.path)] ?? 'application/octet-stream',
    'Content-Length': body.length,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export async function createLocalServer({ home = userInfo().homedir, root = ROOT } = {}) {
  const api = await createApiHandler({ home });
  const staticRoot = await realpath(root);
  if (!(await stat(staticRoot)).isDirectory()) throw new FileStoreError('UNSAFE_PATH');
  return createServer({ headersTimeout: 5000, requestTimeout: 10000 }, (req, res) => {
    void api(req, res, pathname => serveStatic(staticRoot, pathname, req, res));
  });
}

function startupFailed(error) {
  const code = error instanceof FileStoreError ? error.code
    : ['EADDRINUSE', 'EACCES', 'ENOENT'].includes(error?.code) ? error.code : 'IO_FAILED';
  process.stderr.write(`本机服务启动失败：${code}\n`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await createLocalServer();
    server.once('error', startupFailed);
    server.listen(PORT, '127.0.0.1', () => {
      process.stdout.write(`cc-config-webui → http://127.0.0.1:${PORT}\n`);
    });
  } catch (error) {
    startupFailed(error);
  }
}
