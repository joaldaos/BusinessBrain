import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NOVEL_SUBJECT_PREFIX,
  subjectIdentityOf,
  validateSubjectProposal,
  type ResolvedSubjectIdentity,
  type SubjectProposal,
  type SubjectReferentType,
} from '../domain/subject-identity';

/**
 * `ResolveSubjectIdentity` — UNDERSTANDING_ENGINE_DESIGN.md §3.4, §13. Fase 7.2.
 *
 * El dominio resuelve lo que la estrategia propone. Ninguna estrategia acuña identidad por su
 * cuenta: aquí es donde una propuesta se convierte —o no— en la identidad de un asunto.
 *
 * ## Por qué se comprueba que el referente EXISTE y es del tenant
 *
 * Sin esta comprobación, una estrategia podría anclar una creencia a un identificador
 * inventado —y quedaría un asunto que no trata de nada— o, peor, al de otra organización:
 * dos tenants compartirían identidad de sujeto y sus creencias se reconciliarían entre sí.
 * La unicidad es por (organización, sujeto), así que no habría colisión visible; la fuga
 * sería silenciosa.
 *
 * ## Ante cualquier duda, sujeto nuevo
 *
 * Toda ruta de fallo —propuesta mal formada, referente inexistente, referente ajeno,
 * abstención de la estrategia— acaba en un sujeto opaco y único. Nunca en una aproximación a
 * un sujeto existente. Es la asimetría de §3.4: un duplicado se recupera con curación humana,
 * una supersesión falsa no.
 */
@Injectable()
export class SubjectIdentityService {
  private readonly logger = new Logger(SubjectIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(params: {
    organizationId: string;
    proposal: SubjectProposal | null | undefined;
  }): Promise<ResolvedSubjectIdentity> {
    const validation = validateSubjectProposal(params.proposal);
    if (!validation.valid) {
      return this.novel(
        validation.reason === 'ABSTAINED' ? 'ABSTAINED' : 'INVALID_PROPOSAL',
      );
    }

    const exists = await this.referentExists(
      params.organizationId,
      validation.referentType,
      validation.referentId,
    );
    if (!exists) {
      // Puede ser un identificador inventado o uno de otra organización. Desde aquí son
      // indistinguibles a propósito, y ambos merecen el mismo trato.
      this.logger.warn(
        `Referente ${validation.referentType}:${validation.referentId} no existe en la ` +
          `organización ${params.organizationId}: se acuña un sujeto nuevo en vez de ` +
          `anclar la creencia a algo que no está ahí`,
      );
      return this.novel('INVALID_PROPOSAL');
    }

    return {
      value: subjectIdentityOf(validation),
      reason: 'DERIVED',
      referent: {
        type: validation.referentType,
        id: validation.referentId,
        aspect: validation.aspect,
      },
    };
  }

  /**
   * Sujeto opaco y único.
   *
   * Único de verdad: dos candidatos que se abstienen en la misma ejecución no pueden acabar
   * compartiendo asunto por accidente, que sería fusionar por la puerta de atrás.
   */
  private novel(
    reason: Extract<
      ResolvedSubjectIdentity['reason'],
      'ABSTAINED' | 'INVALID_PROPOSAL'
    >,
  ): ResolvedSubjectIdentity {
    return { value: `${NOVEL_SUBJECT_PREFIX}:${randomUUID()}`, reason };
  }

  /**
   * ¿Existe este referente en ESTA organización?
   *
   * Consulta por tipo, siempre con el filtro de organización. No hay rama por defecto: un
   * tipo que no esté contemplado aquí no puede colarse porque el catálogo es cerrado y la
   * validación de forma ya corrió.
   */
  private async referentExists(
    organizationId: string,
    referentType: SubjectReferentType,
    referentId: string,
  ): Promise<boolean> {
    const where = { id: referentId, organizationId };

    switch (referentType) {
      case 'knowledge-item':
        return (await this.prisma.knowledgeItem.count({ where })) > 0;
      case 'knowledge-source':
        return (await this.prisma.knowledgeSource.count({ where })) > 0;
      case 'canonical-entity':
        return (
          (await this.prisma.canonicalKnowledgeEntity.count({ where })) > 0
        );
      case 'knowledge-collection':
        return (await this.prisma.knowledgeCollection.count({ where })) > 0;
      case 'business-objective':
        return (await this.prisma.businessObjective.count({ where })) > 0;
    }
  }
}
