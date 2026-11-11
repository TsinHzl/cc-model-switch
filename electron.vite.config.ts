import { fileURLToPath } from 'node:url';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  main: {
    build: {
      outDir: fromRoot('./out/main'),
      lib: {
        entry: fromRoot('./electron/main.ts'),
        formats: ['es'],
      },
      rollupOptions: { output: { entryFileNames: 'index.js' } },
    },
  },
  preload: {
    build: {
      outDir: fromRoot('./out/preload'),
      externalizeDeps: false,
      lib: {
        entry: fromRoot('./electron/preload.ts'),
        formats: ['cjs'],
      },
      rollupOptions: { output: { entryFileNames: 'index.cjs' } },
    },
  },
  renderer: {
    root: fromRoot('./'),
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      cors: false,
    },
    build: {
      outDir: fromRoot('./out/renderer'),
      rollupOptions: { input: fromRoot('./index.html') },
    },
  },
});
