/**
 * Qué webs pueden hablar con esta API desde el navegador de un cliente.
 *
 * ## Por qué esto no puede tener un valor por defecto cómodo
 *
 * Hasta ahora era `origin: frontendUrl ?? true`, y `FRONTEND_URL` era opcional. Un despliegue
 * que olvidara esa variable —o un contenedor que la perdiera al cambiar de proveedor— aceptaba
 * peticiones **con credenciales desde cualquier web del mundo**, sin fallar, sin avisar y sin
 * que nada en la aplicación se comportara distinto. El fallo más peligroso no es el que rompe:
 * es el que funciona.
 *
 * Ahora en producción no existe ese camino. `FRONTEND_URL` es obligatoria (ver
 * `env.validation.ts`) y aquí se convierte en un único origen autorizado.
 *
 * ## Y por qué no basta con `SameSite=Strict`
 *
 * La cookie de refresco es `Strict` y eso ya impide que otro sitio la use. Pero esa es UNA
 * defensa, en el navegador, para UNA cookie. No cubre el token `Bearer` que la interfaz guarda
 * en memoria, ni un futuro endpoint que se autentique de otra forma, ni la lectura de
 * respuestas por parte de un script de otro origen. Apoyar toda la seguridad de origen cruzado
 * en un atributo de cookie es apoyarla en que nadie añada nunca nada que no sea una cookie.
 *
 * ## Por qué se decide por petición y no con una lista
 *
 * Configurar el middleware con una lista de orígenes funciona para `Allow-Origin`, pero
 * `Allow-Credentials: true` sale igual **aunque el origen no coincida**. En la práctica es
 * inofensivo, porque el navegador exige las dos cabeceras a la vez. En la práctica. Decidir
 * por petición hace que a un origen no autorizado no se le responda absolutamente nada: la
 * garantía deja de depender de cómo se comporte hoy el navegador.
 *
 * ## En desarrollo sí es cómodo, y a propósito
 *
 * Fuera de producción se acepta cualquier `localhost` o `127.0.0.1`, con cualquier puerto:
 * Vite cambia de puerto solo cuando el 5173 está ocupado, y perseguir eso a mano no protege de
 * nada. Ninguna de esas expresiones puede coincidir con un dominio público, así que la
 * comodidad no viaja al despliegue.
 */

/** Lo que se responde a UNA petición concreta. `false` = ninguna cabecera de origen cruzado. */
export interface CorsDecision {
  origin: string | false;
  credentials: boolean;
}

/**
 * Orígenes de desarrollo. Solo bucle local: un atacante que consiguiera que la víctima
 * resolviera `localhost` a otra máquina ya tendría un problema mucho mayor que este.
 */
const LOOPBACK_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
];

export interface CorsContext {
  isProduction: boolean;
  frontendUrl?: string;
}

/** Los orígenes que este entorno acepta. Separado para poder leerlo y comprobarlo aparte. */
export function allowedOriginsFor(context: CorsContext): (string | RegExp)[] {
  const configured = normalizeOrigin(context.frontendUrl);

  if (context.isProduction) {
    // Sin `FRONTEND_URL` no se llega hasta aquí: el arranque falla antes. Si aun así llegara
    // —un despliegue que se saltara la validación— la lista vacía DENIEGA TODO, que es el
    // fallo correcto: la interfaz deja de funcionar y alguien lo arregla. Lo contrario abre la
    // API entera y nadie se entera.
    return configured ? [configured] : [];
  }

  return configured ? [configured, ...LOOPBACK_ORIGINS] : LOOPBACK_ORIGINS;
}

export function corsDecisionFor(
  context: CorsContext & { requestOrigin?: string },
): CorsDecision {
  const { requestOrigin } = context;

  // Sin cabecera `Origin` no hay nada que autorizar: es una petición del mismo sitio o de algo
  // que no es un navegador. Responder cabeceras de origen cruzado ahí no significa nada.
  if (!requestOrigin) return { origin: false, credentials: false };

  const permitido = allowedOriginsFor(context).some((allowed) =>
    typeof allowed === 'string'
      ? allowed === requestOrigin
      : allowed.test(requestOrigin),
  );

  return permitido
    ? { origin: requestOrigin, credentials: true }
    : { origin: false, credentials: false };
}

/**
 * `https://app.empresa.com/` → `https://app.empresa.com`.
 *
 * La cabecera `Origin` del navegador nunca lleva camino ni barra final. Configurar la variable
 * con la barra —lo natural al copiarla del navegador— haría que la comparación fallara siempre
 * y que la interfaz dejara de funcionar en producción y no en local. Se normaliza aquí en vez
 * de pedirle a quien despliega que acierte con un detalle invisible.
 */
function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    // La validación de entorno ya exige una URL absoluta; esto solo evita que un valor
    // extraño derribe el arranque con un error que no explica nada.
    return undefined;
  }
}
