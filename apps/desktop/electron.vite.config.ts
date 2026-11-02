import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const aliases = {
  '@forgeai/shared': resolve('../../packages/shared/src/index.ts'),
  '@forgeai/ai': resolve('../../packages/ai/src/index.ts'),
  '@forgeai/core': resolve('../../packages/core/src/index.ts'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer/src'),
};

export default defineConfig({
  main: {
    resolve: { alias: aliases },
    ssr: { noExternal: ['@forgeai/shared', '@forgeai/ai', '@forgeai/core'] },
    build: {
      outDir: 'out/main',
      externalizeDeps: { exclude: ['@forgeai/shared', '@forgeai/ai', '@forgeai/core'] },
      rollupOptions: {
        external: ['electron', 'node-pty'],
      },
    },
  },
  preload: {
    resolve: { alias: aliases },
    ssr: { noExternal: ['@forgeai/shared'] },
    build: {
      outDir: 'out/preload',
      externalizeDeps: { exclude: ['@forgeai/shared'] },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: aliases },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true,
      target: 'chrome140',
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('monaco-editor')) return 'monaco';
            if (id.includes('node_modules/react')) return 'react';
          },
        },
      },
    },
  },
});
