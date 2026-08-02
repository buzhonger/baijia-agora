import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时前端 5173，API/WS 代理到后端 8787
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
