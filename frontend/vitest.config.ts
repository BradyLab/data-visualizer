// Unit/component tests (Vitest + jsdom). Kept apart from vite.config.ts so the dev-only plugins (devtools) are not loaded for tests
import path from 'path'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: {
      '@src': path.resolve(import.meta.dirname, './src'),
      '@commons': path.resolve(import.meta.dirname, '../commons'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    css: false,
    server: { deps: { inline: ['vuetify'] } },
  },
})
