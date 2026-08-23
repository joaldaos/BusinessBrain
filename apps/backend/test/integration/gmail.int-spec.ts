import {
  AutomationTriggerType,
  ConnectionStatus,
  IntegrationProvider,
  MembershipRole,
  RunStatus,
} from '@businessbrain/database';
import { BadRequestException } from '@nestjs/common';
import { AutomationsService } from '../../src/automations/application/automations.service';
import { RunAutomationUseCase } from '../../src/automations/application/run-automation.use-case';
import { CronSchedulerAdapter } from '../../src/automations/infrastructure/cron-scheduler.adapter';
import { AutomationSchedulerService } from '../../src/automations/application/automation-scheduler.service';
import { IntegrationsService } from '../../src/integrations/application/integrations.service';
import { GmailConnector } from '../../src/integrations/infrastructure/gmail.connector';
import { IngestFromSourceUseCase } from '../../src/knowledge-engine/application/ingest-from-source.use-case';
import { KnowledgeSourcesService } from '../../src/knowledge-engine/application/knowledge-sources.service';
import { CollectionAccessService } from '../../src/knowledge-engine/application/collection-access.service';
import { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import { collectionsScope } from '../../src/knowledge-engine/domain/knowledge-scope';
import type { ConnectorRegistry } from '../../src/knowledge-engine/infrastructure/connectors/connector-registry.service';
import type { ClassifyContentUseCase } from '../../src/knowledge-engine/application/classify-content.use-case';
import type { ReportsService } from '../../src/reports/application/reports.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FakeGoogleDrive } from '../fake-google-drive';
import { FakeGmail } from '../fake-gmail';
import {
  auditService,
  chunkAndEmbed,
  connectorRegistry,
  createInsight,
  createMember,
  createTestOrg,
  destroyTestOrg,
  encryptionService,
  prisma,
  restrictedPerimeter,
  type TestOrg,
  operationalAlerts,
} from './fixtures';

/**
 * Gmail de principio a fin, con el proveedor sustituido.
 *
 * Es para lo que existe `GmailPort`: el perímetro de colección, la frontera de etiqueta, la
 * separación entre conocimiento y metadata operativa, la idempotencia, el versionado y la
 * revocación son lógica NUESTRA, y verificarla no debe depender de una cuenta de Google ni de
 * que CI tenga red.
 *
 * Un buzón no es una carpeta compartida, y esta suite está escrita alrededor de esa diferencia:
 * quién puede leerlo, qué parte de un correo entra, y qué NO entra nunca.
 */
describe('Gmail (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let gmail: FakeGmail;
  let integrations: IntegrationsService;
  let sources: KnowledgeSourcesService;
  let ingest: IngestFromSourceUseCase;
  let connectors: ConnectorRegistry;
  let access: CollectionAccessService;

  const classify = {
    execute: () =>
      Promise.resolve({ businessArea: null, tags: [], certainty: 0 }),
  } as unknown as ClassifyContentUseCase;

  /** Cuerpo con sustancia: por debajo del umbral, un correo no aporta conocimiento. */
  const CORREO =
    'La política de descuentos comerciales supera el margen objetivo de forma recurrente en ' +
    'el segmento mayorista. Conviene revisar los umbrales por segmento antes del cierre del ' +
    'trimestre y acordar con dirección un límite explícito por operación.';

  beforeEach(async () => {
    org = await createTestOrg('gmail');
    gmail = new FakeGmail();
    const drive = new FakeGoogleDrive();
    integrations = new IntegrationsService(
      db,
      encryptionService(),
      auditService(db),
      // Refresco y revocación son comunes a Google; el doble de Drive los sirve igual.
      drive,
      drive,
      gmail,
    );
    connectors = connectorRegistry({
      gmail: new GmailConnector(gmail, integrations),
    });
    ingest = new IngestFromSourceUseCase(
      db,
      connectors,
      classify,
      encryptionService(),
      auditService(db),
      restrictedPerimeter(db, connectors),
      chunkAndEmbed(db),
      operationalAlerts(db),
    );
    sources = new KnowledgeSourcesService(
      db,
      encryptionService(),
      restrictedPerimeter(db, connectors),
    );
    access = new CollectionAccessService(db, auditService(db));

    gmail.putMessage({ id: 'msg-1', body: CORREO });
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const connect = (code = 'codigo-bueno') =>
    integrations.completeConnection({
      organizationId: org.orgId,
      userId: org.userId,
      provider: IntegrationProvider.GMAIL,
      tokens: {
        accessToken: `acceso-${code}`,
        refreshToken: `refresco-${code}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      },
    });

  /**
   * Colección RESTRINGIDA de verdad: la organización tiene más de un miembro y solo uno tiene
   * acceso. Sin el segundo miembro, "restringido" y "toda la organización" serían el mismo
   * conjunto y la prueba no demostraría nada.
   */
  const createRestrictedCollection = async (name = 'Correo de ventas') => {
    await createMember(org, MembershipRole.MEMBER);
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name },
    });
    await access.grant({
      organizationId: org.orgId,
      knowledgeCollectionId: collection.id,
      userId: org.userId,
      grantedById: org.userId,
    });
    return collection;
  };

  const createGmailSource = async (params: {
    integrationId: string;
    collectionIds: string[];
    labelId?: string;
  }) =>
    sources.create(org.orgId, org.userId, {
      name: 'Correo comercial',
      type: 'GMAIL',
      connectorKey: 'gmail_v1',
      integrationId: params.integrationId,
      config: {
        integrationId: params.integrationId,
        labelId: params.labelId ?? 'Label_ventas',
        labelName: 'Ventas',
      },
      knowledgeCollectionIds: params.collectionIds,
    });

  /** Conexión + colección restringida + fuente, que es el estado de partida habitual. */
  const seedSource = async (labelId?: string) => {
    const integration = await connect();
    const collection = await createRestrictedCollection();
    const source = await createGmailSource({
      integrationId: integration.id,
      collectionIds: [collection.id],
      labelId,
    });
    return { integration, collection, source };
  };

  const sync = (knowledgeSourceId: string) =>
    ingest.execute({
      organizationId: org.orgId,
      knowledgeSourceId,
      connectorInput: {},
    });

  // ───────────────────────────────────────────────────────────────────────────
  // 1-4: el alcance. Un buzón no puede convertirse en conocimiento de empresa.
  // ───────────────────────────────────────────────────────────────────────────

  describe('CRÍTICO: el acceso queda acotado por colección', () => {
    it('1. conectar Gmail NO hace visible el correo a toda la organización', async () => {
      const { collection, source } = await seedSource();
      await sync(source.id);

      // Quien no tiene la colección concedida no ve nada de ese buzón — ni el conocimiento ni
      // la comprensión derivada de él. Es el escenario que motiva toda esta fase.
      const ajeno = await createMember(org, MembershipRole.MEMBER);
      const visibles = await access.accessibleCollectionIds({
        organizationId: org.orgId,
        userId: ajeno,
      });
      expect(visibles).not.toContain(collection.id);

      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      await createInsight(org, {
        subjectIdentity: 'descuentos-mayorista',
        evidenceItemIds: [item.id],
      });

      const paraElAjeno = await new RetrieveInsightsUseCase(db).execute({
        organizationId: org.orgId,
        scope: collectionsScope(visibles),
      });
      expect(paraElAjeno).toHaveLength(0);
    });

    it('2. RECHAZA una fuente de Gmail SIN colección restringida válida', async () => {
      const integration = await connect();
      await createMember(org, MembershipRole.MEMBER);

      // Sin colección: lo que entrara quedaría fuera del control de acceso.
      await expect(
        createGmailSource({
          integrationId: integration.id,
          collectionIds: [],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Abierta a TODA la organización: el perímetro no existe, se llame como se llame.
      const abierta = await prisma.knowledgeCollection.create({
        data: { organizationId: org.orgId, name: 'General' },
      });
      for (const membership of await prisma.membership.findMany({
        where: { organizationId: org.orgId },
      })) {
        await access.grant({
          organizationId: org.orgId,
          knowledgeCollectionId: abierta.id,
          userId: membership.userId,
          grantedById: org.userId,
        });
      }
      await expect(
        createGmailSource({
          integrationId: integration.id,
          collectionIds: [abierta.id],
        }),
      ).rejects.toThrow(/toda la organización/i);

      // Y no quedó ninguna fuente a medio crear.
      expect(
        await prisma.knowledgeSource.count({
          where: { organizationId: org.orgId, connectorKey: 'gmail_v1' },
        }),
      ).toBe(0);
    });

    it('2b. el perímetro se vuelve a exigir AL SINCRONIZAR, no solo al crear', async () => {
      const { collection, source } = await seedSource();
      await sync(source.id);

      // Alguien concede esa colección a todo el mundo DESPUÉS de crear la fuente. Sin esta
      // segunda comprobación, la garantía valdría solo en el instante de la creación.
      for (const membership of await prisma.membership.findMany({
        where: { organizationId: org.orgId },
      })) {
        await access.grant({
          organizationId: org.orgId,
          knowledgeCollectionId: collection.id,
          userId: membership.userId,
          grantedById: org.userId,
        });
      }

      await expect(sync(source.id)).rejects.toThrow(/toda la organización/i);
    });

    it('3. la colección debe ser de la MISMA organización', async () => {
      const integration = await connect();
      const otra = await createTestOrg('gmail-vecina');
      const ajena = await prisma.knowledgeCollection.create({
        data: { organizationId: otra.orgId, name: 'Su correo' },
      });

      await expect(
        createGmailSource({
          integrationId: integration.id,
          collectionIds: [ajena.id],
        }),
      ).rejects.toThrow(/otra organización/i);

      await destroyTestOrg(otra);
    });

    it('4. un mensaje de FUERA de la etiqueta autorizada no se sincroniza', async () => {
      // El filtro de la API de Gmail es una consulta, no un permiso: `gmail.readonly` alcanza
      // al buzón entero. La garantía real del perímetro es la comprobación de este lado.
      gmail.putMessage({
        id: 'msg-privado',
        subject: 'Asunto de dirección',
        body: CORREO.replace('descuentos', 'despidos'),
        labelIds: ['Label_direccion'],
      });

      const { source } = await seedSource();
      const result = await sync(source.id);

      expect(result.stats.itemsCreated).toBe(1);
      const titles = await prisma.knowledgeItem.findMany({
        where: { organizationId: org.orgId },
        select: { title: true },
      });
      expect(titles.map((item) => item.title).join(' ')).not.toContain(
        'dirección',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5-7: idempotencia, versionado e hilo.
  // ───────────────────────────────────────────────────────────────────────────

  describe('sincronizar', () => {
    it('CRITERIO DE CIERRE: los mensajes se indexan como KnowledgeItem visibles', async () => {
      const { collection, source } = await seedSource();

      const result = await sync(source.id);

      expect(result.status).toBe(RunStatus.SUCCESS);
      expect(result.stats.itemsCreated).toBe(1);

      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(item.contentText).toContain('margen objetivo');
      // Citable: se puede ir a comprobarlo en Gmail.
      expect(item.sourceUrl).toContain('msg-1');
      // Y aterrizó en la colección restringida: sin eso, nadie lo vería.
      expect(
        await prisma.knowledgeItemCollection.count({
          where: { knowledgeCollectionId: collection.id },
        }),
      ).toBe(1);
    });

    it('5. CRÍTICO: sincronizar dos veces NO duplica', async () => {
      const { source } = await seedSource();

      const first = await sync(source.id);
      const second = await sync(source.id);

      expect(first.stats.itemsCreated).toBe(1);
      expect(second.stats.itemsCreated).toBe(0);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);

      // Y la segunda vez se le pidió a Gmail solo lo posterior al marcador: sin esto, cada
      // barrido nocturno releería el buzón entero de cada cliente.
      expect(gmail.calls.listMessages[0].historyId).toBeUndefined();
      expect(gmail.calls.listMessages[1].historyId).toBeDefined();
    });

    it('5b. dos respuestas del MISMO hilo son dos ítems, no versiones', async () => {
      // La deduplicación estructural empareja candidatos por igualdad de título. Con el asunto
      // como único título, la segunda respuesta marcaría la primera como superada.
      const { source } = await seedSource();
      gmail.putMessage({
        id: 'msg-2',
        threadId: 'hilo-1',
        subject: 'Re: Descuentos',
        fromName: 'Luis Pérez',
        sentAt: '2026-08-13T10:00:00.000Z',
        body: `${CORREO} Añado el detalle por cliente.`,
      });
      gmail.putMessage({
        id: 'msg-3',
        threadId: 'hilo-1',
        subject: 'Re: Descuentos',
        fromName: 'Ana García',
        sentAt: '2026-08-14T10:00:00.000Z',
        body: `${CORREO} Conforme con el límite propuesto.`,
      });

      const result = await sync(source.id);

      expect(result.stats.itemsCreated).toBe(3);
      expect(result.stats.itemsUpdated).toBe(0);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId, status: 'SUPERSEDED' },
        }),
      ).toBe(0);
    });

    it('6. un mensaje MODIFICADO nace como versión nueva, sin sobrescribir', async () => {
      const { source } = await seedSource();
      await sync(source.id);

      // Mismo mensaje, contenido distinto: se conserva el título (asunto, remitente y fecha
      // no cambian), que es lo que lo hace reconocible como el mismo documento.
      gmail.putMessage({
        id: 'msg-1',
        body: `${CORREO} Revisado en agosto de 2026 por dirección.`,
      });

      const second = await sync(source.id);

      expect(second.stats.itemsUpdated).toBe(1);
      expect(
        await prisma.knowledgeItemLineageEdge.count({
          where: { organizationId: org.orgId, type: 'UPDATES' },
        }),
      ).toBe(1);
      // La versión anterior sigue existiendo: no se sobrescribió nada.
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(2);
    });

    it('6b. un marcador caducado cae a lectura completa sin duplicar', async () => {
      // Gmail no garantiza cuánto conserva un `historyId`: una fuente pausada dos semanas ya
      // basta. Releer es inofensivo —lo absorbe la deduplicación por hash— y quedarse parado
      // sí perdería conocimiento.
      const { source } = await seedSource();
      await sync(source.id);

      gmail.historyExpired = true;
      const second = await sync(source.id);

      expect(second.status).toBe(RunStatus.SUCCESS);
      expect(second.stats.itemsCreated).toBe(0);
      expect(second.stats.itemsSkippedDuplicate).toBe(1);
    });

    it('7. el hilo se conserva como METADATA, sin crear ninguna entidad', async () => {
      const { source } = await seedSource();
      await sync(source.id);

      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(item.sourceMetadata).toMatchObject({
        provider: 'GMAIL',
        messageId: 'msg-1',
        threadId: 'hilo-msg-1',
      });
      // Metadata, no conocimiento: el identificador del hilo no es recuperable.
      expect(item.contentText).not.toContain('hilo-msg-1');
    });

    it('un correo sin sustancia se omite sin tumbar la sincronización', async () => {
      // Un buzón real está lleno de «gracias» y confirmaciones automáticas.
      gmail.putMessage({ id: 'msg-gracias', body: '¡Gracias!' });
      gmail.putMessage({ id: 'msg-vacio', body: '' });

      const { source } = await seedSource();
      const result = await sync(source.id);

      expect(result.status).toBe(RunStatus.SUCCESS);
      expect(result.stats.itemsCreated).toBe(1);
    });

    it('un mensaje que sale de la etiqueta se MARCA, no se elimina', async () => {
      const { source } = await seedSource();
      await sync(source.id);
      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });

      gmail.moveOutOfLabel('msg-1');
      const result = await sync(source.id);

      expect(result.status).toBe(RunStatus.SUCCESS);
      const after = await prisma.knowledgeItem.findFirstOrThrow({
        where: { id: item.id },
      });
      // Una desaparición en el origen es una observación, no una decisión humana de eliminar.
      expect(after.status).toBe('INDEXED');
      expect(after.contentText).toBe(item.contentText);
      expect(after.sourceMissingSince).toBeInstanceOf(Date);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 8-9: qué NO entra nunca en el conocimiento.
  // ───────────────────────────────────────────────────────────────────────────

  describe('CRÍTICO: lo que NO entra en el conocimiento', () => {
    it('8. la dirección del remitente no es contenido indexado ni recuperable', async () => {
      const { collection, source } = await seedSource();
      await sync(source.id);

      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      // Puesta en el texto acabaría en embeddings, en respuestas del chat y en PDFs
      // descargables por cualquiera con la colección concedida.
      expect(item.contentText).not.toContain('ana.garcia@empresa.com');
      expect(item.title).not.toContain('@');
      // El NOMBRE sí, para poder contextualizar de quién es el mensaje.
      expect(item.contentText).toContain('Ana García');
      // Y la dirección queda como metadata operativa: trazable, no recuperable.
      expect(item.sourceMetadata).toMatchObject({
        fromAddress: 'ana.garcia@empresa.com',
      });

      // Tampoco por la vía de recuperación, que es la que alimenta análisis e informes.
      const chunks = await prisma.knowledgeChunk.findMany({
        where: { organizationId: org.orgId },
        select: { content: true },
      });
      expect(chunks.map((chunk) => chunk.content).join('\n')).not.toContain(
        'ana.garcia@empresa.com',
      );
      void collection;
    });

    it('9. los adjuntos NO se descargan ni se indexan en esta V1', async () => {
      // El adaptador solo mira partes `text/*`, así que un PDF ni se descarga ni se lista. Se
      // comprueba por el resultado: del correo entra el cuerpo y nada más.
      const { source } = await seedSource();
      await sync(source.id);

      const items = await prisma.knowledgeItem.findMany({
        where: { organizationId: org.orgId },
      });
      expect(items).toHaveLength(1);
      expect(items[0].mimeType).toBe('text/plain');
      expect(
        items.filter((item) => item.mimeType !== 'text/plain'),
      ).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 10-12: credenciales y revocación.
  // ───────────────────────────────────────────────────────────────────────────

  describe('CRÍTICO: las credenciales de Google no salen nunca', () => {
    it('10. ni los tokens ni el permiso llegan a la interfaz', async () => {
      const integration = await connect();

      const stored = await prisma.integration.findFirstOrThrow({
        where: { id: integration.id },
      });
      // Cifrados de verdad: el valor en claro no está en la base de datos.
      expect(stored.accessTokenEnc).not.toContain('acceso-codigo-bueno');
      expect(stored.refreshTokenEnc).not.toContain('refresco-codigo-bueno');

      // Y lo que la interfaz puede leer no incluye ningún token.
      const listed = await integrations.list(org.orgId);
      expect(JSON.stringify(listed)).not.toMatch(/token/i);
      expect(JSON.stringify(listed)).not.toContain('acceso-');
      expect(JSON.stringify(listed)).not.toContain('refresco-');

      // Ni la traza los recoge.
      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: org.orgId,
          action: 'integration.connected',
          targetId: integration.id,
        },
      });
      expect(JSON.stringify(log.metadata)).not.toMatch(/acceso-|refresco-/);
    });

    it('11. RECHAZA una conexión sin el permiso de Gmail', async () => {
      // La pantalla de Google permite conceder menos de lo pedido. Y un consentimiento de solo
      // Drive tampoco vale: la primera sincronización fallaría contra una API ajena a ese token.
      for (const scope of [
        'openid email',
        'https://www.googleapis.com/auth/drive.readonly',
      ]) {
        await expect(
          integrations.completeConnection({
            organizationId: org.orgId,
            userId: org.userId,
            provider: IntegrationProvider.GMAIL,
            tokens: {
              accessToken: 'a',
              refreshToken: 'r',
              expiresAt: new Date(Date.now() + 3_600_000),
              scope,
            },
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('12. revocar impide nuevas sincronizaciones', async () => {
      const { integration, source } = await seedSource();
      await sync(source.id);

      const result = await integrations.disconnect({
        organizationId: org.orgId,
        actorUserId: org.userId,
        integrationId: integration.id,
      });

      expect(result.stoppedSources).toBe(1);
      const stored = await prisma.integration.findFirstOrThrow({
        where: { id: integration.id },
      });
      expect(stored.status).toBe(ConnectionStatus.DISABLED);
      expect(stored.accessTokenEnc).toBeNull();
      expect(stored.refreshTokenEnc).toBeNull();

      await expect(sync(source.id)).rejects.toThrow(/desactivada/i);

      // Lo que se detiene es traer más, no lo que ya se sabe.
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });

    it('12b. la conexión solo sirve DENTRO de la organización que la creó', async () => {
      const integration = await connect();
      const otra = await createTestOrg('gmail-ajena');

      await expect(
        integrations.accessTokenFor({
          organizationId: otra.orgId,
          integrationId: integration.id,
        }),
      ).rejects.toThrow(/no encontrada/i);
      await expect(
        integrations.listGmailLabels({
          organizationId: otra.orgId,
          integrationId: integration.id,
        }),
      ).rejects.toThrow(/no encontrada/i);

      await destroyTestOrg(otra);
    });

    it('las etiquetas solo se piden a una conexión que SEA de Gmail', async () => {
      // Pasar el identificador de la conexión de Drive gastaría su token contra la API de
      // Gmail y devolvería un error opaco.
      const drive = await integrations.completeConnection({
        organizationId: org.orgId,
        userId: org.userId,
        provider: IntegrationProvider.GOOGLE_DRIVE,
        tokens: {
          accessToken: 'acceso-drive',
          refreshToken: 'refresco-drive',
          expiresAt: new Date(Date.now() + 3_600_000),
          scope: 'https://www.googleapis.com/auth/drive.readonly',
        },
      });

      await expect(
        integrations.listGmailLabels({
          organizationId: org.orgId,
          integrationId: drive.id,
        }),
      ).rejects.toThrow(/no es de Gmail/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 13-15: automatización y el resto del sistema.
  // ───────────────────────────────────────────────────────────────────────────

  describe('automatización', () => {
    const buildAutomation = async (
      knowledgeSourceId: string,
      /** `SCHEDULE` para lo que reclama el reloj; `MANUAL` para lo que dispara una persona. */
      trigger: 'MANUAL' | 'SCHEDULE' = 'MANUAL',
    ) => {
      const automations = new AutomationsService(
        db,
        auditService(db),
        new CronSchedulerAdapter(),
        connectors,
      );
      const runner = new RunAutomationUseCase(
        db,
        auditService(db),
        { execute: () => Promise.resolve({ status: 'SUCCESS' }) } as never,
        { generate: () => Promise.resolve({}) } as unknown as ReportsService,
        ingest,
      );
      const automation = await automations.create({
        organizationId: org.orgId,
        actorUserId: org.userId,
        name: 'Leer el correo comercial',
        triggerType: AutomationTriggerType[trigger],
        triggerConfig:
          trigger === 'SCHEDULE'
            ? { cron: '0 8 * * 1', timezone: 'Europe/Madrid' }
            : {},
        actions: [{ type: 'SYNC_KNOWLEDGE_SOURCE', knowledgeSourceId }],
      });
      return { automation, runner };
    };

    it('13. SYNC_KNOWLEDGE_SOURCE sincroniza Gmail sin nadie delante', async () => {
      const { source } = await seedSource();
      const { automation, runner } = await buildAutomation(source.id);

      const run = await runner.execute(automation);

      expect(run.status).toBe(RunStatus.SUCCESS);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });

    it('13b. el catálogo de acciones sigue CERRADO: Gmail no añade ninguna', async () => {
      // Un correo no puede ejecutar instrucciones externas. La única acción que lo alcanza es
      // la de sincronizar la fuente, y llega por la fuente, no por el contenido del mensaje.
      const { source } = await seedSource();
      const automations = new AutomationsService(
        db,
        auditService(db),
        new CronSchedulerAdapter(),
        connectors,
      );

      await expect(
        automations.create({
          organizationId: org.orgId,
          actorUserId: org.userId,
          name: 'Acción inventada',
          triggerType: AutomationTriggerType.MANUAL,
          triggerConfig: {},
          actions: [
            {
              type: 'SEND_EMAIL',
              knowledgeSourceId: source.id,
            } as never,
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('14. dos instancias que sincronizan a la vez NO ejecutan dos veces', async () => {
      // Es el caso de dos procesos del backend, y por eso se prueba contra el RELOJ y no
      // contra el ejecutor: quien decide es la reclamación condicional en Postgres, no un
      // temporizador en memoria — con uno, cada instancia habría disparado la suya.
      const { source } = await seedSource();
      const { automation, runner } = await buildAutomation(
        source.id,
        'SCHEDULE',
      );
      const clock = new AutomationSchedulerService(
        db,
        runner,
        new CronSchedulerAdapter(),
      );
      await prisma.automation.update({
        where: { id: automation.id },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });

      const [unos, otros] = await Promise.all([
        clock.runDueAutomations(),
        clock.runDueAutomations(),
      ]);

      expect(
        [...unos, ...otros].filter((id) => id === automation.id),
      ).toHaveLength(1);
      expect(
        await prisma.automationRun.count({
          where: { automationId: automation.id },
        }),
      ).toBe(1);
      // Y el mensaje entró UNA vez: la segunda pasada no lo habría duplicado, pero tampoco
      // llegó a ocurrir.
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });

    it('15. el conocimiento de Gmail respeta alcance, frescura y curación', async () => {
      const { collection, source } = await seedSource();
      await sync(source.id);
      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      await createInsight(org, {
        subjectIdentity: 'descuentos-mayorista',
        evidenceItemIds: [item.id],
        // Calculada DESPUÉS de ingerir el correo: una conclusión fechada antes de su propia
        // evidencia es —con razón— no vigente, y aquí lo que se comprueba es lo contrario.
        confidenceComputedAt: new Date(),
      });

      const retrieve = new RetrieveInsightsUseCase(db);

      // Con la colección concedida se ve, y se sirve como vigente.
      const [visto] = await retrieve.execute({
        organizationId: org.orgId,
        scope: collectionsScope([collection.id]),
      });
      expect(visto).toBeDefined();
      expect(visto.freshness).toBe('FRESH');

      // Sin alcance no se ve: la regla fail-closed es la misma para cualquier origen.
      expect(
        await retrieve.execute({
          organizationId: org.orgId,
          scope: collectionsScope([]),
        }),
      ).toHaveLength(0);

      // Y si el mensaje sale de la etiqueta, deja de presentarse como vigente sin retirarse.
      gmail.moveOutOfLabel('msg-1');
      await sync(source.id);

      const [tras] = await retrieve.execute({
        organizationId: org.orgId,
        scope: collectionsScope([collection.id]),
      });
      expect(tras).toBeDefined();
      expect(tras.freshness).toBe('STALE');
      expect(tras.freshnessRationale).toMatch(/fuente sincronizada/i);
    });
  });
});
