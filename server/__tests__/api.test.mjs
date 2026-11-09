import fs from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalServer } from '../../server.mjs';
import { API_RATE_LIMIT, BODY_TIMEOUT_MS, MAX_BODY_BYTES } from '../api.mjs';
import { groupConfigs, insertZshrcBlock } from '../../dist-server/domain.mjs';

const rootUser = process.getuid?.() === 0 || process.geteuid?.() === 0;
const writeIt = process.platform === 'darwin' ? it : it.skip;
const A = {
  model: 'model-a', base_url: 'https://example.invalid/a',
  key: 'fixture-only-key-a', channel: 'channel-a',
};
const B = {
  model: 'model-b', base_url: 'https://example.invalid/b',
  key: 'fixture-only-key-b', channel: 'channel-b',
};
const identity = ({ model, base_url, key }) => ({ model, base_url, key });
const serialize = entries => `${JSON.stringify(entries, null, 4)}\n`;
const SETTINGS = JSON.stringify({
  env: {
    ANTHROPIC_MODEL: A.model, ANTHROPIC_BASE_URL: A.base_url,
    ANTHROPIC_AUTH_TOKEN: A.key, KEEP: 'settings-private-marker',
  },
});
const ZSHRC = '# zshrc-private-marker\n';
const INDEX = '<main>fixture application</main>';

describe.skipIf(rootUser)('本机业务 API', () => {
  let base, home, root, paths, server, token;
  const origin = () => `http://127.0.0.1:${server.address().port}`;

  async function start() {
    server = await createLocalServer({ home, root });
    expect(server.listening).toBe(false);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }

  async function stop() {
    if (!server?.listening) return;
    const closed = new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
    server.closeAllConnections();
    await closed;
  }

  function request(path, {
    method = 'GET', headers = {}, body, raw, chunks, stall = false,
  } = {}) {
    const data = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const requestHeaders = {
      host: new URL(origin()).host, origin: origin(),
      'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty', 'x-ccms-bootstrap': '1',
      ...(token ? { 'x-ccms-token': token } : {}),
      ...(data !== undefined || chunks || stall
        ? { 'content-type': 'application/json' } : {}),
      ...(data !== undefined && !chunks && !stall
        ? { 'content-length': Buffer.byteLength(data) } : {}),
      ...headers,
    };
    for (const name of Object.keys(requestHeaders)) {
      if (requestHeaders[name] === undefined) delete requestHeaders[name];
    }
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: '127.0.0.1', port: server.address().port,
        path, method, headers: requestHeaders, agent: false,
      }, res => {
        const received = [];
        res.on('data', chunk => received.push(chunk));
        res.once('error', reject);
        res.once('end', () => {
          const text = Buffer.concat(received).toString('utf8');
          resolve({
            status: res.statusCode, headers: res.headers, text,
            json: () => JSON.parse(text),
          });
          req.destroy();
        });
      });
      req.once('error', reject);
      req.setTimeout(BODY_TIMEOUT_MS + 5000, () => req.destroy(new Error('测试请求超时')));
      if (stall) {
        req.write('{');
        return;
      }
      if (chunks) {
        for (const chunk of chunks) req.write(chunk);
      }
      req.end(data);
    });
  }

  async function bootstrap() {
    const response = await request('/api/bootstrap');
    expect(response.status).toBe(200);
    token = response.json().data.token;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    return response;
  }

  async function snapshot() {
    return Object.fromEntries(await Promise.all(Object.entries(paths).map(
      async ([key, path]) => {
        const stat = await fs.stat(path, { bigint: true });
        return [key, {
          text: await fs.readFile(path, 'utf8'), ino: stat.ino, mtimeNs: stat.mtimeNs,
        }];
      },
    )));
  }

  function expectError(response, status, code) {
    expect(response.status).toBe(status);
    expect(response.json()).toMatchObject({ success: false, code });
    for (const secret of [home, root, A.key, B.key, 'settings-private-marker', 'zshrc-private-marker']) {
      expect(response.text).not.toContain(secret);
    }
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  }

  beforeEach(async () => {
    token = undefined;
    server = undefined;
    base = await fs.realpath(await fs.mkdtemp(join(os.tmpdir(), 'ccms-http-')));
    home = join(base, 'home');
    root = join(base, 'dist');
    await fs.mkdir(join(home, '.claude'), { recursive: true });
    await fs.mkdir(root);
    paths = {
      config: join(home, 'change-ai-config.json'),
      settings: join(home, '.claude', 'settings.json'),
      zshrc: join(home, '.zshrc'),
    };
    await Promise.all([
      fs.writeFile(paths.config, serialize([A, B]), { mode: 0o600 }),
      fs.writeFile(paths.settings, SETTINGS, { mode: 0o600 }),
      fs.writeFile(paths.zshrc, ZSHRC, { mode: 0o600 }),
      fs.writeFile(join(root, 'index.html'), INDEX),
      fs.writeFile(join(root, 'asset.js'), 'export default 1;\n'),
    ]);
    await start();
  });

  afterEach(async () => {
    try {
      await stop();
    } finally {
      if (base) await fs.rm(base, { recursive: true, force: true });
    }
  });

  it('bootstrap 与 state 返回约定结构，不暴露原始文件', async () => {
    const first = await bootstrap();
    expect(first.headers['cache-control']).toBe('no-store');
    const response = await request('/api/state');
    expect(response.status).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      data: { entries: [A, B], groups: groupConfigs([A, B]), activeIndex: 0 },
    });
    expect(response.text).not.toContain('settings-private-marker');
    expect(response.text).not.toContain('zshrc-private-marker');
  });

  it('配置缺失不阻止 bootstrap，state 返回安全错误', async () => {
    await Promise.all(Object.values(paths).map(path => fs.unlink(path)));
    await bootstrap();
    expectError(await request('/api/state'), 404, 'FILE_MISSING');
  });

  it.each(['/', '/api/bootstrap', '/api/state'])('所有路径校验 Host：%s', async path => {
    await bootstrap();
    for (const host of ['localhost:15858', '127.0.0.1:0', 'attacker.invalid']) {
      expectError(await request(path, {
        headers: { host, 'x-forwarded-host': new URL(origin()).host },
      }), 403, 'FORBIDDEN');
    }
  });

  it.each([
    { 'x-ccms-bootstrap': undefined },
    { 'sec-fetch-site': undefined },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'none' },
    { 'sec-fetch-mode': 'no-cors' },
    { 'sec-fetch-mode': 'navigate' },
    { 'sec-fetch-dest': 'document' },
    { origin: 'http://attacker.invalid' },
  ])('bootstrap 拒绝非同源 fetch：%j', async headers => {
    expectError(await request('/api/bootstrap', { headers }), 403, 'FORBIDDEN');
  });

  it('校验 token，服务重建后旧 token 失效', async () => {
    const first = await request('/api/bootstrap', { headers: { origin: undefined } });
    expect(first.status).toBe(200);
    token = first.json().data.token;
    for (const supplied of [undefined, 'bad-token', '0'.repeat(64)]) {
      expectError(await request('/api/state', {
        headers: { 'x-ccms-token': supplied },
      }), 403, 'SESSION_EXPIRED');
    }
    const previous = token;
    await stop();
    await start();
    expectError(await request('/api/state'), 403, 'SESSION_EXPIRED');
    await bootstrap();
    expect(token).not.toBe(previous);
  });

  it('拒绝跨站、缺失 Origin、表单与预检写入', async () => {
    await bootstrap();
    const body = { expected: identity(B) };
    for (const value of [undefined, 'null', 'http://attacker.invalid']) {
      expectError(await request('/api/apply', {
        method: 'POST', body, headers: { origin: value },
      }), 403, 'FORBIDDEN');
    }
    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']) {
      expectError(await request('/api/apply', {
        method: 'POST', body, headers: { 'content-type': type },
      }), 415, 'UNSUPPORTED_MEDIA');
    }
    expectError(await request('/api/apply', {
      method: 'OPTIONS', headers: { 'sec-fetch-site': 'cross-site' },
    }), 403, 'FORBIDDEN');
  });

  it.each([
    ['/api/apply', 'POST', null],
    ['/api/apply', 'POST', []],
    ['/api/apply', 'POST', { expected: identity(A), home: '/unused' }],
    ['/api/apply', 'POST', { expected: A }],
    ['/api/apply', 'POST', { expected: { ...identity(A), key: 1 } }],
    ['/api/entries', 'POST', { entry: { ...A, path: '/unused' } }],
    ['/api/entries', 'POST', { entry: { ...A, channel: null } }],
    ['/api/entries', 'POST', { entry: { ...A, model: 'bad\nvalue' } }],
    ['/api/entries', 'POST', { entry: { ...A, key: '\uD800' } }],
    ['/api/entries', 'POST', { entry: { ...A, model: ' ' } }],
    ['/api/entries/0', 'PATCH', { expected: identity(A) }],
    ['/api/entries/0', 'DELETE', { expected: identity(A), entry: B }],
  ])('拒绝非法业务输入：%s %s %#', async (path, method, body) => {
    await bootstrap();
    const before = await snapshot();
    expectError(await request(path, { method, body }), 400, 'INVALID_REQUEST');
    expect(await snapshot()).toEqual(before);
  });

  it.each(['-1', '01', '1.0', '1e2', 'NaN', '9007199254740992'])('拒绝非法下标：%s', async index => {
    await bootstrap();
    expectError(await request(`/api/entries/${index}`, {
      method: 'DELETE', body: { expected: identity(A) },
    }), 400, 'INVALID_REQUEST');
  });

  it('拒绝坏 JSON、坏 UTF-8、GET 正文和 API 查询参数', async () => {
    await bootstrap();
    for (const raw of ['{broken', Buffer.from([0xff])]) {
      expectError(await request('/api/apply', { method: 'POST', raw }), 400, 'INVALID_REQUEST');
    }
    expectError(await request('/api/state', {
      raw: '{}', headers: { 'content-length': 2 },
    }), 400, 'INVALID_REQUEST');
    expectError(await request('/api/state?home=/unused'), 400, 'INVALID_REQUEST');
  });

  it('限制声明长度与分块正文大小', async () => {
    await bootstrap();
    const large = 'x'.repeat(MAX_BODY_BYTES + 1);
    expectError(await request('/api/apply', {
      method: 'POST', raw: large, headers: { 'content-length': large.length },
    }), 413, 'BODY_TOO_LARGE');
    expectError(await request('/api/apply', {
      method: 'POST', chunks: ['x'.repeat(MAX_BODY_BYTES), 'x'],
    }), 413, 'BODY_TOO_LARGE');
  });

  it('正文超时不写文件', async () => {
    await bootstrap();
    const before = await snapshot();
    expectError(await request('/api/apply', {
      method: 'POST', stall: true,
    }), 408, 'REQUEST_TIMEOUT');
    expect(await snapshot()).toEqual(before);
  }, BODY_TIMEOUT_MS + 5000);

  it('限制通过鉴权的 API 请求次数', async () => {
    for (let index = 0; index < API_RATE_LIMIT; index++) {
      expect((await request('/api/bootstrap')).status).toBe(200);
    }
    const response = await request('/api/bootstrap');
    expectError(response, 429, 'RATE_LIMITED');
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('损坏 settings 回退 zshrc，不改文件', async () => {
    await fs.writeFile(paths.settings, '{broken-settings-private-marker');
    await fs.writeFile(paths.zshrc, insertZshrcBlock(ZSHRC, B));
    const before = await snapshot();
    await bootstrap();
    expect((await request('/api/state')).json().data.activeIndex).toBe(1);
    expect(await snapshot()).toEqual(before);
  });

  writeIt('apply 重定位最新条目，仅写 zshrc；重复应用不写', async () => {
    await bootstrap();
    const moved = { ...B, channel: 'external-channel', future: true };
    await fs.writeFile(paths.config, serialize([moved, A]));
    const before = await snapshot();
    const apply = () => request('/api/apply', {
      method: 'POST', body: { expected: identity(B) },
    });
    expect((await apply()).status).toBe(204);
    const after = await snapshot();
    expect(after.settings).toEqual(before.settings);
    expect(after.config).toEqual(before.config);
    expect(after.zshrc.text).toBe(insertZshrcBlock(ZSHRC, moved));
    expect(after.zshrc.ino).not.toBe(before.zshrc.ino);
    expect((await request('/api/state')).json().data.activeIndex).toBe(1);
    expect((await apply()).status).toBe(204);
    expect(await snapshot()).toEqual(after);
  });

  writeIt.each(['model', 'base_url', 'key'])('apply 拒绝过期三元组：%s', async field => {
    await bootstrap();
    await fs.writeFile(paths.config, serialize([A, { ...B, [field]: 'external' }]));
    const before = await snapshot();
    expectError(await request('/api/apply', {
      method: 'POST', body: { expected: identity(B) },
    }), 409, 'CONFLICT');
    expect(await snapshot()).toEqual(before);
  });

  writeIt('CRUD 保持格式和未知字段语义，仅写 config', async () => {
    const originalA = { ...A, future: { keep: 'a' } };
    const originalB = { ...B, future: { keep: 'b' } };
    await fs.writeFile(paths.config, serialize([originalA, originalB]));
    await bootstrap();
    const before = await snapshot();
    const added = { ...A, model: 'added' };
    const edited = { ...B, model: 'edited' };
    expect((await request('/api/entries', {
      method: 'POST', body: { entry: added },
    })).status).toBe(204);
    expect(await fs.readFile(paths.config, 'utf8')).toBe(serialize([originalA, originalB, added]));
    expect((await request('/api/entries/1', {
      method: 'PATCH', body: { expected: identity(B), entry: edited },
    })).status).toBe(204);
    expect(await fs.readFile(paths.config, 'utf8')).toBe(serialize([originalA, edited, added]));
    expect((await request('/api/entries/2', {
      method: 'DELETE', body: { expected: identity(added) },
    })).status).toBe(204);
    const after = await snapshot();
    expect(after.config.text).toBe(serialize([originalA, edited]));
    expect(after.settings).toEqual(before.settings);
    expect(after.zshrc).toEqual(before.zshrc);
  });

  writeIt('并发新增不丢失增量', async () => {
    await bootstrap();
    const additions = [{ ...A, model: 'new-a' }, { ...B, model: 'new-b' }];
    const responses = await Promise.all(additions.map(entry =>
      request('/api/entries', { method: 'POST', body: { entry } })));
    expect(responses.map(response => response.status)).toEqual([204, 204]);
    const entries = JSON.parse(await fs.readFile(paths.config, 'utf8'));
    expect(entries).toHaveLength(4);
    expect(entries.slice(0, 2)).toEqual([A, B]);
    expect(entries.slice(2)).toEqual(expect.arrayContaining(additions));
  });

  writeIt('编辑及删除拒绝下标漂移、三元组变化与越界', async () => {
    await bootstrap();
    await fs.writeFile(paths.config, serialize([B, A]));
    const before = await snapshot();
    for (const method of ['PATCH', 'DELETE']) {
      for (const [index, expected] of [
        [0, identity(A)], [1, { ...identity(A), key: 'stale' }], [99, identity(A)],
      ]) {
        expectError(await request(`/api/entries/${index}`, {
          method, body: { expected, ...(method === 'PATCH' ? { entry: A } : {}) },
        }), 409, 'CONFLICT');
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it.each([`{"private":"${A.key}"`, 'null', '{}', '[null]', '[{"model":1}]'])(
    '磁盘损坏错误不泄露原文：%#',
    async text => {
      await fs.writeFile(paths.config, text);
      await bootstrap();
      expectError(await request('/api/state'), 422, 'INVALID_CONFIG');
    },
  );

  writeIt('transform 内配置错误保持类型且不写文件', async () => {
    await fs.writeFile(paths.config, `{"private":"${A.key}"`);
    await bootstrap();
    const before = await snapshot();
    for (const [path, body] of [
      ['/api/apply', { expected: identity(A) }], ['/api/entries', { entry: B }],
    ]) {
      expectError(await request(path, { method: 'POST', body }), 422, 'INVALID_CONFIG');
    }
    expect(await snapshot()).toEqual(before);
  });

  it('未知 API 不回退 SPA，静态页面支持安全回退和 HEAD', async () => {
    await bootstrap();
    for (const path of ['/api', '/api/missing', '/api/state/extra']) {
      expectError(await request(path), 404, 'NOT_FOUND');
    }
    expect((await request('/client/route')).text).toBe(INDEX);
    expect((await request('/asset.js')).headers['content-type']).toBe('text/javascript; charset=utf-8');
    const head = await request('/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.text).toBe('');
  });

  it.each([
    '/../private', '/%2e%2e/private', '/assets/../private', '/%252e%252e/private',
    '/%zz', '/bad\\path', '//attacker.invalid/path', 'http://attacker.invalid/path',
  ])('拒绝静态遍历与坏编码：%s', async path => {
    expectError(await request(path), 400, 'INVALID_REQUEST');
  });

  it('静态 realpath 拒绝越界链接和悬空链接', async () => {
    const outside = join(base, 'dist-private');
    await fs.mkdir(outside);
    await fs.writeFile(join(outside, 'secret.txt'), A.key);
    await fs.symlink(outside, join(root, 'leak'));
    await fs.symlink(join(outside, 'secret.txt'), join(root, 'linked.txt'));
    await fs.symlink(join(outside, 'missing.txt'), join(root, 'dangling.txt'));
    for (const path of ['/leak/secret.txt', '/leak/missing.js', '/linked.txt', '/dangling.txt']) {
      expectError(await request(path), 403, 'UNSAFE_PATH');
    }
    await fs.symlink(join(root, 'asset.js'), join(root, 'inside.js'));
    expect((await request('/inside.js')).text).toBe('export default 1;\n');
  });
});
