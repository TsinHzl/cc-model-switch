import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createFileStore } from './files.mjs';
import { FileStoreError } from './errors.mjs';
import { createService } from './service.mjs';

export const MAX_BODY_BYTES = 64 * 1024;
export const BODY_TIMEOUT_MS = 5000;
export const API_RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60000;
const STATUS = {
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  SESSION_EXPIRED: 403,
  ROOT_FORBIDDEN: 403,
  READ_ONLY: 403,
  UNSAFE_PATH: 403,
  NOT_FOUND: 404,
  FILE_MISSING: 404,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  BODY_TOO_LARGE: 413,
  TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  INVALID_CONFIG: 422,
  INVALID_UTF8: 422,
  UNSUPPORTED_FILE: 422,
  METADATA_UNSUPPORTED: 422,
  RATE_LIMITED: 429,
  METADATA_CHECK_FAILED: 503,
};

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function guard(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  const host = `127.0.0.1:${req.socket.localPort}`;
  const hostCount = req.rawHeaders.filter((value, index) =>
    index % 2 === 0 && value.toLowerCase() === 'host').length;
  if (hostCount !== 1 || req.headers.host !== host) {
    throw new FileStoreError('FORBIDDEN');
  }
  return `http://${host}`;
}

function pathname(req) {
  let path;
  try {
    path = decodeURIComponent((req.url ?? '').split('?')[0]);
  } catch {
    throw new FileStoreError('INVALID_REQUEST');
  }
  if (!path.startsWith('/') || path.startsWith('//')
      || /[\\%?#\x00-\x1f\x7f-\x9f]/.test(path)
      || path.split('/').some(part => part === '.' || part === '..')) {
    throw new FileStoreError('INVALID_REQUEST');
  }
  return path;
}

function authorize(req, token, origin, bootstrap) {
  const headers = req.headers;
  if ((headers.origin !== undefined && headers.origin !== origin)
      || (headers['sec-fetch-site'] !== undefined
        && headers['sec-fetch-site'] !== 'same-origin')) {
    throw new FileStoreError('FORBIDDEN');
  }
  if (bootstrap) {
    if (headers['x-ccms-bootstrap'] !== '1'
        || headers['sec-fetch-site'] !== 'same-origin'
        || !['cors', 'same-origin'].includes(headers['sec-fetch-mode'])
        || headers['sec-fetch-dest'] !== 'empty') {
      throw new FileStoreError('FORBIDDEN');
    }
    return;
  }
  const supplied = headers['x-ccms-token'];
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
      || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
    throw new FileStoreError('SESSION_EXPIRED');
  }
}

async function readJSON(req) {
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
    throw new FileStoreError('BODY_TOO_LARGE');
  }
  const bytes = await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const timer = setTimeout(
      () => finish(new FileStoreError('REQUEST_TIMEOUT')), BODY_TIMEOUT_MS,
    );
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onError);
      if (error) {
        req.resume();
        reject(error);
      } else {
        resolve(result);
      }
    }
    function onData(chunk) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) finish(new FileStoreError('BODY_TOO_LARGE'));
      else chunks.push(chunk);
    }
    function onEnd() {
      finish(null, Buffer.concat(chunks));
    }
    function onError() {
      finish(new FileStoreError('INVALID_REQUEST'));
    }
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onError);
  });
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new FileStoreError('INVALID_REQUEST');
  }
}

async function dispatch(req, res, service, path, origin) {
  if (req.method === 'GET' && path === '/api/state') {
    json(res, 200, { success: true, data: await service.state() });
    return;
  }
  const apply = req.method === 'POST' && path === '/api/apply';
  const append = req.method === 'POST' && path === '/api/entries';
  const item = /^\/api\/entries\/([^/]+)$/.exec(path);
  const change = item && ['PATCH', 'DELETE'].includes(req.method);
  if (!apply && !append && !change) throw new FileStoreError('NOT_FOUND');
  let index;
  if (change) {
    index = Number(item[1]);
    if (!/^(0|[1-9]\d*)$/.test(item[1]) || !Number.isSafeInteger(index)) {
      throw new FileStoreError('INVALID_REQUEST');
    }
  }
  if (req.headers.origin !== origin) throw new FileStoreError('FORBIDDEN');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
    req.headers['content-type'] ?? '',
  ) || req.headers['content-encoding'] !== undefined) {
    throw new FileStoreError('UNSUPPORTED_MEDIA');
  }
  const body = await readJSON(req);
  if (apply) await service.apply(body);
  else await service.change(req.method, index, body);
  res.writeHead(204).end();
}

export async function createApiHandler({ home }) {
  const service = createService(await createFileStore({ home }));
  const token = randomBytes(32).toString('hex');
  let windowStart = performance.now();
  let count = 0;
  return async (req, res, next) => {
    try {
      const origin = guard(req, res);
      const path = pathname(req);
      if (path !== '/api' && !path.startsWith('/api/')) {
        await next(path);
        return;
      }
      const bootstrap = req.method === 'GET' && path === '/api/bootstrap';
      authorize(req, token, origin, bootstrap);
      if (req.url.includes('?') || (req.method === 'GET'
          && (Number(req.headers['content-length']) > 0
            || req.headers['transfer-encoding'] !== undefined))) {
        throw new FileStoreError('INVALID_REQUEST');
      }
      const now = performance.now();
      if (now - windowStart >= RATE_WINDOW_MS) {
        windowStart = now;
        count = 0;
      }
      if (++count > API_RATE_LIMIT) {
        res.setHeader('Retry-After', Math.ceil((RATE_WINDOW_MS - now + windowStart) / 1000));
        throw new FileStoreError('RATE_LIMITED');
      }
      if (bootstrap) json(res, 200, { success: true, data: { token } });
      else await dispatch(req, res, service, path, origin);
    } catch (error) {
      const safe = error instanceof FileStoreError
        ? error : new FileStoreError('IO_FAILED');
      const status = STATUS[safe.code] ?? 500;
      if (status >= 500) process.stderr.write(`本机请求失败：${safe.code}\n`);
      if (res.destroyed) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.setHeader('Connection', 'close');
      json(res, status, { success: false, code: safe.code, error: safe.message });
    }
  };
}
