import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentArea, Prisma, type Agent } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { pageBounds } from '../../common/dto/pagination.dto';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import {
  InvalidAgentConfigurationError,
  parseAgentConfiguration,
  type AgentConfiguration,
} from '../domain/agent-configuration';

/**
 * Gestión de agentes — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4, Fase 5.
 *
 * Un `Agent` es capacidades, herramientas con permiso individual, memoria, guardrails y
 * alcance de conocimiento. Este servicio cubre su ciclo de vida y garantiza dos cosas que
 * ninguna capa superior puede recuperar si aquí se pierden:
 *
 * 1. **Toda consulta filtra por organización.** Un agente pertenece a una organización y no
 *    existe fuera de ella.
 * 2. **El alcance de conocimiento se valida contra la propia organización.** Vincular una
 *    `KnowledgeCollection` ajena convertiría al agente en una vía de fuga entre tenants.
 *
 * La ejecución del agente NO vive aquí: es `run-agent` (subfase 5.3).
 */

export interface AgentWithScope extends Agent {
  knowledgeCollections: { id: string; name: string }[];
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(params: {
    organizationId: string;
    createdById: string;
    name: string;
    area?: AgentArea;
    systemPrompt: string;
    llmProfileId?: string;
    temperature?: number;
    capabilities?: unknown;
    tools?: unknown;
    memoryConfig?: unknown;
    guardrails?: unknown;
    knowledgeCollectionIds?: string[];
    /** Plantilla de origen, si se instaló desde el catálogo (subfase 5.7). */
    templateId?: string;
  }): Promise<AgentWithScope> {
    const configuration = this.parseConfiguration(params);
    await this.assertCollectionsBelongToOrg(
      params.organizationId,
      params.knowledgeCollectionIds,
    );
    await this.assertLlmProfileIsUsable(
      params.organizationId,
      params.llmProfileId,
    );
    await this.assertTemplateIsUsable(params.organizationId, params.templateId);

    const created = await this.prisma.agent.create({
      data: {
        organizationId: params.organizationId,
        createdById: params.createdById,
        templateId: params.templateId ?? null,
        name: params.name,
        area: params.area ?? AgentArea.GENERAL,
        systemPrompt: params.systemPrompt,
        llmProfileId: params.llmProfileId ?? null,
        temperature: params.temperature ?? null,
        ...this.configurationToColumns(configuration),
        knowledgeCollections: params.knowledgeCollectionIds?.length
          ? { connect: params.knowledgeCollectionIds.map((id) => ({ id })) }
          : undefined,
      },
      include: this.scopeInclude,
    });

    // Crear un agente es CONCEDER capacidades, herramientas y alcance de conocimiento: el
    // cambio de permisos más importante que ocurre en el sistema fuera de las colecciones.
    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.createdById,
      action: AUDIT_ACTIONS.AGENT_CREATED,
      targetType: AUDIT_TARGET_TYPES.AGENT,
      targetId: created.id,
      metadata: {
        name: created.name,
        area: created.area,
        templateId: created.templateId,
        capabilities: configuration.capabilities,
        tools: configuration.tools,
        memoryStrategy: configuration.memoryConfig.strategy,
        knowledgeCollectionIds: created.knowledgeCollections.map((c) => c.id),
      },
    });

    return created;
  }

  /**
   * Agentes de la organización, paginados en SQL (6.4).
   *
   * Antes devolvía todos: correcto mientras un tenant tenga diez, insostenible cuando tenga
   * mil, y el fallo no aparece en desarrollo sino en el cliente más grande.
   */
  async list(params: {
    organizationId: string;
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<AgentWithScope[]> {
    const { take, skip } = pageBounds(params);

    return this.prisma.agent.findMany({
      where: {
        organizationId: params.organizationId,
        ...(params.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { createdAt: 'desc' },
      include: this.scopeInclude,
      take,
      skip,
    });
  }

  async findOne(params: {
    organizationId: string;
    agentId: string;
  }): Promise<AgentWithScope> {
    const agent = await this.prisma.agent.findFirst({
      where: { id: params.agentId, organizationId: params.organizationId },
      include: this.scopeInclude,
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');

    return agent;
  }

  async update(params: {
    organizationId: string;
    agentId: string;
    name?: string;
    area?: AgentArea;
    systemPrompt?: string;
    llmProfileId?: string | null;
    temperature?: number | null;
    capabilities?: unknown;
    tools?: unknown;
    memoryConfig?: unknown;
    guardrails?: unknown;
    knowledgeCollectionIds?: string[];
    isActive?: boolean;
    /** Quién modifica. Necesario para la traza de auditoría (6.2). */
    actorUserId: string;
  }): Promise<AgentWithScope> {
    const current = await this.findOne(params);

    // La configuración se valida ENTERA aunque solo cambie un campo: una actualización
    // parcial que deje al agente en un estado imposible es igual de inválida que crearlo así.
    const configuration = this.parseConfiguration({
      capabilities: params.capabilities ?? current.capabilities,
      tools: params.tools ?? current.tools,
      memoryConfig: params.memoryConfig ?? current.memoryConfig,
      guardrails: params.guardrails ?? current.guardrails,
    });

    await this.assertCollectionsBelongToOrg(
      params.organizationId,
      params.knowledgeCollectionIds,
    );
    if (params.llmProfileId !== undefined && params.llmProfileId !== null) {
      await this.assertLlmProfileIsUsable(
        params.organizationId,
        params.llmProfileId,
      );
    }

    const updated = await this.prisma.agent.update({
      where: { id: params.agentId },
      data: {
        name: params.name,
        area: params.area,
        systemPrompt: params.systemPrompt,
        llmProfileId: params.llmProfileId,
        temperature: params.temperature,
        isActive: params.isActive,
        ...this.configurationToColumns(configuration),
        // `set` reemplaza el alcance completo: enviar una lista es declarar el alcance
        // definitivo, no añadir a lo que ya había.
        knowledgeCollections: params.knowledgeCollectionIds
          ? { set: params.knowledgeCollectionIds.map((id) => ({ id })) }
          : undefined,
      },
      include: this.scopeInclude,
    });

    await this.audit.recordChange({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.AGENT_UPDATED,
      targetType: AUDIT_TARGET_TYPES.AGENT,
      targetId: updated.id,
      before: this.auditableState(current),
      after: this.auditableState(updated),
    });

    return updated;
  }

  /**
   * Estado del agente relevante para la auditoría: lo que concede o acota.
   *
   * Deja fuera marcas de tiempo y campos derivados; registrar `updatedAt` en cada cambio
   * llenaría la traza de diferencias que no explican nada.
   */
  private auditableState(agent: AgentWithScope): Record<string, unknown> {
    return {
      name: agent.name,
      area: agent.area,
      systemPrompt: agent.systemPrompt,
      llmProfileId: agent.llmProfileId,
      temperature: agent.temperature,
      capabilities: agent.capabilities,
      tools: agent.tools,
      memoryConfig: agent.memoryConfig,
      guardrails: agent.guardrails,
      isActive: agent.isActive,
      knowledgeCollectionIds: agent.knowledgeCollections
        .map((collection) => collection.id)
        .sort(),
    };
  }

  /**
   * Baja lógica. Un agente borrado de verdad se llevaría por delante la trazabilidad de las
   * conversaciones y recomendaciones que produjo, que deben seguir siendo explicables.
   */
  async deactivate(params: {
    organizationId: string;
    agentId: string;
    actorUserId: string;
  }): Promise<AgentWithScope> {
    await this.findOne(params);

    const deactivated = await this.prisma.agent.update({
      where: { id: params.agentId },
      data: { isActive: false },
      include: this.scopeInclude,
    });

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorUserId,
      action: AUDIT_ACTIONS.AGENT_DEACTIVATED,
      targetType: AUDIT_TARGET_TYPES.AGENT,
      targetId: deactivated.id,
      metadata: { name: deactivated.name },
    });

    return deactivated;
  }

  private readonly scopeInclude = {
    knowledgeCollections: { select: { id: true, name: true } },
  };

  private parseConfiguration(input: {
    capabilities?: unknown;
    tools?: unknown;
    memoryConfig?: unknown;
    guardrails?: unknown;
  }): AgentConfiguration {
    try {
      return parseAgentConfiguration(input);
    } catch (error) {
      if (error instanceof InvalidAgentConfigurationError) {
        throw new BadRequestException({
          message: error.message,
          problems: error.problems,
        });
      }
      throw error;
    }
  }

  private configurationToColumns(configuration: AgentConfiguration) {
    return {
      capabilities:
        configuration.capabilities as unknown as Prisma.InputJsonValue,
      tools: configuration.tools as unknown as Prisma.InputJsonValue,
      memoryConfig:
        configuration.memoryConfig as unknown as Prisma.InputJsonValue,
      guardrails: configuration.guardrails as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Vincular una colección de otra organización convertiría al agente en una vía de fuga
   * entre tenants: recuperaría conocimiento ajeno con total normalidad, porque el alcance
   * habría quedado legitimado en su propia configuración.
   */
  private async assertCollectionsBelongToOrg(
    organizationId: string,
    collectionIds?: string[],
  ): Promise<void> {
    if (!collectionIds?.length) return;

    const unique = [...new Set(collectionIds)];
    const found = await this.prisma.knowledgeCollection.findMany({
      where: { id: { in: unique }, organizationId },
      select: { id: true },
    });

    if (found.length !== unique.length) {
      const valid = new Set(found.map((collection) => collection.id));
      const invalid = unique.filter((id) => !valid.has(id));
      throw new BadRequestException(
        `Colecciones de conocimiento inexistentes o de otra organización: ${invalid.join(', ')}`,
      );
    }
  }

  /**
   * Un `LlmProfile` sin organización es un perfil de plataforma y puede usarlo cualquiera;
   * uno con organización solo puede usarlo la suya. Lo contrario permitiría gastar —o
   * exponer— la clave BYO de otro cliente.
   */
  private async assertLlmProfileIsUsable(
    organizationId: string,
    llmProfileId?: string,
  ): Promise<void> {
    if (!llmProfileId) return;

    const profile = await this.prisma.llmProfile.findFirst({
      where: {
        id: llmProfileId,
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: { id: true },
    });
    if (!profile) {
      throw new BadRequestException(
        'Perfil de LLM inexistente o de otra organización',
      );
    }
  }

  /**
   * `templateId` apunta a una plantilla del catálogo de la propia organización.
   *
   * `InstallAgentTemplate` ya lo comprueba antes de llegar aquí, y aun así se repite: este
   * servicio es el ÚNICO punto donde nace un `Agent`, y una referencia a una plantilla
   * ajena dejaría un agente cuya procedencia apunta fuera del tenant. La trazabilidad de
   * "de dónde salió este agente" solo vale si no puede cruzar la frontera de organización.
   */
  private async assertTemplateIsUsable(
    organizationId: string,
    templateId?: string,
  ): Promise<void> {
    if (!templateId) return;

    const template = await this.prisma.agentTemplate.findFirst({
      where: { id: templateId, publisherOrgId: organizationId },
      select: { id: true },
    });
    if (!template) {
      throw new BadRequestException(
        'Plantilla inexistente o de otra organización',
      );
    }
  }
}
