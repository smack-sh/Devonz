import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    pool: 'forks',
    globals: true,
    environment: 'node',
    include: ['app/**/*.test.ts', 'app/**/*.test.tsx'],
    setupFiles: ['./app/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],
      include: ['app/**/*.ts', 'app/**/*.tsx'],
      exclude: [
        'app/test/**',
        'app/**/*.test.ts',
        'app/**/*.test.tsx',
        'app/entry.client.tsx',
        'app/entry.server.tsx',
        'app/vite-env.d.ts',
      ],
    },
  },
});
