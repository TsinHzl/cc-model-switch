import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { getRendererUrl, RENDERER_URL, serveRenderer } from '../renderer';
import type { FileStore } from '../../server/files.js';

const startup = vi.hoisted(() => ({
  registerSchemes: vi.fn(),
  requestLock: vi.fn<() => boolean>(),
  quit: vi.fn(),
  on: vi.fn(),
  whenReady: vi.fn<() => Promise<void>>(),
  createWindow: vi.fn(),
  defaultSession: vi.fn(),
  userInfo: vi.fn<() => { homedir: string }>(),
  createStore: vi.fn<(options: { home: string }) => Promise<FileStore>>(),
  read: vi.fn<FileStore['read']>(),
  update: vi.fn<FileStore['update']>(),
  loadURL: vi.fn<() => Promise<void>>(),
  showErrorBox: vi.fn(),
  handleProtocol: vi.fn(),
  handleIpc: vi.fn(),
  removeIpc: vi.fn(),
  writeText: vi.fn<(text: string) => Promise<void>>(),
}));

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(),
  userInfo: startup.userInfo,
}));
vi.mock('../../server/files.js', () => ({ createFileStore: startup.createStore }));

vi.mock('electron', () => ({
  app: {
    requestSingleInstanceLock: startup.requestLock,
    quit: startup.quit,
    on: startup.on,
    whenReady: startup.whenReady,
  },
  BrowserWindow: startup.createWindow,
  ipcMain: { handle: startup.handleIpc, removeHandler: startup.removeIpc },
  clipboard: { writeText: startup.writeText },
  dialog: { showErrorBox: startup.showErrorBox },
  protocol: {
    registerSchemesAsPrivileged: startup.registerSchemes,
    handle: startup.handleProtocol,
  },
  session: {
    get defaultSession() {
      return startup.defaultSession();
    },
  },
}));

describe('桌面启动边界', () => {
  let home: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    home = await mkdtemp(join(tmpdir(), 'cc-desktop-startup-'));
    startup.requestLock.mockReturnValue(true);
    startup.whenReady.mockReturnValue(new Promise<void>(() => {}));
    startup.userInfo.mockReturnValue({ homedir: home });
    startup.createStore.mockResolvedValue({ read: startup.read, update: startup.update });
    startup.loadURL.mockResolvedValue(undefined);
    startup.writeText.mockResolvedValue(undefined);
    startup.defaultSession.mockReturnValue({
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      on: vi.fn(),
    });
    startup.createWindow.mockImplementation(function () {
      return {
        webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn() },
        once: vi.fn(), on: vi.fn(), loadURL: startup.loadURL,
      };
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
  });

  it('导入启动模块不触发 Electron 初始化', async () => {
    await import('../bootstrap');
    for (const operation of Object.values(startup)) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it('显式启动先注册协议再申请锁，ready 前不访问会话或窗口', async () => {
    const { bootstrap } = await import('../bootstrap');
    const resolveHome = vi.fn(() => home);
    void bootstrap({ resolveHome });
    expect(startup.registerSchemes).toHaveBeenCalledOnce();
    expect(startup.requestLock).toHaveBeenCalledOnce();
    expect(startup.whenReady).toHaveBeenCalledOnce();
    expect(startup.registerSchemes.mock.invocationCallOrder[0])
      .toBeLessThan(startup.requestLock.mock.invocationCallOrder[0]);
    expect(startup.requestLock.mock.invocationCallOrder[0])
      .toBeLessThan(startup.whenReady.mock.invocationCallOrder[0]);
    expect(startup.defaultSession).not.toHaveBeenCalled();
    expect(startup.createWindow).not.toHaveBeenCalled();
    expect(resolveHome).not.toHaveBeenCalled();
    expect(startup.createStore).not.toHaveBeenCalled();
    expect(startup.handleIpc).not.toHaveBeenCalled();
    expect(startup.removeIpc).not.toHaveBeenCalled();
  });

  it('未获得单实例锁时退出，不注册后续生命周期', async () => {
    startup.requestLock.mockReturnValue(false);
    const { bootstrap } = await import('../bootstrap');
    const resolveHome = vi.fn(() => home);
    expect(await bootstrap({ resolveHome })).toBeUndefined();
    expect(startup.quit).toHaveBeenCalledOnce();
    expect(startup.on).not.toHaveBeenCalled();
    expect(startup.whenReady).not.toHaveBeenCalled();
    expect(startup.defaultSession).not.toHaveBeenCalled();
    expect(startup.createWindow).not.toHaveBeenCalled();
    expect(resolveHome).not.toHaveBeenCalled();
    expect(startup.createStore).not.toHaveBeenCalled();
    expect(startup.handleIpc).not.toHaveBeenCalled();
    expect(startup.removeIpc).not.toHaveBeenCalled();
  });

  it('生产入口显式启动一次', async () => {
    await import('../main');
    expect(startup.registerSchemes).toHaveBeenCalledOnce();
    expect(startup.requestLock).toHaveBeenCalledOnce();
    expect(startup.whenReady).toHaveBeenCalledOnce();
    expect(startup.userInfo).not.toHaveBeenCalled();
  });

  it('ready 后仅解析一次 home 并组装业务，不提前读写配置', async () => {
    let ready!: () => void;
    startup.whenReady.mockReturnValue(new Promise<void>(resolve => { ready = resolve; }));
    const resolveHome = vi.fn(() => home);
    const { bootstrap } = await import('../bootstrap');
    const result = bootstrap({ resolveHome });
    expect(resolveHome).not.toHaveBeenCalled();
    ready();
    expect(await result).toBeDefined();
    expect(resolveHome).toHaveBeenCalledOnce();
    expect(startup.createStore).toHaveBeenCalledExactlyOnceWith({ home });
    expect(startup.createStore.mock.invocationCallOrder[0])
      .toBeLessThan(startup.createWindow.mock.invocationCallOrder[0]);
    expect(startup.read).not.toHaveBeenCalled();
    expect(startup.update).not.toHaveBeenCalled();
    expect(startup.loadURL).toHaveBeenCalledOnce();
    expect(startup.handleIpc.mock.calls.map(([channel]) => channel)).toEqual([
      'config:state', 'config:apply', 'config:add', 'config:edit', 'config:remove',
      'clipboard:writeText', 'chat:start', 'chat:cancel',
    ]);
    expect(startup.writeText).not.toHaveBeenCalled();
    expect(startup.handleIpc.mock.invocationCallOrder.at(-1))
      .toBeLessThan(startup.createWindow.mock.invocationCallOrder[0]);
  });

  it('生产入口使用账户 home，不使用 HOME 环境变量', async () => {
    vi.stubEnv('HOME', join(home, 'ignored'));
    startup.whenReady.mockResolvedValue(undefined);
    await import('../main');
    await vi.waitFor(() => expect(startup.loadURL).toHaveBeenCalledOnce());
    expect(startup.userInfo).toHaveBeenCalledOnce();
    expect(startup.createStore).toHaveBeenCalledExactlyOnceWith({ home });
  });

  it.each(['registerSchemes', 'requestLock', 'userInfo'] as const)(
    '同步 %s 失败被安全处理，不创建窗口或泄露异常', async step => {
      startup.whenReady.mockResolvedValue(undefined);
      startup[step].mockImplementationOnce(() => { throw new Error('fixture-sensitive'); });
      const { bootstrap } = await import('../bootstrap');
      await expect(bootstrap({ resolveHome: () => startup.userInfo().homedir }))
        .resolves.toBeUndefined();
      expect(startup.createWindow).not.toHaveBeenCalled();
      expect(startup.showErrorBox).toHaveBeenCalledOnce();
      expect(startup.quit).toHaveBeenCalledOnce();
      expect(JSON.stringify(startup.showErrorBox.mock.calls)).not.toContain('fixture-sensitive');
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('fixture-sensitive');
    },
  );

  it.each(['whenReady', 'createStore', 'loadURL'] as const)(
    '异步 %s 失败被处理，不返回半初始化业务', async step => {
      startup.whenReady.mockResolvedValue(undefined);
      startup[step].mockRejectedValueOnce(new Error('fixture-sensitive'));
      const { bootstrap } = await import('../bootstrap');
      await expect(bootstrap({ resolveHome: () => home })).resolves.toBeUndefined();
      expect(startup.showErrorBox).toHaveBeenCalledOnce();
      expect(startup.quit).toHaveBeenCalledOnce();
      expect(JSON.stringify(startup.showErrorBox.mock.calls)).not.toContain('fixture-sensitive');
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('fixture-sensitive');
      if (step !== 'loadURL') expect(startup.createWindow).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'relative-home'])('真实文件层拒绝无效 home：%s', async home => {
    const actual = await vi.importActual<typeof import('../../server/files.js')>('../../server/files.js');
    startup.createStore.mockImplementation(actual.createFileStore);
    startup.whenReady.mockResolvedValue(undefined);
    const { bootstrap } = await import('../bootstrap');
    expect(await bootstrap({ resolveHome: () => home })).toBeUndefined();
    expect(startup.createWindow).not.toHaveBeenCalled();
    expect(startup.showErrorBox).toHaveBeenCalledOnce();
    expect(startup.userInfo).not.toHaveBeenCalled();
    expect(startup.handleIpc).not.toHaveBeenCalled();
  });
});

describe('桌面生产构建', () => {
  it('生产主进程不读取开发页面环境变量', async () => {
    const result = await build({
      configFile: false,
      envFile: false,
      logLevel: 'silent',
      define: { 'import.meta.env.DEV': 'false' },
      build: {
        write: false,
        ssr: true,
        lib: {
          entry: fileURLToPath(new URL('../main.ts', import.meta.url)),
          formats: ['es'],
        },
        rollupOptions: {
          external: ['electron', /^node:/],
        },
      },
    });
    const bundle = Array.isArray(result) ? result[0] : result;
    if (!('output' in bundle)) throw new Error('未获得主进程构建产物');
    const code = bundle.output.filter(item => item.type === 'chunk').map(item => item.code).join('\n');
    expect(code).not.toContain('ELECTRON_RENDERER_URL');
  });
});

describe('桌面 renderer 地址', () => {
  it('打包模式忽略开发地址，预览默认使用应用协议', () => {
    expect(getRendererUrl(true, 'https://example.com')).toBe(RENDERER_URL);
    expect(getRendererUrl(false)).toBe(RENDERER_URL);
  });

  it('开发模式仅接受固定 loopback 地址', () => {
    expect(getRendererUrl(false, 'http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173');
    for (const url of [
      'http://localhost:5173',
      'http://127.0.0.1:5174',
      'http://127.0.0.1:5173/other',
      'http://127.0.0.1:5173@evil.example',
      'file:///tmp/index.html',
    ]) {
      expect(() => getRendererUrl(false, url)).toThrow('桌面开发地址不受支持');
    }
  });
});

describe('桌面静态资源边界', () => {
  let temporary: string;
  let root: string;

  beforeEach(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'cc-desktop-renderer-'));
    root = join(temporary, 'renderer');
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'index.html'), '<div id="root"></div>');
    await writeFile(join(root, 'assets', 'app.js'), 'export const ready = true;');
    await writeFile(join(root, 'assets', 'app.css'), 'body { margin: 0; }');
    await writeFile(join(temporary, 'private.js'), 'private-test-data');
  });

  afterEach(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('提供入口、脚本和样式，并设置 CSP 与 MIME 防嗅探', async () => {
    for (const [path, type] of [
      ['/index.html', 'text/html'],
      ['/assets/app.js', 'text/javascript'],
      ['/assets/app.css', 'text/css'],
    ]) {
      const response = await serveRenderer(new Request(`cc-model-switch://app${path}`), root);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain(type);
      expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
      expect(response.headers.get('Content-Security-Policy')).not.toContain('unsafe-eval');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(await response.text()).not.toBe('');
    }
  });

  it('HEAD 无正文，写入请求被拒绝', async () => {
    const head = await serveRenderer(new Request(RENDERER_URL, { method: 'HEAD' }), root);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = await serveRenderer(new Request(RENDERER_URL, { method: 'POST' }), root);
    expect(post.status).toBe(405);
  });

  it('拒绝外部源、任意路径、编码穿越及未列入允许范围的文件', async () => {
    for (const url of [
      'https://app/index.html',
      'cc-model-switch://other/index.html',
      'cc-model-switch://app/api/state',
      'cc-model-switch://app/assets/%2e%2e%2fprivate.js',
      'cc-model-switch://app/assets/app.js.map',
      'cc-model-switch://app/private.js',
    ]) {
      const response = await serveRenderer(new Request(url), root);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain('private-test-data');
    }
  });

  it('缺失资源返回 404，不回退为 HTML', async () => {
    const response = await serveRenderer(new Request('cc-model-switch://app/assets/missing.js'), root);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it.skipIf(process.platform === 'win32')('拒绝资源符号链接逃出构建目录', async () => {
    await symlink(join(temporary, 'private.js'), join(root, 'assets', 'leak.js'));
    const response = await serveRenderer(new Request('cc-model-switch://app/assets/leak.js'), root);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('private-test-data');
  });

  it.skipIf(process.platform === 'win32')('拒绝通过 assets 目录链接读取外部资源', async () => {
    const outside = join(temporary, 'renderer-private');
    await mkdir(outside);
    await writeFile(join(outside, 'app.js'), 'private-directory-test-data');
    await rm(join(root, 'assets'), { recursive: true });
    await symlink(outside, join(root, 'assets'), 'dir');
    for (const method of ['GET', 'HEAD']) {
      const response = await serveRenderer(new Request(
        'cc-model-switch://app/assets/app.js', { method },
      ), root);
      expect(response.status).toBe(403);
      expect(await response.text()).toBe('');
    }
  });

  it.skipIf(process.platform === 'win32')('悬空资源链接返回空正文 404，不回退入口', async () => {
    await symlink(join(temporary, 'missing.js'), join(root, 'assets', 'dangling.js'));
    for (const method of ['GET', 'HEAD']) {
      const response = await serveRenderer(new Request(
        'cc-model-switch://app/assets/dangling.js', { method },
      ), root);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
    }
  });
});
