import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// `npm run dev`: Vite melayani UI (HMR) dan meneruskan semua rute API ke app lokal (node server.js).
const API = process.env.KLIP_API || 'http://127.0.0.1:3002';
const routes = ['auth', 'auto', 'upload', 'providers', 'keys', 'history', 'clip', 'suggest', 'yt', 'yt-info', 'download', 'downloads', 'out', 'logos', 'media', 'brand', 'fonts'];
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { [`^/(${routes.join('|')})(/|$)`]: { target: API, changeOrigin: false } } },
});
