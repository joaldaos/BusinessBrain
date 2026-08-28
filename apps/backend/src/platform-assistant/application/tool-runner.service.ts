import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PlatformOrganizationsService } from '../../platform/application/organizations.service';
import { PlatformAuditService } from '../../platform/application/platform-audit.service';
import { PlatformAccessService } from '../../platform-access/application/platform-access.service';
import { OrganizationInspectionService } from '../../platform-access/application/organization-inspection.service';
import {
  ASSISTANT_TOOLS,
  TOOL_OUTCOMES,
  resolveTool,
  sanitizeInput,
  type AssistantTool,
  type ToolOutcome,
} from '../domain/tools';

export interface ToolExecution {
  tool: string;
  outcome: ToolOutcome;
  /** Lo que se le devuelve al modelo. `null` cuando no se ejecutó. */
  result: unknown;
}

/**
 * El único sitio donde una herramienta del asistente se convierte en una consulta.
 *
 * ## Esta clase NO conoce Prisma, ni SQL, ni la red
 *
 * Sus cuatro dependencias son servicios de aplicación que ya existían y que ya tenían dueño:
 * el catálogo de clientes, la traza administrativa, las concesiones y la inspección por
 * alcance. Cada uno mantiene sus propias garantías —selecciones explícitas, listas cerradas,
 * comprobación de concesión— y el asistente hereda todas sin poder relajar ninguna.
 *
 * No es una preferencia de diseño. Si esta clase recibiera `PrismaService`, la frontera
 * dejaría de existir: cualquier herramienta futura podría escribir su propia consulta y las
 * garantías pasarían a depender de que quien la escriba se acuerde. Hay una prueba estructural
 * que falla si este módulo llega a importar Prisma, `fetch` o `process.env`.
 *
 * ## Y las concesiones se comprueban aquí, con el servicio de siempre
 *
 * `assertUsable` es exactamente el mismo método que usa el panel. Comprueba alcance,
 * titularidad, caducidad y revocación, deniega con un mensaje que no revela si existe una
 * concesión ajena, y **registra el uso**. El asistente no tiene una vía distinta: si la
 * tuviera, sería una segunda implementación del permiso, y una de las dos acabaría
 * desactualizada.
 */
@Injectable()
export class AssistantToolRunner {
  private readonly logger = new Logger(AssistantToolRunner.name);

  constructor(
    private readonly organizations: PlatformOrganizationsService,
    private readonly audit: PlatformAuditService,
    private readonly access: PlatformAccessService,
    private readonly inspection: OrganizationInspectionService,
  ) {}

  /**
   * Ejecuta lo que el modelo pidió, si es que pidió algo que existe.
   *
   * Nunca lanza hacia arriba: una denegación es un RESULTADO del turno, no un fallo. El bucle
   * necesita poder devolvérsela al modelo para que explique qué falta, y una excepción
   * cortaría la conversación justo cuando hay algo útil que decir.
   */
  async run(params: {
    adminId: string;
    tool: unknown;
    input: unknown;
  }): Promise<ToolExecution> {
    const tool = resolveTool(params.tool);
    if (!tool) {
      // Incluye todo lo que no está: `execute_sql`, `read_documents`, `http_get`… No hay una
      // lista de prohibidas porque no hace falta: lo que no está en el catálogo no existe.
      return {
        tool: typeof params.tool === 'string' ? params.tool.slice(0, 60) : '?',
        outcome: TOOL_OUTCOMES.UNKNOWN_TOOL,
        result: null,
      };
    }

    const input = sanitizeInput(tool, params.input);

    if (tool.permission.kind === 'GRANT') {
      const organizationId = input.organizationId;
      if (!organizationId) {
        return {
          tool: tool.name,
          outcome: TOOL_OUTCOMES.MISSING_PARAMETER,
          result: null,
        };
      }

      try {
        // El MISMO método que usa el panel: alcance, titularidad, caducidad, revocación — y
        // registro del uso. `what` dice que vino del asistente, para que el cliente pueda
        // distinguir en su historial una consulta hecha a mano de una hecha preguntando.
        await this.access.assertUsable({
          organizationId,
          adminId: params.adminId,
          scope: tool.permission.scope,
          what: `assistant:${tool.name}`,
        });
      } catch (error) {
        if (error instanceof ForbiddenException) {
          // Se devuelve un CÓDIGO, no el mensaje. El mensaje de la denegación es idéntico
          // para "no hay concesión", "es de otro alcance" y "es de otra persona" —
          // precisamente para no revelar el mapa de accesos ajenos— y meterlo en el contexto
          // del modelo solo añadiría una frase que puede repetir mal.
          return {
            tool: tool.name,
            outcome: TOOL_OUTCOMES.NEEDS_GRANT,
            result: null,
          };
        }
        throw error;
      }
    }

    return {
      tool: tool.name,
      outcome: TOOL_OUTCOMES.OK,
      result: await this.execute(tool, params.adminId, input),
    };
  }

  /**
   * El despacho, herramienta por herramienta.
   *
   * Un `switch` explícito y no un mapa de funciones: se lee de arriba abajo y se ve de un
   * vistazo que son seis, cuáles son y a qué servicio va cada una. Añadir una obliga a
   * escribir su rama aquí, delante de las otras cinco.
   */
  private async execute(
    tool: AssistantTool,
    adminId: string,
    input: Record<string, string>,
  ): Promise<unknown> {
    switch (tool.name) {
      case ASSISTANT_TOOLS.PLATFORM_OVERVIEW.name:
        return this.organizations.overview();

      case ASSISTANT_TOOLS.LIST_ORGANIZATIONS.name:
        return this.organizations.list(Number(input.page));

      case ASSISTANT_TOOLS.ORGANIZATION_METADATA.name:
        return this.inspection.overview(input.organizationId);

      case ASSISTANT_TOOLS.ORGANIZATION_DIAGNOSTICS.name:
        return this.inspection.diagnostics(input.organizationId);

      case ASSISTANT_TOOLS.MY_ACCESS.name:
        // Acotado a quien pregunta por el servicio, no por un parámetro: el modelo no puede
        // pedir los accesos de otra persona porque no hay dónde escribir ese identificador.
        return this.access.listForAdmin(adminId);

      case ASSISTANT_TOOLS.PLATFORM_AUDIT.name:
        return this.audit.list({
          page: Number(input.page),
          code: input.code,
          organizationId: input.organizationId,
        });

      default: {
        /**
         * Aquí `tool` es `never`, y eso es la garantía: TypeScript ha comprobado que las seis
         * ramas de arriba cubren el catálogo ENTERO.
         *
         * Declarar una herramienta sin darle despacho no compila. No hace falta confiar en
         * que quien añada la séptima se acuerde de escribir su consulta: si no lo hace, el
         * `build` falla antes de que exista una herramienta que el modelo pueda pedir y que
         * el ejecutor no sepa atender.
         */
        const exhaustiva: never = tool;
        this.logger.error(
          `Herramienta sin despacho: ${JSON.stringify(exhaustiva)}`,
        );
        return null;
      }
    }
  }
}
