import { defineConfig } from '@playwright/test';

/**
 * E2E de navegador.
 *
 * Levanta el frontend de verdad y lo apunta al backend REAL: el objetivo es demostrar que una
 * persona puede hacer el recorrido completo con un ratón, no que los componentes rendericen.
 * El backend debe estar corriendo (puerto 3999 por defecto) (`npm run start:dev --workspace
 * @businessbrain/backend`).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  /**
   * Se sirve el BUILD, no el servidor de desarrollo.
   *
   * Dos motivos, y el segundo es el que obligó a cambiarlo. El primero: estas pruebas dicen que
   * una persona puede usar el producto, y lo que se despliega es el bundle de producción — con
   * `vite dev` se estaba verificando otro artefacto.
   *
   * El segundo: `vite dev` vigila ficheros y en Windows se caía al cerrarse (0xC0000409), de modo
   * que la ejecución siguiente arrancaba sobre un puerto que aún no estaba libre y la suite
   * fallaba una vez de cada dos. Una suite intermitente no es una señal: es ruido que acaba
   * ignorándose. `preview` sirve estáticos, arranca y para limpiamente.
   *
   * `reuseExistingServer: false` a propósito: reutilizar un servidor que quizá esté muriendo es
   * exactamente cómo se reintrodujo esa intermitencia.
   */
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
