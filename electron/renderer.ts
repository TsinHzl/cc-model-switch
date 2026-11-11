import { readFile, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';

export const RENDERER_SCHEME = 'cc-model-switch';
export const RENDERER_URL = `${RENDERER_SCHEME}://app/index.html`;
const DEVELOPMENT_ORIGIN = 'http://127.0.0.1:5173';
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  'connect-src http: https:',
  "base-uri 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join('; ');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function getRendererUrl(packaged: boolean, developmentUrl?: string): string {
  if (packaged || !developmentUrl) return RENDERER_URL;
  if (developmentUrl !== DEVELOPMENT_ORIGIN && developmentUrl !== `${DEVELOPMENT_ORIGIN}/`) {
    throw new Error('桌面开发地址不受支持');
  }
  return DEVELOPMENT_ORIGIN;
}

function respond(body: BodyInit | null, status: number, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

export async function serveRenderer(request: Request, root: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return respond(null, 405);
  const url = new URL(request.url);
  if (url.protocol !== `${RENDERER_SCHEME}:` || url.host !== 'app' || url.username || url.password) {
    return respond(null, 403);
  }
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (pathname !== '/index.html' && !/^\/assets\/[A-Za-z0-9_.-]+$/.test(pathname)) {
    return respond(null, 404);
  }
  const contentType = CONTENT_TYPES[extname(pathname)];
  if (!contentType) return respond(null, 404);
  try {
    const directory = await realpath(root);
    const file = await realpath(join(directory, pathname.slice(1)));
    if (!file.startsWith(`${directory}${sep}`)) return respond(null, 403);
    const content = await readFile(file);
    return respond(request.method === 'HEAD' ? null : new Uint8Array(content), 200, contentType);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return respond(null, 404);
    console.error('读取桌面资源失败');
    return respond(null, 500);
  }
}
