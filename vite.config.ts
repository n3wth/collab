import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/gemini': {
          target: 'https://generativelanguage.googleapis.com',
          changeOrigin: true,
          rewrite: () => `/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY}`,
        },
      },
    },
    test: {
      globals: true,
      environment: 'node',
    },
  }
})
