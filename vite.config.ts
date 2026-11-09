import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { userInfo } from 'node:os';
import { createApiHandler } from './server/api.mjs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-config-api',
      async configureServer(server) {
        if (process.env.VITEST) return;
        const api = await createApiHandler({ home: userInfo().homedir });
        server.middlewares.use((req, res, next) => {
          void api(req, res, () => next());
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    cors: false,
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
