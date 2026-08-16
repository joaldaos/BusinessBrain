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
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
