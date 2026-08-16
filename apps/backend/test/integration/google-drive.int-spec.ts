import {
  AutomationTriggerType,
  ConnectionStatus,
  IntegrationProvider,
  RunStatus,
} from '@businessbrain/database';
import { BadRequestException } from '@nestjs/common';
import { AutomationsService } from '../../src/automations/application/automations.service';
import { RunAutomationUseCase } from '../../src/automations/application/run-automation.use-case';
import { CronSchedulerAdapter } from '../../src/automations/infrastructure/cron-scheduler.adapter';
import { IntegrationsService } from '../../src/integrations/application/integrations.service';
import { GoogleDriveConnector } from '../../src/integrations/infrastructure/google-drive.connector';
import { IngestFromSourceUseCase } from '../../src/knowledge-engine/application/ingest-from-source.use-case';
import { KnowledgeSourcesService } from '../../src/knowledge-engine/application/knowledge-sources.service';
import { ConnectorRegistry } from '../../src/knowledge-engine/infrastructure/connectors/connector-registry.service';
import { FileUploadConnector } from '../../src/knowledge-engine/infrastructure/connectors/file-upload.connector';
import { WebPageConnector } from '../../src/knowledge-engine/infrastructure/connectors/web-page.connector';
import { BusinessObjectiveService } from '../../src/understanding-engine/application/business-objective.service';
import { TriggerAnalysisRunUseCase } from '../../src/understanding-engine/application/trigger-analysis-run.use-case';
import { PrismaKnowledgeSignalsAdapter } from '../../src/understanding-engine/infrastructure/prisma-knowledge-signals.adapter';
import { KnowledgeSignalStrategy } from '../../src/understanding-engine/infrastructure/strategies/knowledge-signal.strategy';
import type { GenerativeSynthesisStrategy } from '../../src/understanding-engine/infrastructure/strategies/generative-synthesis.strategy';
import type { ClassifyContentUseCase } from '../../src/knowledge-engine/application/classify-content.use-case';
import type { ReportsService } from '../../src/reports/application/reports.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FakeGoogleDrive } from '../fake-google-drive';
import {
  auditService,
  createTestOrg,
  destroyTestOrg,
  encryptionService,
  prisma,
  subjectIdentity,
  type TestOrg,
} from './fixtures';

/**
 * Google Drive de principio a fin, con el proveedor sustituido.
 *
 * Es exactamente para lo que existe `GoogleDrivePort`: la conexión, la selección de carpeta,
 * la sincronización incremental, el versionado y la revocación son lógica NUESTRA, y
 * verificarla no debe depender de una cuenta de Google ni de que CI tenga red.
 */
describe('Google Drive (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let drive: FakeGoogleDrive;
  let integrations: IntegrationsService;
  let sources: KnowledgeSourcesService;
  let ingest: IngestFromSourceUseCase;
  let connectors: ConnectorRegistry;

  const classify = {
    execute: () =>
      Promise.resolve({ businessArea: null, tags: [], certainty: 0 }),
  } as unknown as ClassifyContentUseCase;

  const POLITICA =
    'Los descuentos comerciales aplicados superan de forma recurrente el margen objetivo ' +
    'declarado por la compañía. La dirección revisa cada trimestre los umbrales aplicables ' +
    'por segmento de cliente, atendiendo al volumen contratado y a la antigüedad de la ' +
    'relación comercial mantenida hasta la fecha con cada uno de ellos.';

  beforeEach(async () => {
    org = await createTestOrg('drive');
    drive = new FakeGoogleDrive();
    integrations = new IntegrationsService(
      db,
      encryptionService(),
      auditService(db),
      drive,
    );
    connectors = new ConnectorRegistry(
      new FileUploadConnector(),
      new WebPageConnector(),
      new GoogleDriveConnector(drive, integrations),
    );
    ingest = new IngestFromSourceUseCase(
      db,
      connectors,
      classify,
      encryptionService(),
    );
    sources = new KnowledgeSourcesService(db, encryptionService());

    drive.putFile({
      id: 'doc-1',
      name: 'Política de descuentos',
      text: POLITICA,
      modifiedTime: '2026-08-01T10:00:00.000Z',
    });
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
      provider: IntegrationProvider.GOOGLE_DRIVE,
      tokens: {
        accessToken: `acceso-${code}`,
        refreshToken: `refresco-${code}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        scope: 'https://www.googleapis.com/auth/drive.readonly',
      },
    });

  const createDriveSource = async (integrationId: string) => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Drive' },
    });
    const source = await sources.create(org.orgId, org.userId, {
      name: 'Carpeta de políticas',
      type: 'GOOGLE_DRIVE',
      connectorKey: 'google_drive_v1',
      integrationId,
      config: { integrationId, folderId: 'folder-1' },
      knowledgeCollectionIds: [collection.id],
    });
    return { source, collection };
  };

  const sync = (knowledgeSourceId: string) =>
    ingest.execute({
      organizationId: org.orgId,
      knowledgeSourceId,
      connectorInput: {},
    });

  describe('conectar', () => {
    it('guarda los tokens CIFRADOS y no los expone jamás', async () => {
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
    });

    it('RECHAZA una conexión sin los permisos necesarios', async () => {
      // La pantalla de Google permite conceder menos de lo pedido.
      await expect(
        integrations.completeConnection({
          organizationId: org.orgId,
          userId: org.userId,
          provider: IntegrationProvider.GOOGLE_DRIVE,
          tokens: {
            accessToken: 'a',
            refreshToken: 'r',
            expiresAt: new Date(Date.now() + 3_600_000),
            scope: 'openid email',
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reconectar ACTUALIZA la conexión en vez de duplicarla', async () => {
      await connect();
      await connect('otro-codigo');

      expect(
        await prisma.integration.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });

    it('conservar el permiso duradero cuando Google no lo reenvía', async () => {
      // Google solo entrega el refresco la PRIMERA vez. Sobrescribirlo con nulo dejaría la
      // conexión muerta en cuanto caducara el de acceso.
      const first = await connect();
      await integrations.completeConnection({
        organizationId: org.orgId,
        userId: org.userId,
        provider: IntegrationProvider.GOOGLE_DRIVE,
        tokens: {
          accessToken: 'acceso-nuevo',
          expiresAt: new Date(Date.now() + 3_600_000),
          scope: 'https://www.googleapis.com/auth/drive.readonly',
        },
      });

      const stored = await prisma.integration.findFirstOrThrow({
        where: { id: first.id },
      });
      expect(stored.refreshTokenEnc).not.toBeNull();
    });

    it('deja traza de la conexión', async () => {
      const integration = await connect();

      const log = await prisma.auditLog.findFirstOrThrow({
        where: {
          organizationId: org.orgId,
          action: 'integration.connected',
          targetId: integration.id,
        },
      });
      expect(log.actorId).toBe(org.userId);
      expect(JSON.stringify(log.metadata)).not.toMatch(/acceso-|refresco-/);
    });
  });

  describe('sincronizar', () => {
    it('CRITERIO DE CIERRE: la carpeta se convierte en conocimiento visible', async () => {
      const integration = await connect();
      const { source, collection } = await createDriveSource(integration.id);

      const result = await sync(source.id);

      expect(result.status).toBe(RunStatus.SUCCESS);
      expect(result.stats.itemsCreated).toBe(1);

      const item = await prisma.knowledgeItem.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(item.title).toBe('Política de descuentos');
      expect(item.contentText).toContain('superan de forma recurrente');
      // Citable: se puede ir a comprobarlo en Drive.
      expect(item.sourceUrl).toContain('doc-1');

      // Y aterrizó en la colección: sin eso, nadie lo vería.
      expect(
        await prisma.knowledgeItemCollection.count({
          where: { knowledgeCollectionId: collection.id },
        }),
      ).toBe(1);
    });

    it('CRÍTICO: sincronizar dos veces sin cambios NO duplica', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);

      const first = await sync(source.id);
      const second = await sync(source.id);

      expect(first.stats.itemsCreated).toBe(1);
      expect(second.stats.itemsCreated).toBe(0);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
    });

    it('CRÍTICO: la segunda sincronización es INCREMENTAL de verdad', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);

      await sync(source.id);
      const afterFirst = await prisma.knowledgeSource.findFirstOrThrow({
        where: { id: source.id },
      });
      // El marcador quedó guardado fuera de `configEnc`: no es un secreto.
      expect(afterFirst.syncCursor).toBe('2026-08-01T10:00:00.000Z');

      await sync(source.id);

      // La segunda vez se le pidió a Google solo lo posterior al marcador; sin esto, cada
      // barrido nocturno descargaría el Drive entero de cada cliente.
      expect(drive.calls.listFiles[0].cursor).toBeUndefined();
      expect(drive.calls.listFiles[1].cursor).toBe('2026-08-01T10:00:00.000Z');
    });

    it('un documento MODIFICADO nace como versión nueva, sin sobrescribir', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);
      await sync(source.id);

      // Un retoque, como haría una persona al revisar la política.
      drive.putFile({
        id: 'doc-1',
        name: 'Política de descuentos',
        text: `${POLITICA} Revisado en agosto de 2026.`,
        modifiedTime: '2026-08-15T09:00:00.000Z',
      });

      const second = await sync(source.id);

      expect(second.stats.itemsUpdated).toBe(1);
      // El linaje lo deja escrito: es la misma política, no dos documentos sueltos.
      expect(
        await prisma.knowledgeItemLineageEdge.count({
          where: { organizationId: org.orgId, type: 'UPDATES' },
        }),
      ).toBe(1);
      // Y la versión anterior sigue existiendo: no se sobrescribió nada.
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(2);
    });

    it('un documento nuevo en la carpeta entra en la siguiente sincronización', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);
      await sync(source.id);

      drive.putFile({
        id: 'doc-2',
        name: 'Protocolo de devoluciones',
        text: POLITICA.replace('descuentos', 'devoluciones'),
        modifiedTime: '2026-08-20T09:00:00.000Z',
      });

      const second = await sync(source.id);

      expect(second.stats.itemsCreated).toBe(1);
    });

    it('un fichero ilegible no tumba la sincronización entera', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);

      // Un Drive real tiene vídeos, hojas de cálculo y ficheros corruptos.
      drive.putFile({
        id: 'doc-vacio',
        name: 'Foto del equipo',
        text: '',
        modifiedTime: '2026-08-02T10:00:00.000Z',
      });

      const result = await sync(source.id);

      expect(result.status).toBe(RunStatus.SUCCESS);
      expect(result.stats.itemsCreated).toBe(1);
    });

    it('renueva el token caducado sin que nadie se entere', async () => {
      const integration = await connect();
      await prisma.integration.update({
        where: { id: integration.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const { source } = await createDriveSource(integration.id);

      const result = await sync(source.id);

      expect(result.status).toBe(RunStatus.SUCCESS);
      const stored = await prisma.integration.findFirstOrThrow({
        where: { id: integration.id },
      });
      expect(stored.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('CRÍTICO: revocar detiene las sincronizaciones', () => {
    it('desconectar revoca en Google, borra los tokens y para las fuentes', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);
      await sync(source.id);

      const result = await integrations.disconnect({
        organizationId: org.orgId,
        actorUserId: org.userId,
        integrationId: integration.id,
      });

      expect(result.stoppedSources).toBe(1);
      // Se le dijo a Google, no solo a nuestra base de datos.
      expect(drive.revoked).toHaveLength(1);

      const stored = await prisma.integration.findFirstOrThrow({
        where: { id: integration.id },
      });
      expect(stored.status).toBe(ConnectionStatus.DISABLED);
      expect(stored.accessTokenEnc).toBeNull();
      expect(stored.refreshTokenEnc).toBeNull();

      // Y ya no se puede sincronizar.
      await expect(sync(source.id)).rejects.toThrow(/desactivada/i);
    });

    it('el conocimiento ya ingerido SOBREVIVE a la desconexión', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);
      await sync(source.id);

      await integrations.disconnect({
        organizationId: org.orgId,
        actorUserId: org.userId,
        integrationId: integration.id,
      });

      // Lo que se detiene es traer más, no lo que ya se sabe.
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);
      expect(
        await prisma.knowledgeSource.count({ where: { id: source.id } }),
      ).toBe(1);
    });

    it('si Google revoca por su lado, la conexión pasa a ERROR', async () => {
      const integration = await connect();
      await prisma.integration.update({
        where: { id: integration.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const { source } = await createDriveSource(integration.id);
      drive.refreshShouldFail = true;

      await expect(sync(source.id)).rejects.toThrow(/revocado|rechazó/i);

      const stored = await prisma.integration.findFirstOrThrow({
        where: { id: integration.id },
      });
      expect(stored.status).toBe(ConnectionStatus.ERROR);
    });

    it('otra organización no puede usar la conexión ajena', async () => {
      const integration = await connect();
      const otra = await createTestOrg('drive-ajena');

      await expect(
        integrations.accessTokenFor({
          organizationId: otra.orgId,
          integrationId: integration.id,
        }),
      ).rejects.toThrow(/no encontrada/i);

      await destroyTestOrg(otra);
    });
  });

  describe('SYNC_KNOWLEDGE_SOURCE lo ejecuta sin nadie delante', () => {
    it('una fuente de Drive puede programarse y se sincroniza sola', async () => {
      const integration = await connect();
      const { source } = await createDriveSource(integration.id);

      const automations = new AutomationsService(
        db,
        auditService(db),
        new CronSchedulerAdapter(),
        connectors,
      );
      const runner = new RunAutomationUseCase(
        db,
        auditService(db),
        new TriggerAnalysisRunUseCase(
          db,
          new PrismaKnowledgeSignalsAdapter(db),
          new KnowledgeSignalStrategy(),
          new BusinessObjectiveService(db, auditService(db)),
          {
            key: 'sin-generativa',
            version: '1.0.0',
            kind: 'GENERATIVE' as const,
            baseReliability: 0.6,
            producibleTypes: [],
            generate: () => Promise.resolve([]),
          } as unknown as GenerativeSynthesisStrategy,
          auditService(db),
          subjectIdentity(db),
        ),
        { generate: () => Promise.resolve({}) } as unknown as ReportsService,
        ingest,
      );

      const automation = await automations.create({
        organizationId: org.orgId,
        actorUserId: org.userId,
        name: 'Leer el Drive cada lunes',
        triggerType: AutomationTriggerType.SCHEDULE,
        triggerConfig: { cron: '0 8 * * 1', timezone: 'UTC' },
        actions: [
          { type: 'SYNC_KNOWLEDGE_SOURCE', knowledgeSourceId: source.id },
          { type: 'RUN_ANALYSIS' },
        ],
      });

      const run = await runner.execute(automation);

      expect(run.status).toBe(RunStatus.SUCCESS);
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(1);

      const stored = await prisma.automationRun.findFirstOrThrow({
        where: { automationId: automation.id },
      });
      expect(JSON.stringify(stored.logs)).toMatch(/IngestionJob/);
    });
  });
});
