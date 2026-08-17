import { Logger } from '@nestjs/common';

/**
 * Redirigir un servicio externo a otro sitio. **Nunca en producción.**
 *
 * ## Por qué existe
 *
 * BusinessBrain depende de servicios de terceros —Google, proveedores de modelos, y mañana
 * WhatsApp o un CRM— y hay garantías que solo se pueden verificar recorriendo el flujo
 * COMPLETO: que la cookie del consentimiento de OAuth vuelve desde otro sitio, que una
 * respuesta con citas llega a la pantalla, que una sincronización no duplica. Ninguna de esas
 * cosas se demuestra con un doble inyectado en un módulo de pruebas, porque el doble sustituye
 * justamente la parte que se quiere ver funcionando de punta a punta.
 *
 * La alternativa sería exigir credenciales reales para verificar el producto, y entonces nadie
 * lo verifica: ni en CI, ni al arreglar un fallo un domingo. Este ayudante es lo que permite
 * que cada integración nueva sea comprobable de verdad desde el primer día, que es la capacidad
 * interna que hace rápido añadir la siguiente.
 *
 * ## Por qué la guarda es lo importante
 *
 * Sin ella, una variable de entorno mal puesta en un despliegue mandaría los tokens de los
 * clientes —o su conocimiento— a un servidor cualquiera, y todo seguiría pareciendo normal. En
 * producción se ignora **y se registra**: un despliegue mal configurado tiene que notarse, no
 * funcionar de otra manera en silencio.
 *
 * Es la misma decisión que `ALLOW_LOOPBACK_FETCH` en el conector web: una capacidad de pruebas
 * que el entorno de producción desactiva por construcción, no por convención.
 */
export function externalEndpoint(fallback: string, envVar: string): string {
  const override = process.env[envVar];
  if (!override) return fallback;

  if (process.env.NODE_ENV === 'production') {
    new Logger('ExternalEndpoint').error(
      `Se ignora ${envVar}: redirigir un servicio externo está prohibido en producción`,
    );
    return fallback;
  }

  return override;
}
