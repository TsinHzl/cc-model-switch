import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { createFileStore } from '../server/files.js';
import { createService } from '../server/service.js';
import { clipboardIpcChannel } from '../src/lib/clipboardIpcContract';
import { configIpcChannels } from '../src/lib/configIpcContract';
import { createClipboardHandler } from './clipboardIpc';
import { createConfigHandlers } from './configIpc';
import { getRendererUrl, RENDERER_SCHEME, serveRenderer } from './renderer';

let trustedWindow: {
  readonly window: BrowserWindow;
  readonly targetUrl: string;
} | null = null;

function registerAppIpc(
  options: Parameters<typeof createConfigHandlers>[0],
): () => void {
  const handlers = createConfigHandlers(options);
  const clipboardHandler = createClipboardHandler({
    getTrustedWindow: options.getTrustedWindow,
    writeText: text => clipboard.writeText(text),
  });
  const registered: string[] = [];
  const dispose = () => {
    for (const channel of registered.splice(0)) ipcMain.removeHandler(channel);
  };
  try {
    for (const method of Object.keys(handlers) as Array<keyof typeof handlers>) {
      const channel = configIpcChannels[method];
      ipcMain.handle(channel, handlers[method]);
      registered.push(channel);
    }
    ipcMain.handle(clipboardIpcChannel, clipboardHandler);
    registered.push(clipboardIpcChannel);
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}

function reportStartupFailure(): void {
  console.error('桌面启动失败');
  dialog.showErrorBox('启动失败', '无法初始化桌面应用，请检查运行账户和应用安装。');
  app.quit();
}

async function createWindow(): Promise<void> {
  const developmentUrl = import.meta.env.DEV ? process.env.ELECTRON_RENDERER_URL : undefined;
  const target = getRendererUrl(app.isPackaged, developmentUrl);
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  trustedWindow = { window, targetUrl: target };
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (trustedWindow?.window === window) trustedWindow = null;
  });
  await window.loadURL(target);
}

export async function bootstrap(
  options: { readonly resolveHome: () => string },
): Promise<ReturnType<typeof createService> | undefined> {
  let dispose = () => {};
  let stopped = false;
  const stop = () => {
    stopped = true;
    trustedWindow = null;
    dispose();
  };
  const fail = () => { stop(); reportStartupFailure(); };
  try {
    protocol.registerSchemesAsPrivileged([{
      scheme: RENDERER_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    }]);
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('second-instance', () => {
      const window = trustedWindow?.window;
      if (window?.isMinimized()) window.restore();
      window?.focus();
    });
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
    await app.whenReady();
    const store = await createFileStore({ home: options.resolveHome() });
    const service = createService(store);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.on('will-download', event => event.preventDefault());
    const root = fileURLToPath(new URL('../renderer/', import.meta.url));
    protocol.handle(RENDERER_SCHEME, request => serveRenderer(request, root));
    dispose = registerAppIpc({ service, getTrustedWindow: () => trustedWindow });
    app.on('will-quit', stop);
    app.on('activate', () => {
      if (!stopped && !trustedWindow) void createWindow().catch(fail);
    });
    await createWindow();
    return stopped ? undefined : service;
  } catch {
    fail();
  }
}
