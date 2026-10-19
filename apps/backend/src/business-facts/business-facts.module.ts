import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecordBusinessFactsUseCase } from './application/record-business-facts.use-case';

/**
 * Hechos empresariales — Fase 9A, la vía NO documental.
 *
 * La otra mitad de cómo entra información en BusinessBrain. Los documentos entran por
 * semejanza —se trocean, se vectorizan y se recuperan—; los hechos entran por aritmética,
 * porque «¿cuánto se tarda los sábados?» es una media sobre una serie temporal y un índice
 * vectorial no la calcula: la aproxima, y aproximar una media es inventarla.
 *
 * **No conoce ningún proveedor.** Recibe lotes ya normalizados; el vocabulario de cada TPV
 * o programa de facturación vive dentro de su conector y muere ahí.
 *
 * Las dos vías convergen más adelante, en el `Insight`, que es lo único que ya sabe llevar
 * evidencia, confianza, vigencia y decisión humana.
 */
@Module({
  imports: [PrismaModule],
  providers: [RecordBusinessFactsUseCase],
  exports: [RecordBusinessFactsUseCase],
})
export class BusinessFactsModule {}
