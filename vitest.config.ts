import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./test/setup.ts'],
    environmentMatchGlobs: [
      // Server SDK and integration tests use crypto.subtle which jsdom doesn't expose.
      // Run them in Node's native environment where Web Crypto is available.
      ['test/server.test.ts', 'node'],
      ['test/integration.test.ts', 'node'],
      ['test/core.test.ts', 'node'],
      ['test/v04-features.test.ts', 'node'],
      ['test/security-audit.test.ts', 'node'],
      ['test/middleware.test.ts', 'node'],
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
