import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalysisRunTrigger, MembershipRole } from '@businessbrain/database';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { OrgRoles } from '../../common/decorators/roles.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import type { RequestOrganization } from '../../common/types/authenticated-request';
import { TriggerAnalysisRunUseCase } from '../application/trigger-analysis-run.use-case';
import { ManualTriggerAdmissionService } from '../application/manual-trigger-admission.service';
import { AnalysisRunsService } from '../application/analysis-runs.service';
import {
  PaginationQueryDto,
  TriggerAnalysisRunDto,
} from '../dto/understanding.dto';

/**
 * Ejecuciones de análisis — subfase 6.1.
 *
 * Es el endpoint que enciende el motor: hasta ahora `TriggerAnalysisRun` no tenía ningún
 * consumidor, así que **ninguna organización había producido jamás un `Insight`** fuera de
 * los tests.
 *
 * **Solo ADMIN.** No por jerarquía, sino por coste: una ejecución hace tres recuperaciones
 * vectoriales y tres llamadas al modelo contra la clave del propio cliente. Y razona sobre
 * TODO el conocimiento de la organización, que es lo correcto por diseño (§3.4) — el alcance
 * por persona se aplica al LEER la comprensión, no al producirla. Quien lanza un análisis
 * está gastando dinero de la empresa y mirando todo su conocimiento: es una decisión de
 * responsable.
 *
 * **Síncrono en 6.1.** Devuelve el resultado real de la ejecución. Pasarlo a asíncrono exige
 * cola y planificador, deliberadamente diferidos: esta subfase es sobre alcanzabilidad, no
 * sobre rendimiento.
 *
 * **El control de concurrencia vive AQUÍ, no en el dominio.** `UNDERSTANDING_ENGINE_DESIGN.md`
 * rechaza explícitamente serializar los `AnalysisRun` por organización (§20, tabla de
 * alternativas): varias ejecuciones simultáneas son legítimas y son el modo normal de
 * operación, y la corrección la garantizan la unicidad de identidad de sujeto y
 * `ResolveInsightConflict`, no un cerrojo. Lo que sí admite el diseño —y lo sitúa como
 * "control operativo, nunca invariante de dominio" (§3.1)— es acotar el coste en la
 * superficie que lo provoca. Eso es `ManualTriggerAdmissionService`: protege este endpoint
 * del doble clic y del reintento del proxy, responde 409, y **no lo atraviesa ningún disparo
 * automático**, de modo que un futuro planificador, evento o agente conserva la concurrencia
 * intacta.
 */
@Controller('analysis-runs')
@UseGuards(OrgRoleGuard)
export class AnalysisRunsController {
  constructor(
    private readonly triggerAnalysisRun: TriggerAnalysisRunUseCase,
    private readonly admission: ManualTriggerAdmissionService,
    private readonly analysisRuns: AnalysisRunsService,
  ) {}

  @Post()
  @OrgRoles(MembershipRole.ADMIN)
  async trigger(
    @CurrentOrg() org: RequestOrganization,
    @Body() dto: TriggerAnalysisRunDto,
  ) {
    const since = this.parseSince(dto.since);

    // Control OPERATIVO del disparo manual, no invariante de dominio: reserva el hueco frente
    // a un doble clic o al reintento del proxy. Un disparo automático —planificador, evento,
    // agente— no pasa por aquí y conserva la concurrencia del §3.1 intacta.
    const claimed = await this.admission.claim(org.id);

    try {
      return await this.triggerAnalysisRun.execute({
        organizationId: org.id,
        // El disparo por HTTP es MANUAL por definición. Los demás orígenes corresponden a
        // vías que no existen todavía y aceptarlos aquí falsearía la procedencia.
        trigger: AnalysisRunTrigger.MANUAL,
        since,
        // Adopta la fila reservada en vez de crear otra.
        existingRunId: claimed.id,
      });
    } catch (error) {
      // Si ni siquiera llegó a arrancar, se libera el hueco: dejarlo ocupado bloquearía el
      // siguiente disparo manual hasta que venciera el umbral de abandono.
      await this.admission.releaseUnstarted(claimed.id);
      throw error;
    }
  }

  /** Historial de ejecuciones: qué se analizó, cuándo y con qué resultado. */
  @Get()
  @OrgRoles(MembershipRole.ADMIN)
  list(
    @CurrentOrg() org: RequestOrganization,
    @Query() query: PaginationQueryDto,
  ) {
    return this.analysisRuns.list({
      organizationId: org.id,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });
  }

  /**
   * Una fecha inválida se rechaza en vez de convertirse en `Invalid Date`, que se propagaría
   * hasta la consulta y produciría un 500 sin explicar nada.
   */
  private parseSince(raw?: string): Date | undefined {
    if (!raw) return undefined;

    const since = new Date(raw);
    if (Number.isNaN(since.getTime())) {
      throw new BadRequestException(
        '`since` debe ser una fecha ISO 8601 válida',
      );
    }

    return since;
  }
}
