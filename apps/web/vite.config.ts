import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * El backend se sirve bajo el MISMO origen: así el frontend no necesita saber dónde vive la API
 * ni lidiar con CORS, y el mismo código funciona en producción detrás de un proxy inverso.
 *
 * Se declara una vez y se usa en `server` y en `preview`, porque son ajustes distintos de Vite y
 * los E2E de navegador se sirven con `preview`: si solo estuviera en `server`, las llamadas a
 * `/api` de esas pruebas no llegarían a ninguna parte.
 */
const apiProxy = {
  '/api': {
    target: process.env.BB_API_URL ?? 'http://localhost:3999',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 5173, proxy: apiProxy },
  // Los E2E de navegador los ejecuta Playwright, no Vitest: comparten extensión pero no
  // corredor, y sin excluirlos Vitest intenta cargarlos y falla.
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
