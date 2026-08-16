import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  csrfTokenMatches,
  readCookie,
} from '../domain/session-cookies';

/**
 * Exige el doble envío del testigo CSRF.
 *
 * Se aplica **solo a las rutas autenticadas por cookie** —refrescar y cerrar sesión—, que son
 * las únicas atacables por esta vía: el resto de la API se autentica con `Authorization:
 * Bearer`, una cabecera que el navegador nunca adjunta por su cuenta, así que un sitio de
 * terceros no puede provocar una llamada autenticada contra ellas.
 *
 * Ponerlo en todas partes daría una falsa sensación de cobertura y obligaría a arrastrar el
 * testigo en cada petición sin ganar nada.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const fromCookie = readCookie(request, CSRF_COOKIE);
    const fromHeader = request.headers[CSRF_HEADER];

    if (!csrfTokenMatches(fromCookie, fromHeader)) {
      throw new ForbiddenException(
        'Petición no verificada. Vuelve a iniciar sesión desde la aplicación',
      );
    }

    return true;
  }
}
