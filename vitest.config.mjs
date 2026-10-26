import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
      'server-only': path.resolve(root, './tests/stubs/server-only.js'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    fileParallelism: false,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/app_backup/**',
      '**/backups/**',
    ],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    reporters: 'verbose'
  },
})
