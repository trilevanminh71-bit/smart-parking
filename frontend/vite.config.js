import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api và /ws sang backend FastAPI (cổng 8000) để chạy được cả từ máy khác trong LAN
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Bản production: bỏ console.log / console.debug và debugger (giữ console.warn/error để còn dò lỗi)
  esbuild: command === 'build' ? { pure: ['console.log', 'console.debug', 'console.info'], drop: ['debugger'], legalComments: 'none' } : {},
  build: {
    target: 'es2019', // chạy tốt trên Safari iOS 13+ và trình duyệt trong Zalo
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 400,
    rollupOptions: {
      output: {
        // Tách thư viện ít thay đổi ra file riêng -> trình duyệt cache lâu, mỗi lần cập nhật web chỉ tải lại phần code app
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          if (id.includes('lucide-react')) return 'icons'
          // Leaflet chỉ tải khi mở bản đồ GPS (React.lazy) -> chunk riêng, không làm nặng trang đầu
          if (/[\\/]node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/.test(id)) return 'leaflet'
          return 'vendor'
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true, // cho phép truy cập qua tên miền tunnel (cloudflared / ngrok)
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND.replace(/^http/, 'ws'), ws: true },
    },
  },
}))
