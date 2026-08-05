import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentArea,
  AgentTemplateVisibility,
  MembershipRole,
  Prisma,
  type AgentTemplate,
} from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { InvalidAgentConfigurationError } from '../domain/agent-configuration';
import {
  evaluateTemplateUsage,
  templateDefaultsToConfiguration,
} from '../domain/agent-template';

/**
 * Catálogo de `AgentTemplate` — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4, subfase 5.7.
 *
 * Una plantilla es una configuración de agente reutilizable: system prompt, capacidades y
 * herramientas con su permiso. Instalarla no documenta nada, **crea un `Agent` con esas
 * capacidades ya concedidas**, así que el catálogo se trata como superficie de
 * autorización, no como contenido.
 *
 * Tres garantías que ninguna capa superior puede recuperar si aquí se pierden:
 *
 * 1. **Toda consulta filtra por `publisherOrgId`.** El catálogo de una organización es el
 *    suyo y solo el suyo. No hay marketplace en la Fase 5 (§1121).
 * 2. **Los defaults se validan al guardarlos.** Una plantilla no puede quedar persistida con
 *    una herramienta inexistente esperando a romper en la instalación.
 * 3. **Modificar el catálogo exige ADMIN, comprobado contra la membresía real.** El
 *    `OrgRoleGuard` protege el transporte HTTP; esto protege la operación. Conceder
 *    capacidades es una operación privilegiada la llame quien la llame.
 */

/** Rol mínimo para tocar el catálogo o instalar de él: instalar concede capacidades. */
const MIN_TEMPLATE_MANAGEMENT_ROLE = MembershipRole.ADMIN;

const ROLE_RANK: Record<MembershipRole, number> = {
  [MembershipRole.VIEWER]: 0,
  [MembershipRole.MEMBER]: 1,
  [MembershipRole.ADMIN]: 2,
  [MembershipRole.OWNER]: 3,
};

export interface CreateAgentTemplateParams {
  organizationId: string;
  actorUserId: string;
  name: string;
  description: string;
  area?: AgentArea;
  visibility?: AgentTemplateVisibility;
  defaultSystemPrompt: string;
  defaultCapabilities?: unknown;
  defaultTools?: unknown;
}

export interface UpdateAgentTemplateParams {
  organizationId: string;
  actorUserId: string;
  templateId: string;
  name?: string;
  description?: string;
  area?: AgentArea;
  visibility?: AgentTemplateVisibility;
  defaultSystemPrompt?: string;
  defaultCapabilities?: unknown;
  defaultTools?: unknown;
}

@Injectable()
export class AgentTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: CreateAgentTemplateParams): Promise<AgentTemplate> {
    await this.assertCanManageTemplates(
      params.organizationId,
      params.actorUserId,
    );

    // Se valida ANTES de persistir: una plantilla inválida guardada es una instalación rota
    // en diferido, y el fallo aparecería lejos de quien lo causó.
    const configuration = this.parseDefaults({
      defaultCapabilities: params.defaultCapabilities ?? [],
      defaultTools: params.defaultTools ?? [],
    });

    return this.prisma.agentTemplate.create({
      data: {
        // La plantilla nace SIEMPRE atribuida a la organización activa. `publisherOrgId`
        // nulo es una plantilla de plataforma y no se crea por esta vía: sería publicar.
        publisherOrgId: params.organizationId,
        name: params.name,
        description: params.description,
        area: params.area ?? AgentArea.GENERAL,
        visibility: params.visibility ?? AgentTemplateVisibility.PRIVATE,
        defaultSystemPrompt: params.defaultSystemPrompt,
        defaultCapabilities: configuration.capabilities,
        defaultTools: configuration.tools as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Catálogo visible para una organización.
   *
   * Filtra por `publisherOrgId` en la CONSULTA, no después: un filtro aplicado en memoria
   * sobre un `findMany` sin acotar depende de que nadie añada un `select` o una paginación
   * más adelante, y ese es exactamente el descuido que expone el catálogo ajeno.
   */
  async list(params: {
    organizationId: string;
    area?: AgentArea;
    visibility?: AgentTemplateVisibility;
  }): Promise<AgentTemplate[]> {
    return this.prisma.agentTemplate.findMany({
      where: {
        publisherOrgId: params.organizationId,
        ...(params.area ? { area: params.area } : {}),
        ...(params.visibility ? { visibility: params.visibility } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Una plantilla del catálogo propio.
   *
   * La que pertenece a otra organización responde **403**, no 404: la subfase 5.7 exige esa
   * respuesta explícita. Es una fuga de existencia consciente y acotada — confirma que un id
   * corresponde a alguna plantilla, nunca su contenido, su publicador ni su configuración.
   */
  async findOne(params: {
    organizationId: string;
    templateId: string;
  }): Promise<AgentTemplate> {
    const template = await this.prisma.agentTemplate.findUnique({
      where: { id: params.templateId },
    });
    if (!template) throw new NotFoundException('Plantilla no encontrada');

    const decision = evaluateTemplateUsage({
      publisherOrgId: template.publisherOrgId,
      visibility: template.visibility,
      requestingOrganizationId: params.organizationId,
    });
    if (!decision.allowed) {
      throw new ForbiddenException(decision.explanation);
    }

    return template;
  }

  async update(params: UpdateAgentTemplateParams): Promise<AgentTemplate> {
    await this.assertCanManageTemplates(
      params.organizationId,
      params.actorUserId,
    );
    const current = await this.findOne(params);

    // Igual que en `AgentsService.update`: la configuración se revalida ENTERA aunque solo
    // cambie un campo. Una actualización parcial que deje defaults imposibles es igual de
    // inválida que crearlos así.
    const configuration = this.parseDefaults({
      defaultCapabilities:
        params.defaultCapabilities ?? current.defaultCapabilities,
      defaultTools: params.defaultTools ?? current.defaultTools,
    });

    return this.prisma.agentTemplate.update({
      where: { id: current.id },
      data: {
        name: params.name,
        description: params.description,
        area: params.area,
        visibility: params.visibility,
        defaultSystemPrompt: params.defaultSystemPrompt,
        defaultCapabilities: configuration.capabilities,
        defaultTools: configuration.tools as unknown as Prisma.InputJsonValue,
        // Cambiar los defaults produce una plantilla distinta de la que se instaló ayer.
        // Sin esta versión, un `Agent` con `templateId` no sería explicable: apuntaría a
        // una configuración que ya no es la que recibió.
        version: { increment: 1 },
      },
    });
  }

  /**
   * Retirada del catálogo.
   *
   * `Agent.templateId` es `onDelete: SetNull`, así que los agentes ya instalados sobreviven
   * — pierden la referencia, no la configuración. Se acepta porque la alternativa (impedir
   * retirar una plantilla usada) dejaría el catálogo creciendo para siempre.
   */
  async remove(params: {
    organizationId: string;
    actorUserId: string;
    templateId: string;
  }): Promise<{ id: string }> {
    await this.assertCanManageTemplates(
      params.organizationId,
      params.actorUserId,
    );
    const template = await this.findOne(params);

    await this.prisma.agentTemplate.delete({ where: { id: template.id } });

    return { id: template.id };
  }

  /**
   * Rol efectivo del actor en la organización activa, leído de la MEMBRESÍA REAL.
   *
   * No se acepta un rol pasado por parámetro: sería confiar en que quien llama ya comprobó
   * lo que aquí se está comprobando. Además ata la autorización al mismo aislamiento
   * multi-tenant que todo lo demás — sin membresía en esta organización no hay permiso,
   * aunque el usuario sea ADMIN en otra.
   */
  async assertCanManageTemplates(
    organizationId: string,
    actorUserId: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: actorUserId, organizationId },
      },
      select: { role: true },
    });

    if (!membership) {
      throw new ForbiddenException('No perteneces a esta organización');
    }

    if (ROLE_RANK[membership.role] < ROLE_RANK[MIN_TEMPLATE_MANAGEMENT_ROLE]) {
      throw new ForbiddenException(
        `Instalar o modificar plantillas exige rol ${MIN_TEMPLATE_MANAGEMENT_ROLE} ` +
          `(tienes ${membership.role}): una plantilla concede capacidades y herramientas`,
      );
    }
  }

  private parseDefaults(template: {
    defaultCapabilities: unknown;
    defaultTools: unknown;
  }) {
    try {
      return templateDefaultsToConfiguration(template);
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
}
