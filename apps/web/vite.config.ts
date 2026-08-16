import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // El backend se sirve bajo el mismo origen en desarrollo: así el frontend no necesita
    // saber dónde vive la API ni lidiar con CORS, y el mismo código funciona en producción
    // detrás de un proxy inverso.
    proxy: { '/api': { target: process.env.BB_API_URL ?? 'http://localhost:3999', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '') } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.ts' },
});
