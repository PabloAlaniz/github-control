import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      all: false,
      // Ratchet: only raise these floors, never lower. Sprint 1 baseline
      // 2026-05-06: 91.59% lines / 81.27% branches / 96.87% functions.
      // Goal 95% lines (Sprint roadmap). If coverage drops, add tests.
      thresholds: {
        lines: 91,
        branches: 80,
        functions: 95,
        statements: 91,
      },
    },
  },
  resolve: {
    alias: {
      '@back': path.resolve(__dirname, './src'),
    },
  },
});
