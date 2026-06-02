import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/web/**'],
    projects: [
      {
        test: {
          name: 'server',
          include: ['packages/server/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'shared',
          include: ['packages/shared/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'migrate',
          include: ['tools/migrate-from-legacy/src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
