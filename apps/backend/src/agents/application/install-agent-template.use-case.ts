import { Injectable, Logger } from '@nestjs/common';
import { AgentTemplatesService } from './agent-templates.service';
import { AgentsService, type AgentWithScope } from './agents.service';

/**
 * `InstallAgentTemplate` — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4, subfase 5.7.
 *
 * Instancia un `Agent` a partir de un `AgentTemplate`. Es la única vía por la que una
 * plantilla tiene efecto: hasta aquí es una fila del catálogo, después es un agente con
 * capacidades y herramientas concedidas.
 *
 * El orden de las comprobaciones no es intercambiable:
 *
 * 1. **Autorización del actor** (ADMIN sobre la membresía real). Se comprueba lo primero
 *    para que un usuario sin permisos no pueda usar los mensajes de error de los pasos
 *    siguientes como sonda del catálogo.
 * 2. **Frontera de organización.** Plantilla ajena o de plataforma → 403.
 * 3. **Revalidación de los defaults** contra las invariantes de 5.1. El `Json` de la
 *    plantilla no se copia a ciegas: se vuelve a validar, porque pudo escribirse con otra
 *    versión del catálogo de herramientas o directamente contra la base de datos.
 * 4. **Creación del `Agent` por `AgentsService`**, que aplica sus propias invariantes
 *    (alcance de conocimiento de la propia organización, perfil de LLM utilizable) y
 *    persiste `templateId`.
 *
 * Instalar NO ejecuta el agente ni ninguna herramienta: deja un `Agent` configurado.
 */

export interface InstallAgentTemplateParams {
  organizationId: string;
  /** Quién instala. Debe ser ADMIN de esta organización. */
  actorUserId: string;
  templateId: string;
  /** Sobrescribe el nombre de la plantilla. Por omisión se hereda. */
  name?: string;
  /** Sobrescribe el system prompt por defecto. Por omisión se hereda. */
  systemPrompt?: string;
  llmProfileId?: string;
  temperature?: number;
  /**
   * Alcance de conocimiento del agente instalado. La plantilla NUNCA lo trae: las
   * colecciones son identidades de una organización concreta y no significan nada fuera de
   * ella. Heredarlo sería el error que convertiría el catálogo en una vía de fuga el día
   * que existan plantillas compartidas.
   */
  knowledgeCollectionIds?: string[];
}

@Injectable()
export class InstallAgentTemplateUseCase {
  private readonly logger = new Logger(InstallAgentTemplateUseCase.name);

  constructor(
    private readonly templates: AgentTemplatesService,
    private readonly agents: AgentsService,
  ) {}

  async execute(params: InstallAgentTemplateParams): Promise<AgentWithScope> {
    // 1. Autorización antes que nada: instalar concede capacidades.
    await this.templates.assertCanManageTemplates(
      params.organizationId,
      params.actorUserId,
    );

    // 2. Frontera de organización. `findOne` lanza 403 para plantilla ajena o de plataforma.
    const template = await this.templates.findOne({
      organizationId: params.organizationId,
      templateId: params.templateId,
    });

    // 3. y 4. `AgentsService.create` revalida los defaults con las MISMAS invariantes de
    //    5.1 que aplica a cualquier agente creado a mano, y rechaza la instalación entera
    //    si la plantilla trae una configuración imposible. Nada se persiste a medias.
    const agent = await this.agents.create({
      organizationId: params.organizationId,
      createdById: params.actorUserId,
      templateId: template.id,
      name: params.name ?? template.name,
      area: template.area,
      systemPrompt: params.systemPrompt ?? template.defaultSystemPrompt,
      llmProfileId: params.llmProfileId,
      temperature: params.temperature,
      capabilities: template.defaultCapabilities,
      tools: template.defaultTools,
      knowledgeCollectionIds: params.knowledgeCollectionIds,
    });

    this.logger.log(
      `Plantilla ${template.id} (v${template.version}, ${template.visibility}) instalada ` +
        `como agente ${agent.id} en la organización ${params.organizationId}`,
    );

    return agent;
  }
}
