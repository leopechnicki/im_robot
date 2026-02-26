import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'imrobot': resolve(__dirname, '../src'),
      'imrobot/core': resolve(__dirname, '../src/core'),
      'imrobot/web-component': resolve(__dirname, '../src/web-component'),
    },
  },
})
