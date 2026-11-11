import { app } from 'electron';
import { bootstrap } from '../bootstrap';
import { createTestResources, type TestResources } from './resources';

function start(): void {
  let resources: TestResources | undefined;
  let started = false;
  try {
    const pathSwitches = ['user-data-dir', 'disk-cache-dir', 'log-file'];
    if (app.isPackaged || app.isReady()
        || pathSwitches.some(name => app.commandLine.hasSwitch(name))
        || process.env.ELECTRON_LOG_FILE) {
      throw new Error('不支持的隔离测试启动状态或路径覆盖');
    }
    resources = createTestResources();
    console.error('隔离测试目录：', resources.root);
    app.setPath('home', resources.home);
    app.setPath('userData', resources.userData);
    app.setPath('sessionData', resources.sessionData);
    app.setPath('crashDumps', resources.crashDumps);
    app.setAppLogsPath(resources.logs);
    const { home } = resources;
    started = true;
    void bootstrap({ resolveHome: () => home });
  } catch {
    if (resources && !started) {
      try {
        resources.cleanup();
      } catch {
        console.error('隔离测试资源清理失败');
      }
    }
    console.error('隔离测试入口初始化失败');
    app.exit(1);
  }
}

start();
