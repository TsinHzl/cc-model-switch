import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'electron-vite';
import production from './electron.vite.config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const { main, preload, renderer } = production;
if (!main || !preload || !renderer) {
  throw new Error('桌面生产构建配置缺少必要目标');
}

export default defineConfig({
  main: mergeConfig(main, {
    build: {
      outDir: fromRoot('./out-test/main'),
      lib: { entry: fromRoot('./electron/testing/main.ts') },
    },
  }),
  preload: mergeConfig(preload, {
    build: { outDir: fromRoot('./out-test/preload') },
  }),
  renderer: mergeConfig(renderer, {
    build: { outDir: fromRoot('./out-test/renderer') },
  }),
});
