import { defineConfig } from '@playwright/test';

/**
 * E2E de navegador — el recorrido comercial, sobre el build real.
 *
 * ## Playwright es dueño de TODO el entorno
 *
 * Levanta el backend y el frontend, y los para al terminar. Antes el backend se arrancaba a
 * mano y la suite heredaba lo que ese proceso tuviera montado: qué claves, qué proveedores
 * redirigidos y, sobre todo, qué había quedado en la base de datos de la ejecución anterior.
 * Eso hacía que la misma suite pasara o fallara según lo que se hubiera hecho antes — y una
 * suite intermitente no es una señal, es ruido que acaba ignorándose.
 *
 * ## Los proveedores externos van redirigidos
 *
 * Cada spec levanta su propio servidor sustituto —Google en 4599, OpenAI en 4699— y el backend
 * arranca apuntando a ellos. Es lo que permite recorrer el flujo COMPLETO sin credenciales
 * reales: consentimiento de OAuth, vectorización, recuperación y respuesta con citas.
 *
 * `OPENAI_API_KEY` se pasa igualmente porque el proveedor sigue exigiendo credencial aunque el
 * destino esté redirigido, y eso NO debe relajarse: es la comprobación que evita salir a la red
 * sin clave.
 */

/** Un solo sitio donde se declara el entorno del backend de pruebas. */
const backendEnv = {
  NODE_ENV: 'test',
  OPENAI_API_KEY: 'clave-de-prueba',
  OPENAI_CHAT_URL: 'http://127.0.0.1:4699/v1/chat/completions',
  OPENAI_EMBEDDINGS_URL: 'http://127.0.0.1:4699/v1/embeddings',
  GOOGLE_CLIENT_ID: 'cliente-de-prueba',
  GOOGLE_CLIENT_SECRET: 'secreto-de-prueba',
  GOOGLE_OAUTH_BASE_URL: 'http://127.0.0.1:4599/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'http://127.0.0.1:4599/token',
  GOOGLE_REVOKE_URL: 'http://127.0.0.1:4599/revoke',
  GMAIL_API_URL: 'http://127.0.0.1:4599/gmail/v1/users/me',
  // El conector web lee una página servida en local durante el recorrido principal.
  ALLOW_LOOPBACK_FETCH: 'true',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // Un solo trabajador: los servidores sustitutos usan puertos fijos y las especificaciones
  // comparten backend. Paralelizar exigiría un puerto por spec y no compra nada aquí.
  workers: 1,
  // Cero reintentos a propósito: un test que solo pasa al segundo intento no está diciendo la
  // verdad sobre el producto, y esconderlo detrás de un reintento es peor que verlo fallar.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // El backend compilado, no `start:dev`: es el artefacto que se despliega.
      command: 'npm run start:e2e --workspace @businessbrain/backend',
      url: 'http://localhost:3999/health',
      cwd: '../..',
      env: backendEnv,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      /**
       * Se sirve el BUILD, no el servidor de desarrollo.
       *
       * Estas pruebas dicen que una persona puede usar el producto, y lo que se despliega es
       * el bundle de producción. Además `vite dev` vigila ficheros y en Windows se caía al
       * cerrarse (0xC0000409), dejando el puerto ocupado para la ejecución siguiente.
       * `preview` sirve estáticos, arranca y para limpiamente.
       */
      command: 'npm run build && npm run preview',
      url: 'http://localhost:5173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
