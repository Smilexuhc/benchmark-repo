import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
    ],
  },
});
