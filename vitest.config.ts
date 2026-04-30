import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    environmentMatchGlobs: [
      // Server SDK and integration tests use crypto.subtle — run in native Node.
      ['test/server.test.ts', 'node'],
      ['test/integration.test.ts', 'node'],
      ['test/core.test.ts', 'node'],
      ['test/v04-features.test.ts', 'node'],
      ['test/security-audit.test.ts', 'node'],
      ['test/middleware.test.ts', 'node'],
      ['test/adaptive.test.ts', 'node'],
      ['test/turnstile.test.ts', 'node'],
      ['test/replay-guard.test.ts', 'node'],
      ['test/analytics.test.ts', 'node'],
    ],
    coverage: {
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})
