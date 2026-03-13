import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'imrobot': resolve(__dirname, '../src'),
      'imrobot/core': resolve(__dirname, '../src/core'),
      'imrobot/server': resolve(__dirname, '../src/server'),
      'imrobot/web-component': resolve(__dirname, '../src/web-component'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        docs: resolve(__dirname, 'docs.html'),
      },
    },
  },
})
