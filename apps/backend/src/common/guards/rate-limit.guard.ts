import { Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * El límite de peticiones, con un mensaje que se entiende.
 *
 * `ThrottlerGuard` responde "ThrottlerException: Too Many Requests". Eso es un nombre de clase
 * y un estado HTTP en inglés — exactamente lo que esta pantalla no debe enseñarle a una
 * panadería que ha escrito mal su contraseña tres veces.
 *
 * ## El mensaje dice cuánto hay que esperar, y no dice nada más
 *
 * "Espera un minuto" es accionable. Lo que NO se dice es por qué se ha llegado al límite:
 * distinguir "has fallado la contraseña muchas veces" de "hay demasiadas peticiones desde tu
 * red" le confirmaría a quien está probando contraseñas que va por buen camino.
 *
 * El detalle sí queda en el registro del servidor, con la ruta y la dirección de origen: es
 * lo que permite ver después si alguien estuvo insistiendo.
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _context: unknown,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottlerException(
      `Demasiados intentos. Espera ${describeWait(detail.timeToBlockExpire)} y vuelve a probar.`,
    );
  }
}

/** Segundos → algo que una persona lee sin traducir. */
function describeWait(seconds: number): string {
  if (seconds <= 60) return 'un minuto';
  const minutos = Math.ceil(seconds / 60);
  if (minutos < 60) return `${minutos} minutos`;

  const horas = Math.ceil(minutos / 60);
  return horas === 1 ? 'una hora' : `${horas} horas`;
}
