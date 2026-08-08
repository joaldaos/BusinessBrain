import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AgentMemoryConfig } from '../domain/agent-configuration';
import type { MemoryDirective } from '../domain/agent-directives';
import {
  MEMORY_STORE_PORT,
  type MemoryStorePort,
} from '../domain/ports/memory-store.port';

/**
 * Escritura de la memoria del agente — Fase 5, subfase 5.9.
 *
 * Hasta aquí `MemoryStorePort.remember()` existía y estaba probado, pero **ningún camino de
 * producción lo llamaba**: el agente recordaba de una tabla en la que nadie escribía, así que
 * la memoria estaba siempre vacía. Este caso de uso cierra el ciclo.
 *
 * Tres garantías, y ninguna es negociable:
 *
 * 1. **El alcance lo pone el SERVIDOR.** `organizationId`, `agentId` y `userId` vienen del
 *    turno autenticado, nunca de lo que el modelo escribió. El modelo aporta como mucho una
 *    clave y un valor; a quién pertenecen no lo decide él. Si pudiera, escribir en la memoria
 *    de otra persona sería tan fácil como pedirlo.
 * 2. **Un agente con estrategia `none` no escribe.** No basta con no leer: guardar recuerdos
 *    que nunca se van a recuperar acumula datos personales sin propósito ni caducidad.
 * 3. **Nunca rompe el turno.** La respuesta ya se le ha dado a la persona; que anotar falle
 *    no puede convertir un turno correcto en un error. Se registra y se sigue.
 *
 * Lo que se anota puede haberse originado en contenido ingerido —el modelo lo redacta a
 * partir de lo que ha leído—, así que la memoria es la única parte del turno que PERSISTE
 * una influencia externa. Contra eso actúan, en capas: los topes de tamaño y cantidad del
 * parser (`agent-directives.ts`), el marco explícito de "datos, no instrucciones" con el que
 * se reinyecta (`memoryBlock`), y el hecho de que ninguna memoria puede conceder una
 * herramienta ni ampliar un alcance, porque ambos se resuelven contra la configuración
 * persistida del agente y no contra el prompt.
 */
@Injectable()
export class RecordAgentMemoryUseCase {
  private readonly logger = new Logger(RecordAgentMemoryUseCase.name);

  constructor(
    @Inject(MEMORY_STORE_PORT)
    private readonly memoryStore: MemoryStorePort,
  ) {}

  async execute(params: {
    organizationId: string;
    agentId: string;
    userId: string;
    conversationId: string;
    memoryConfig: AgentMemoryConfig;
    directives: MemoryDirective[];
  }): Promise<number> {
    if (params.directives.length === 0) return 0;

    if (params.memoryConfig.strategy === 'none') {
      this.logger.debug(
        `El agente ${params.agentId} no declara memoria: se descartan ` +
          `${params.directives.length} anotaciones`,
      );
      return 0;
    }

    const scope = {
      organizationId: params.organizationId,
      agentId: params.agentId,
      userId: params.userId,
    };

    let recorded = 0;
    for (const directive of params.directives) {
      try {
        await this.memoryStore.remember(scope, {
          key: directive.key,
          value: directive.value,
          // La conversación SIEMPRE se registra, también en `long_term`: es lo que permite
          // explicar más tarde de dónde salió un recuerdo. Que se filtre o no por ella al
          // recuperar es cosa de la estrategia (`selectMemories`), no del almacenamiento.
          conversationId: params.conversationId,
        });
        recorded += 1;
      } catch (error) {
        // La respuesta ya está dada: un fallo al anotar no puede romper el turno.
        this.logger.warn(
          `No se pudo anotar "${directive.key}" para el usuario ${params.userId} ` +
            `con el agente ${params.agentId}: ${(error as Error).message}`,
        );
      }
    }

    if (recorded > 0) {
      this.logger.log(
        `${recorded} anotación(es) de memoria para el usuario ${params.userId} ` +
          `con el agente ${params.agentId}`,
      );
    }

    return recorded;
  }
}
