import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Trazabilidad de auditoría — subfase 6.2.
 *
 * `@Global` por el mismo motivo que `PrismaModule`: auditar es transversal y lo necesitan
 * agentes, plantillas, conocimiento, comprensión y recomendaciones. Importarlo en cada
 * módulo repetiría cinco veces la misma línea y, sobre todo, crearía dependencias entre
 * bounded contexts que no existen en el dominio — el Knowledge Engine no depende del
 * Understanding Engine por el hecho de que ambos dejen traza.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
