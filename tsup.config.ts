import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'core/index': 'src/core/index.ts',
    'react/index': 'src/react/index.ts',
    'vue/index': 'src/vue/index.ts',
    'web-component/index': 'src/web-component/index.ts',

  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  clean: true,
  external: ['react', 'react-dom', 'vue', 'svelte'],
  treeshake: true,
  sourcemap: true,
})
