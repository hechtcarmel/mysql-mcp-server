import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { statements: 90, branches: 80, functions: 85, lines: 90 }
    },
    projects: [
      { test: { name: 'unit', include: ['tests/*.test.ts'] } },
      {
        test: { name: 'integration', include: ['tests/integration/*.test.ts'], testTimeout: 30000, hookTimeout: 30000 }
      }
    ]
  }
});
