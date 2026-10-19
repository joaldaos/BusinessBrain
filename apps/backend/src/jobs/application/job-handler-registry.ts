import { Inject, Injectable, Optional } from '@nestjs/common';
import { JOB_HANDLER, type JobHandler } from '../domain/ports/job-queue.port';

/**
 * Único punto que sabe quién atiende cada tipo de trabajo.
 *
 * Mismo patrón que `ConnectorRegistry` y `ProviderRegistry`: los manejadores se declaran
 * como proveedores con el token `JOB_HANDLER` y el despachador no conoce ninguno.
 *
 * Dos manejadores con la misma clave son un error de arranque, no una precedencia
 * silenciosa: si dos piezas creen atender `connector.sync`, cuál gane dependería del orden
 * de los módulos y el trabajo acabaría ejecutándose en el sitio equivocado.
 */
@Injectable()
export class JobHandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  constructor(
    @Optional() @Inject(JOB_HANDLER) handlers: JobHandler[] | JobHandler | null,
  ) {
    const lista = normalizar(handlers);
    for (const handler of lista) {
      if (this.handlers.has(handler.kind)) {
        throw new Error(
          `Hay dos manejadores declarados para el trabajo "${handler.kind}". ` +
            `Cada clase de trabajo debe tener exactamente uno.`,
        );
      }
      this.handlers.set(handler.kind, handler);
    }
  }

  /** `null` cuando nadie sabe atenderlo — el despachador lo entierra en vez de insistir. */
  get(kind: string): JobHandler | null {
    return this.handlers.get(kind) ?? null;
  }

  kinds(): string[] {
    return [...this.handlers.keys()];
  }
}

/**
 * Nest entrega un array con `multi`, pero un único proveedor llega suelto y ninguno llega
 * como `undefined`. Normalizar aquí evita que el constructor tenga que defenderse de las
 * tres formas.
 */
function normalizar(
  handlers: JobHandler[] | JobHandler | null | undefined,
): JobHandler[] {
  if (!handlers) return [];
  return Array.isArray(handlers) ? handlers : [handlers];
}
