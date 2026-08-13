import { Injectable } from '@nestjs/common';
import type { AnalysisRun } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Historial de ejecuciones de análisis — subfase 6.1.
 *
 * Solo lectura y solo metadatos de ejecución: qué se analizó, cuándo, con qué resultado y por
 * qué falló si falló. **No devuelve comprensión.** El único punto de lectura de comprensión
 * sigue siendo `RetrieveInsights` (§12), y por eso este servicio no expone los `Insight`
 * producidos: quien los quiera pasa por la ruta que aplica el alcance por persona.
 *
 * Existe como servicio en vez de resolverse en el controlador porque ningún otro controlador
 * del sistema consulta Prisma directamente; hacerlo aquí habría sido la primera excepción, y
 * las excepciones a "la API delega en aplicación" son justo las que después nadie recuerda
 * por qué existen.
 */
@Injectable()
export class AnalysisRunsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: {
    organizationId: string;
    limit: number;
    offset: number;
  }): Promise<AnalysisRun[]> {
    return this.prisma.analysisRun.findMany({
      // Filtro de organización: primero y sin excepción.
      where: { organizationId: params.organizationId },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
    });
  }
}
