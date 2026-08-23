import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
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
