import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api và /ws sang backend FastAPI (cổng 8000) để chạy được cả từ máy khác trong LAN
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // cho phép truy cập qua tên miền tunnel (cloudflared)
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
})
