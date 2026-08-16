import { Module } from '@nestjs/common';
import { KnowledgeEngineModule } from '../knowledge-engine/knowledge-engine.module';
import { UnderstandingEngineModule } from '../understanding-engine/understanding-engine.module';
import { ReportsController } from './api/reports.controller';
import { ReportsService } from './application/reports.service';
import { ComposeReportUseCase } from './application/compose-report.use-case';
import { PdfRenderer } from './infrastructure/pdf-renderer';

/**
 * Informes — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * Importa los dos motores porque un informe se compone EXCLUSIVAMENTE por sus puntos de
 * lectura: `RetrieveInsights` (§12) y `RetrieveContext` (§13). No consulta `Insight` ni
 * `KnowledgeChunk` por su cuenta — hacerlo abriría un tercer camino a los datos con reglas
 * distintas, sin decaimiento, sin frescura y sin curación heredada.
 *
 * No importa ningún cliente HTTP, de correo ni de almacenamiento externo, y no es descuido:
 * generar un informe no puede producir ningún efecto fuera del sistema. El PDF se devuelve en
 * la respuesta y se descarta.
 */
@Module({
  imports: [KnowledgeEngineModule, UnderstandingEngineModule],
  controllers: [ReportsController],
  providers: [ReportsService, ComposeReportUseCase, PdfRenderer],
  exports: [ReportsService],
})
export class ReportsModule {}
