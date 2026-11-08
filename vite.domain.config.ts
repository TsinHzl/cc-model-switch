import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'dist-server',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/lib/serverDomain.ts',
      formats: ['es'],
      fileName: () => 'domain.mjs',
    },
  },
});
