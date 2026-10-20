/* 静态文件服务器：托管 dist/，端口 15858（node server.mjs） */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 15858;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    // 防路径穿越：归一化后必须仍在 dist 内
    let filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (urlPath.endsWith('/')) filePath = join(filePath, 'index.html');
    if (!(await stat(filePath).catch(() => null))?.isFile()) {
      // SPA 兜底：未知路径回首页（FSA 授权刷新场景）
      filePath = join(ROOT, 'index.html');
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(500).end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`cc-config-webui → http://127.0.0.1:${PORT}（dist/ 静态托管）`);
});
