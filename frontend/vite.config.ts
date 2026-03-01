/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envPrefix: 'KK_',
  resolve: {
    alias: {
      '@krakenkey/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  server: {
    allowedHosts: ['dev.krakenkey.io', 'app-dev.krakenkey.io'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
