import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
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
