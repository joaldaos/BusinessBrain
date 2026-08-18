import { AuditService } from '../../src/audit/audit.service';
import type { GoogleDriveConnector } from '../../src/integrations/infrastructure/google-drive.connector';
import type { GmailConnector } from '../../src/integrations/infrastructure/gmail.connector';
import { ConnectorRegistry } from '../../src/knowledge-engine/infrastructure/connectors/connector-registry.service';
import { FileUploadConnector } from '../../src/knowledge-engine/infrastructure/connectors/file-upload.connector';
import { WebPageConnector } from '../../src/knowledge-engine/infrastructure/connectors/web-page.connector';
import { RestrictedPerimeterService } from '../../src/knowledge-engine/application/restricted-perimeter.service';
import { ChunkAndEmbedUseCase } from '../../src/knowledge-engine/application/chunk-and-embed.use-case';
import { EncryptionService } from '../../src/common/utils/encryption.util';
import { SubjectIdentityService } from '../../src/understanding-engine/application/subject-identity.service';
import { InsightScopeService } from '../../src/understanding-engine/application/insight-scope.service';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import {
  AnalysisRunStatus,
  AnalysisRunTrigger,
  ConnectionStatus,
  InsightStatus,
  InsightType,
  KnowledgeSourceType,
  MembershipRole,
  PrismaClient,
} from '@businessbrain/database';

/**
 * Utilidades compartidas por los tests de integración.
 *
 * Estos tests se ejecutan contra Postgres REAL (con pgvector) y verifican garantías que un
 * doble no puede demostrar: índices parciales, restricciones CHECK, aislamiento entre
 * organizaciones y comportamiento bajo concurrencia. Por eso viven separados de los
 * unitarios (`npm run test:int`) y no se ejecutan en `npm test`.
 */

export const prisma = new PrismaClient();

/**
 * `InsightScopeService` real sobre el Postgres de pruebas.
 *
 * Se construye de verdad, no se dobla: desde 6.1 es la proyeccion UNICA del alcance efectivo
 * y la autorizacion del actor al curar y escalar. Doblarlo dejaria sin verificar justamente
 * la garantia que separa una conclusion restringida de que la toque cualquiera.
 */
/**
 * `AuditService` real sobre el Postgres de pruebas.
 *
 * Se construye de verdad: 6.2 existe para que quede traza, y doblarlo dejaria sin verificar
 * justo eso. Los tests que comprueban la traza leen `AuditLog` directamente.
 */
export function auditService(db: unknown): AuditService {
  return new AuditService(db as ConstructorParameters<typeof AuditService>[0]);
}

export function insightScope(db: unknown): InsightScopeService {
  const prismaService = db as ConstructorParameters<
    typeof InsightScopeService
  >[0];
  return new InsightScopeService(
    prismaService,
    new CollectionAccessService(prismaService, auditService(prismaService)),
  );
}

/**
 * `SubjectIdentityService` real sobre el Postgres de pruebas.
 *
 * Se construye de verdad: comprueba contra la base de datos que el referente EXISTE y es del
 * tenant, y doblarlo dejaría sin verificar justamente esa garantía.
 */
export function subjectIdentity(db: unknown): SubjectIdentityService {
  return new SubjectIdentityService(
    db as ConstructorParameters<typeof SubjectIdentityService>[0],
  );
}

/**
 * `EncryptionService` real sobre una clave de pruebas.
 *
 * Se construye de verdad: la config de una fuente se guarda cifrada y el conector la recibe
 * descifrada, así que doblarlo dejaría sin verificar justo ese ida y vuelta.
 */
export function encryptionService(): EncryptionService {
  return new EncryptionService({
    get: () => Buffer.alloc(32, 7).toString('base64'),
  } as unknown as ConstructorParameters<typeof EncryptionService>[0]);
}

/**
 * Conector de Drive para suites que no lo ejercitan.
 *
 * El registro lo exige desde que existe la integración, pero una suite que prueba el reloj o
 * el conector web no debe arrastrar Google: se declara con lo justo para que el registro lo
 * acepte, y quien SÍ lo prueba construye el real con un Drive sustituto.
 */
export function driveConnector(): GoogleDriveConnector {
  return {
    key: 'google_drive_v1',
    acquisition: 'PULL',
  } as unknown as GoogleDriveConnector;
}

/**
 * Conector de Gmail para suites que no lo ejercitan. Mismo criterio que `driveConnector`.
 *
 * Declara `requiresRestrictedCollection` porque no es un detalle: es lo que el perímetro consulta
 * para decidir si exigirlo, y un doble que lo omitiera dejaría esa exigencia sin verificar.
 */
export function gmailConnector(): GmailConnector {
  return {
    key: 'gmail_v1',
    acquisition: 'PULL',
    requiresRestrictedCollection: true,
  } as unknown as GmailConnector;
}

/**
 * Registro de conectores completo.
 *
 * Se construye el REAL —no un doble— porque es el único punto que sabe qué conectores existen, y
 * quien no lo use olvidará añadir el siguiente. Cada suite sustituye solo el conector que
 * ejercita.
 */
export function connectorRegistry(
  overrides: {
    drive?: GoogleDriveConnector;
    gmail?: GmailConnector;
  } = {},
): ConnectorRegistry {
  return new ConnectorRegistry(
    new FileUploadConnector(),
    new WebPageConnector(),
    overrides.drive ?? driveConnector(),
    overrides.gmail ?? gmailConnector(),
  );
}

/**
 * `RestrictedPerimeterService` real sobre el Postgres de pruebas.
 *
 * Se construye de verdad: cuenta concesiones y miembros contra la base de datos, y doblarlo
 * dejaría sin verificar justo la garantía de que un buzón no puede sincronizar hacia una
 * colección abierta a toda la organización.
 */
export function restrictedPerimeter(
  db: unknown,
  registry: ConnectorRegistry,
): RestrictedPerimeterService {
  return new RestrictedPerimeterService(
    db as ConstructorParameters<typeof RestrictedPerimeterService>[0],
    registry,
  );
}

/**
 * `ChunkAndEmbedUseCase` real, con un proveedor de embeddings determinista.
 *
 * Se construye de verdad porque es el paso que convierte un documento guardado en un documento
 * PREGUNTABLE, y estuvo sin invocar desde ninguna parte: doblarlo dejaría sin verificar
 * justamente que la ingesta lo llama y que los fragmentos acaban escritos.
 *
 * El vector se deriva del texto, así que dos textos iguales dan el mismo vector y dos distintos
 * dan vectores distintos. No es semántico —no lo necesita— pero sí determinista, que es lo que
 * permite afirmar algo sobre el resultado.
 */
export function chunkAndEmbed(db: unknown): ChunkAndEmbedUseCase {
  const provider = {
    embed: (texts: string[]) =>
      Promise.resolve(texts.map((text) => deterministicVector(text))),
  };

  return new ChunkAndEmbedUseCase(
    db as ConstructorParameters<typeof ChunkAndEmbedUseCase>[0],
    {
      // El registro es quien resuelve el proveedor de embeddings Y descifra la clave: doblarlo
      // exige respetar ese contrato, o la ingesta creería que no puede vectorizar.
      resolveEmbeddingsForOrganization: () =>
        Promise.resolve({
          provider,
          modelName: 'text-embedding-3-small',
          apiKey: undefined,
        }),
      getEmbeddingProvider: () => provider,
    } as unknown as ConstructorParameters<typeof ChunkAndEmbedUseCase>[1],
  );
}

/** Vector unitario de 1536 dimensiones derivado del texto. La dimensión la fija el esquema. */
function deterministicVector(text: string): number[] {
  let seed = 0;
  for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) % 2147483647;

  const values = Array.from({ length: 1536 }, (_, index) => {
    seed = (seed * 1103515245 + 12345) % 2147483647;
    return (seed / 2147483647) * 2 - 1 + index * 0;
  });
  const norm = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0)) || 1;

  return values.map((v) => v / norm);
}

export interface TestOrg {
  orgId: string;
  /** Usuario principal. Tiene membresía OWNER en la organización. */
  userId: string;
  sourceId: string;
  analysisRunId: string;
  /** Usuarios adicionales creados con `createMember`; se limpian con la organización. */
  extraUserIds: string[];
}

/** Crea una organización aislada. Cada test siembra la suya y la elimina al terminar. */
export async function createTestOrg(prefix: string): Promise<TestOrg> {
  const rnd = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

  const org = await prisma.organization.create({
    data: { name: prefix, slug: `${prefix}-${rnd}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `${prefix}-${rnd}@test.local`,
      passwordHash: 'x',
      name: 'Test',
    },
  });
  // La membresía es real, no implícita: desde la subfase 5.7 la autorización de operaciones
  // privilegiadas (instalar o modificar plantillas) se resuelve leyendo el rol de membresía,
  // no aceptándolo por parámetro.
  await prisma.membership.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role: MembershipRole.OWNER,
    },
  });
  const source = await prisma.knowledgeSource.create({
    data: {
      organizationId: org.id,
      type: KnowledgeSourceType.FILE_UPLOAD,
      name: 'Fuente de prueba',
      connectorKey: 'file_upload_v1',
      createdById: user.id,
      status: ConnectionStatus.CONNECTED,
      configEnc: '',
    },
  });
  const run = await prisma.analysisRun.create({
    data: {
      organizationId: org.id,
      trigger: AnalysisRunTrigger.MANUAL,
      status: AnalysisRunStatus.SUCCESS,
    },
  });

  return {
    orgId: org.id,
    userId: user.id,
    sourceId: source.id,
    analysisRunId: run.id,
    extraUserIds: [],
  };
}

/**
 * Usuario adicional con un rol concreto en la organización.
 *
 * Existe para poder probar contra Postgres real que un rol insuficiente NO puede instalar ni
 * modificar plantillas: con un rol pasado por parámetro esa prueba no demostraría nada.
 */
export async function createMember(
  org: TestOrg,
  role: MembershipRole,
): Promise<string> {
  const rnd = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

  const user = await prisma.user.create({
    data: {
      email: `member-${rnd}@test.local`,
      passwordHash: 'x',
      name: `Test ${role}`,
    },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: org.orgId, role },
  });
  org.extraUserIds.push(user.id);

  return user.id;
}

/** El borrado en cascada de Organization arrastra todo lo demás. */
export async function destroyTestOrg(org: TestOrg): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: org.orgId } });
  await prisma.user.deleteMany({
    where: { id: { in: [org.userId, ...org.extraUserIds] } },
  });
}

export async function createKnowledgeItem(
  org: TestOrg,
  overrides: {
    title?: string;
    confidenceScore?: number;
    confidenceComputedAt?: Date;
    businessArea?:
      | 'HR'
      | 'MARKETING'
      | 'SALES'
      | 'FINANCE'
      | 'OPERATIONS'
      | 'SUPPORT'
      | 'GENERAL';
    status?: 'INDEXED' | 'SUPERSEDED' | 'DELETED';
  } = {},
) {
  return prisma.knowledgeItem.create({
    data: {
      organizationId: org.orgId,
      originKnowledgeSourceId: org.sourceId,
      currentKnowledgeSourceId: org.sourceId,
      title: overrides.title ?? 'Documento de prueba',
      contentText: 'contenido de prueba '.repeat(30),
      contentHash: `hash-${Math.random()}`,
      status: overrides.status ?? 'INDEXED',
      indexedAt: new Date(),
      businessArea: overrides.businessArea ?? 'GENERAL',
      confidenceScore: overrides.confidenceScore ?? 0.8,
      confidenceComputedAt:
        overrides.confidenceComputedAt ?? new Date('2026-01-01'),
    },
  });
}

export async function createInsight(
  org: TestOrg,
  params: {
    subjectIdentity: string;
    type?: InsightType;
    status?: InsightStatus;
    confidence?: number;
    confidenceComputedAt?: Date;
    evidenceItemIds?: string[];
    /** Versión a la que reemplaza. Fase 7: encadena versiones de una misma creencia. */
    supersedesInsightId?: string;
    evidenceRole?: 'BASELINE' | 'CORROBORATION' | 'CONTRADICTION';
    createdAt?: Date;
  },
) {
  const evidenceIds = params.evidenceItemIds ?? [];

  const insight = await prisma.insight.create({
    data: {
      organizationId: org.orgId,
      analysisRunId: org.analysisRunId,
      subjectIdentity: params.subjectIdentity,
      supersedesInsightId: params.supersedesInsightId ?? null,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
      type: params.type ?? InsightType.ANOMALY,
      summary: `Hallazgo sobre ${params.subjectIdentity}`,
      status: params.status ?? InsightStatus.ACTIVE,
      strategyKey: 'test-strategy',
      strategyVersion: '1.0.0',
      reasoningTrace: { rule: 'test' },
      confidence: params.confidence ?? 0.9,
      confidenceComputedAt:
        params.confidenceComputedAt ?? new Date('2026-06-01'),
      transitiveEvidenceClosure: evidenceIds.map((refId) => ({
        kind: 'KNOWLEDGE_ITEM',
        refId,
      })),
    },
  });

  for (const refId of evidenceIds) {
    await prisma.insightEvidence.create({
      data: {
        insightId: insight.id,
        kind: 'KNOWLEDGE_ITEM',
        role: params.evidenceRole ?? 'BASELINE',
        knowledgeItemId: refId,
      },
    });
  }

  return insight;
}
