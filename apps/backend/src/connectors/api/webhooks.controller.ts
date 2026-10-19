import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ReceiveWebhookUseCase } from '../application/receive-webhook.use-case';

/**
 * La única puerta abierta del sistema.
 *
 * Es `@Public()` porque un proveedor externo no tiene sesión y no puede tenerla: la
 * autenticación la da la FIRMA, no un token. Eso la convierte en la superficie más expuesta
 * del backend, y por eso:
 *
 * - **Un tope propio y estrecho.** Un endpoint público sin límite es un amplificador: basta
 *   con repetir envíos inválidos para que el servidor gaste su tiempo verificando firmas.
 * - **Siempre 202 o 401.** Nada de 404 ni de mensajes distintos por motivo: un rechazo que
 *   explica qué falló le dice a quien prueba qué parte ya tiene bien.
 * - **No devuelve nada del conector.** Ni nombre, ni empresa, ni estado.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly receive: ReceiveWebhookUseCase) {}

  @Public()
  @Post(':connectorId')
  @HttpCode(HttpStatus.ACCEPTED)
  // Más estrecho que el resto de la API y por una razón distinta: aquí no hay sesión que
  // limitar, así que el tope es lo único que acota a quien llame.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async handle(
    @Param('connectorId') connectorId: string,
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-bb-signature') signature?: string,
    @Headers('x-bb-timestamp') timestamp?: string,
  ): Promise<{ accepted: true }> {
    /*
     * `req.rawBody` y no `@Body()`.
     *
     * La firma cubre los bytes que llegaron. Si se verificara sobre el objeto ya parseado y
     * reserializado, cualquier reescritura por el camino —un proxy que reordene claves o
     * cambie el espaciado— pasaría la comprobación, y entonces la firma no estaría
     * comprobando nada. Hay una prueba unitaria que fija justo eso.
     */
    return this.receive.receive({
      connectorId,
      rawBody: req.rawBody ?? Buffer.alloc(0),
      signature,
      timestamp,
    });
  }
}
