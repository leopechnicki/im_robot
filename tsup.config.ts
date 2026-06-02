import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      'index': 'src/index.ts',
      'core/index': 'src/core/index.ts',
      'react/index': 'src/react/index.ts',
      'vue/index': 'src/vue/index.ts',
      'web-component/index': 'src/web-component/index.ts',
      'server/index': 'src/server/index.ts',
      'mcp/index': 'src/mcp/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    clean: true,
    external: ['react', 'react-dom', 'vue', 'svelte', 'ioredis', '@opentelemetry/api'],
    treeshake: true,
    sourcemap: true,
  },
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
    format: ['cjs'],
    splitting: false,
    clean: false,
    treeshake: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
])
