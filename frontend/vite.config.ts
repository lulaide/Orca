import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:9000',
        timeout: 120000, // 2 分钟，git clone 可能较慢
      },
      '/healthz': 'http://localhost:9000',
    },
  },
})
