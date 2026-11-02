import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@forgeai/shared': resolve('packages/shared/src/index.ts'),
      '@forgeai/ai': resolve('packages/ai/src/index.ts'),
      '@forgeai/core': resolve('packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
    ],
    reporters: 'default',
  },
});
