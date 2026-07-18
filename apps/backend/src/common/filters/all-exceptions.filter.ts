import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Filtro global (ver main.ts). Normaliza cualquier error no controlado a una forma
 * JSON consistente y evita filtrar detalles internos (stack traces, mensajes de
 * Postgres/Prisma) en producción.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const message = isHttpException
      ? exception.getResponse()
      : 'Error interno del servidor';

    if (!isHttpException) {
      this.logger.error(
        exception instanceof Error ? exception.stack : exception,
      );
    }

    response.status(status).json({
      statusCode: status,
      error:
        typeof message === 'string'
          ? message
          : (message as Record<string, unknown>),
      timestamp: new Date().toISOString(),
    });
  }
}
