import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Paginación compartida por toda la API — subfase 6.4.
 *
 * Vive en `common` porque el tope de página es una decisión del sistema, no de cada módulo:
 * si cada superficie eligiera el suyo, la primera que se olvidara devolvería la organización
 * entera y nadie lo notaría hasta que un tenant creciera.
 *
 * El techo es DURO y se aplica en la consulta, no después: un `limit` desmesurado se rechaza
 * en la validación, y ningún listado puede pedir "todo".
 */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = DEFAULT_PAGE_SIZE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

/** Valores efectivos de página, con el techo aplicado también en el servicio. */
export function pageBounds(params: { limit?: number; offset?: number }): {
  take: number;
  skip: number;
} {
  return {
    // El techo se reaplica aquí a propósito: el DTO protege la superficie HTTP, pero un
    // consumidor interno que llamara al servicio directamente se lo saltaría.
    take: Math.min(params.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    skip: Math.max(params.offset ?? 0, 0),
  };
}
