import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 47821,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:47822',
      '/ws/sessions': {
        target: 'ws://localhost:47822',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
