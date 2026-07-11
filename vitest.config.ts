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
      ['test/web-bot-auth.test.ts', 'node'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/index.ts', // barrel files — re-exports only
        'src/svelte/**', // .svelte files not processed by v8
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
})
