import { defineConfig } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// Read the current package version at build time so the demo never
// drifts from what's actually published on npm.
const pkgJson = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
) as { version: string }

export default defineConfig({
  define: {
    // Injected at build time. Referenced in demo/src/main.ts via a
    // matching `declare const __IMROBOT_VERSION__: string`.
    __IMROBOT_VERSION__: JSON.stringify(pkgJson.version),
  },
  plugins: [
    {
      name: 'html-version-inject',
      transformIndexHtml(html) {
        return html.replace(/%IMROBOT_VERSION%/g, pkgJson.version)
      },
    },
  ],
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
