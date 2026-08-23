import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from './common/interceptors/transform-response.interceptor';
import type { CorsOptionsDelegate } from '@nestjs/common/interfaces/external/cors-options.interface';
import { corsDecisionFor } from './common/http/cors';

/** Lo único que se mira de la petición para decidir el origen. */
interface CorsRequest {
  headers?: Record<string, unknown>;
}

/**
 * Todo lo que envuelve a la aplicación antes de escuchar: origen cruzado, cookies, validación,
 * errores y forma de la respuesta.
 *
 * ## Por qué vive fuera de `main.ts`
 *
 * Vivía dentro, y el arranque de los tests de extremo a extremo lo REPETÍA a mano, con un
 * comentario que decía "exactamente la misma configuración que main.ts". Ese comentario era la
 * confesión del problema: dos listas que hay que acordarse de mantener iguales acaban
 * separándose, y cuando se separan la suite prueba una aplicación que no es la que se despliega
 * — justo lo que hace inútil un test de extremo a extremo.
 *
 * Y no es teórico: la política de origen cruzado no existía en el arranque de los tests. Se
 * podía cerrar mal y ninguna prueba se habría enterado.
 */
export interface AppSurfaceOptions {
  isProduction: boolean;
  frontendUrl?: string;
}

export function configureApp(
  app: INestApplication,
  options: AppSurfaceOptions,
): void {
  /**
   * Cabeceras de seguridad.
   *
   * ## La política de contenido de una API puede ser la más estricta que existe
   *
   * Esto no sirve páginas: sirve JSON y algún PDF. No carga scripts, ni hojas de estilo, ni
   * imágenes, ni se mete en un marco. Así que `default-src 'none'` y `frame-ancestors 'none'`
   * no son una política ajustada con pinzas que pueda romper algo: son la descripción literal
   * de lo que esta aplicación hace. Una CSP permisiva "por si acaso" sería peor, porque el día
   * que alguien devuelva HTML desde aquí por error, no habría nada que lo frenara.
   *
   * ## Lo que se desactiva a propósito
   *
   * `crossOriginResourcePolicy` en `cross-origin`. La interfaz vive en OTRO origen —ese es el
   * despliegue normal— y la política estricta de helmet está pensada para servidores que
   * sirven recursos incrustables. Aquí bloquearía el caso legítimo sin cerrar ninguno ilegítimo:
   * quien decide qué origen puede hablar con esta API es la política de origen cruzado de
   * abajo, no esta cabecera.
   *
   * `Strict-Transport-Security` solo en producción: en `http://localhost` obligar a HTTPS deja
   * el navegador del desarrollador redirigiendo a un sitio que no existe, y esa cabecera se
   * queda cacheada meses.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: options.isProduction
        ? { maxAge: 15_552_000, includeSubDomains: true }
        : false,
    }),
  );

  // Se decide por petición, no con una lista fija: así a un origen no autorizado no se le
  // responde ninguna cabecera de origen cruzado, ni siquiera `Allow-Credentials`.
  const corsDelegate: CorsOptionsDelegate<CorsRequest> = (
    request,
    callback,
  ) => {
    const origin = request.headers?.origin;
    callback(
      null,
      corsDecisionFor({
        ...options,
        requestOrigin: typeof origin === 'string' ? origin : undefined,
      }),
    );
  };
  app.enableCors(corsDelegate);

  // El token de refresco viaja en una cookie `HttpOnly`: sin esto, `req.cookies` no existe y
  // no habría forma de leerla.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new TransformResponseInterceptor());
}
