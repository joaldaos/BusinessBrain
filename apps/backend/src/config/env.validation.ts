import { z } from 'zod';

/**
 * Validado una vez al arrancar (ver configuration.ts). Si falta o es inválida
 * alguna variable requerida, el proceso falla rápido en vez de arrancar en un
 * estado a medias.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  REDIS_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z
    .string()
    .min(16, 'JWT_ACCESS_SECRET debe tener al menos 16 caracteres'),
  JWT_ACCESS_EXPIRATION: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(16, 'JWT_REFRESH_SECRET debe tener al menos 16 caracteres'),
  JWT_REFRESH_EXPIRATION: z.string().default('30d'),

  // AES-256-GCM necesita una clave de 32 bytes — se exige en base64 (44 caracteres con padding).
  ENCRYPTION_KEY: z
    .string()
    .min(
      1,
      'ENCRYPTION_KEY es obligatorio (32 bytes en base64) — usado para cifrar secretos (LlmProfile.apiKeyEnc, KnowledgeSource.configEnc, etc.)',
    ),

  // Claves de proveedores LLM de plataforma (fallback cuando una organización no trae su propia
  // API key vía LlmProfile.apiKeyEnc). Ninguna es obligatoria para arrancar: sin ellas, el
  // ProviderRegistry simplemente no tiene un perfil de plataforma disponible para ese proveedor.
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  /**
   * De dónde se sirve la interfaz. En producción es OBLIGATORIA y no tiene sustituto.
   *
   * Es lo único que decide qué webs pueden hablar con esta API desde el navegador de un
   * cliente. Cuando era opcional, olvidarla no rompía nada: simplemente se aceptaban
   * peticiones con credenciales desde cualquier origen. Un fallo de configuración que no se
   * nota es peor que uno que tumba el arranque.
   */
  FRONTEND_URL: z
    .string()
    .url('FRONTEND_URL debe ser una URL absoluta, p. ej. https://app.tuempresa.com')
    .optional(),
});

/**
 * Reglas que dependen del entorno.
 *
 * Zod las expresa aparte porque no son "este campo tiene esta forma" sino "en producción este
 * campo no puede faltar". La distinción importa: en desarrollo y en test seguir sin
 * `FRONTEND_URL` es cómodo y seguro (ver `cors.ts`), y exigirla en todos lados solo añadiría
 * fricción sin cerrar ningún agujero.
 */
const envSchemaWithProductionRules = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.FRONTEND_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['FRONTEND_URL'],
      message:
        'FRONTEND_URL es obligatorio en producción — es el único origen al que se permite hablar con la API desde un navegador. Sin él no hay forma segura de decidirlo.',
    });
  }
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchemaWithProductionRules.safeParse(config);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${details}`);
  }
  return result.data;
}
