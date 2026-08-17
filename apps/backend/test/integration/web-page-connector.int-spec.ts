import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AutomationTriggerType, RunStatus } from '@businessbrain/database';
import { BadRequestException } from '@nestjs/common';
import { AutomationsService } from '../../src/automations/application/automations.service';
import { CronSchedulerAdapter } from '../../src/automations/infrastructure/cron-scheduler.adapter';
import { IngestFromSourceUseCase } from '../../src/knowledge-engine/application/ingest-from-source.use-case';
import { KnowledgeSourcesService } from '../../src/knowledge-engine/application/knowledge-sources.service';
import type { ClassifyContentUseCase } from '../../src/knowledge-engine/application/classify-content.use-case';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  chunkAndEmbed,
  connectorRegistry,
  restrictedPerimeter,
  createTestOrg,
  destroyTestOrg,
  encryptionService,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Primera integración externa: una dirección web.
 *
 * Se verifica contra un servidor HTTP de verdad levantado en el propio test — no un doble de
 * `fetch`—, porque lo que hay que demostrar es el comportamiento REAL de red: redirecciones,
 * tipos de contenido, tamaños y, sobre todo, que el servidor no vaya donde no debe.
 */
describe('Conector de página web (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let server: Server;
  let baseUrl = '';

  /** Qué responde el servidor de pruebas. Se reconfigura por test. */
  let handler: (path: string) => {
    status?: number;
    headers?: Record<string, string>;
    body?: string;
  };

  const connectors = connectorRegistry();
  const classify = {
    execute: () =>
      Promise.resolve({ businessArea: null, tags: [], certainty: 0 }),
  } as unknown as ClassifyContentUseCase;

  const ingest = new IngestFromSourceUseCase(
    db,
    connectors,
    classify,
    encryptionService(),
    auditService(db),
    restrictedPerimeter(db, connectors),
    chunkAndEmbed(db),
  );
  const sources = new KnowledgeSourcesService(
    db,
    encryptionService(),
    restrictedPerimeter(db, connectors),
  );

  /**
   * Página de prueba, deliberadamente larga.
   *
   * La deduplicación de nivel 2 compara similitud estructural: sobre un texto corto, añadir
   * una frase lo cambia entero y el sistema lo trataría —con razón— como otro documento. Una
   * página real tiene cuerpo, y es sobre ese caso donde hay que demostrar que un retoque
   * produce una VERSIÓN y no un duplicado.
   */
  const PAGE = (extra = '') => `
    <html>
      <head><title>Política de descuentos</title></head>
      <body>
        <nav>Inicio · Precios</nav>
        <p>Los descuentos comerciales aplicados superan de forma recurrente el margen
        objetivo declarado por la compañía para el ejercicio en curso. La dirección
        comercial revisa trimestralmente los umbrales aplicables a cada segmento de
        clientes, atendiendo al volumen contratado y a la antigüedad de la relación.
        Los descuentos superiores al quince por ciento requieren autorización expresa
        del responsable de área, que debe quedar registrada por escrito antes de
        trasladar la oferta al cliente. Las excepciones aprobadas se revisan al cierre
        de cada trimestre junto con su impacto real sobre el margen obtenido.
        ${extra}</p>
        <script>console.log('no soy contenido')</script>
      </body>
    </html>`;

  beforeAll(async () => {
    handler = () => ({ body: PAGE() });
    server = createServer((req, res) => {
      const result = handler(req.url ?? '/');
      res.writeHead(result.status ?? 200, {
        'content-type': 'text/html; charset=utf-8',
        ...result.headers,
      });
      res.end(result.body ?? '');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    org = await createTestOrg('web-connector');
    handler = () => ({ body: PAGE() });
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  /**
   * Crea la fuente web.
   *
   * El servidor de pruebas vive en `127.0.0.1`, que el guard anti-SSRF rechaza con razón. Se
   * usa el conector directamente contra una config explícita para los casos de red, y aquí se
   * salta la resolución de destino sustituyéndola — sigue ejecutándose TODO lo demás:
   * redirecciones a mano, tipos de contenido, cotas y extracción.
   */
  const createWebSource = async (url: string) => {
    const collection = await prisma.knowledgeCollection.create({
      data: { organizationId: org.orgId, name: 'Web' },
    });
    const source = await sources.create(org.orgId, org.userId, {
      name: 'Página de política',
      type: 'WEBSITE',
      connectorKey: 'web_page_v1',
      config: { url },
      knowledgeCollectionIds: [collection.id],
    });
    return { source, collection };
  };

  /**
   * Permite alcanzar el servidor local SOLO en las pruebas que verifican el comportamiento de
   * red, nunca las que verifican el guard. Se restaura al terminar cada test.
   */
  const allowLoopback = () => {
    const connector = connectors.get('web_page_v1') as unknown as {
      assertPublicDestination: (url: string) => Promise<void>;
    };
    const original = connector.assertPublicDestination;
    connector.assertPublicDestination = () => Promise.resolve();
    return () => {
      connector.assertPublicDestination = original;
    };
  };

  describe('CRÍTICO: el servidor no va donde no debe', () => {
    it('RECHAZA la red interna, con el guard REAL puesto', async () => {
      // Sin sustituir nada: es exactamente lo que ocurriría en producción.
      const { source } = await createWebSource(`${baseUrl}/`);

      await expect(
        ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        }),
      ).rejects.toThrow(/red interna/i);

      // No entró nada, y la negativa queda registrada: el operador puede ver por qué.
      expect(
        await prisma.knowledgeItem.count({
          where: { organizationId: org.orgId },
        }),
      ).toBe(0);
      const job = await prisma.ingestionJob.findFirstOrThrow({
        where: { organizationId: org.orgId },
      });
      expect(job.status).toBe(RunStatus.FAILED);
      const after = await prisma.knowledgeSource.findFirstOrThrow({
        where: { id: source.id },
      });
      expect(after.status).toBe('ERROR');
      expect(after.lastError).toMatch(/red interna/i);
    });

    it('RECHAZA el servicio de metadatos de las nubes', async () => {
      const { source } = await createWebSource(
        'http://169.254.169.254/latest/meta-data/',
      );

      // Entregaría credenciales de la máquina, indexadas como un documento más.
      await expect(
        ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        }),
      ).rejects.toThrow(/red interna/i);
    });

    it('RECHAZA una redirección hacia la red interna', async () => {
      const restore = allowLoopback();
      try {
        handler = () => ({
          status: 302,
          headers: { location: 'http://127.0.0.1:22/' },
        });
        const { source } = await createWebSource(`${baseUrl}/`);

        // El salto se comprueba solo: con `redirect: 'follow'` la segunda petición no habría
        // pasado por ningún control.
        await expect(
          connectors
            .get('web_page_v1')
            .extract({ config: { url: `${baseUrl}/` } }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(source.id).toBeTruthy();
      } finally {
        restore();
      }
    });

    it('RECHAZA un esquema que leería del propio servidor', async () => {
      const { source } = await createWebSource('file:///etc/passwd');

      await expect(
        ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        }),
      ).rejects.toThrow(/http y https/i);
    });
  });

  describe('trae contenido real y lo mete en la tubería que ya existe', () => {
    it('CRITERIO DE CIERRE: una URL se convierte en conocimiento indexado y visible', async () => {
      const restore = allowLoopback();
      try {
        const { source, collection } = await createWebSource(
          `${baseUrl}/politica`,
        );

        const result = await ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        });

        expect(result.status).toBe(RunStatus.SUCCESS);
        expect(result.stats.itemsCreated).toBe(1);

        const item = await prisma.knowledgeItem.findFirstOrThrow({
          where: { organizationId: org.orgId },
        });
        // Título de la página, no la URL.
        expect(item.title).toBe('Política de descuentos');
        expect(item.contentText).toContain('superan de forma recurrente');
        // Lo que nunca es contenido no entró.
        expect(item.contentText).not.toContain('no soy contenido');
        expect(item.contentText).not.toContain('Precios');
        // Trazable a su origen.
        expect(item.sourceUrl).toBe(`${baseUrl}/politica`);

        // Y aterrizó en la colección: sin eso, nadie lo vería.
        expect(
          await prisma.knowledgeItemCollection.count({
            where: { knowledgeCollectionId: collection.id },
          }),
        ).toBe(1);
      } finally {
        restore();
      }
    });

    it('CRÍTICO: sincronizar dos veces NO duplica', async () => {
      const restore = allowLoopback();
      try {
        const { source } = await createWebSource(`${baseUrl}/politica`);

        const first = await ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        });
        const second = await ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        });

        expect(first.stats.itemsCreated).toBe(1);
        // La idempotencia no la pone el conector: la garantiza la deduplicación de nivel 1.
        expect(second.stats.itemsCreated).toBe(0);
        expect(second.stats.itemsSkippedDuplicate).toBe(1);
        expect(
          await prisma.knowledgeItem.count({
            where: { organizationId: org.orgId },
          }),
        ).toBe(1);
      } finally {
        restore();
      }
    });

    it('si la página CAMBIA, nace una versión nueva en vez de un duplicado', async () => {
      const restore = allowLoopback();
      try {
        const { source } = await createWebSource(`${baseUrl}/politica`);
        await ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        });

        // Un retoque, no una reescritura: es lo que hace una página real al actualizarse.
        handler = () => ({ body: PAGE('Revisado en agosto.') });
        const second = await ingest.execute({
          organizationId: org.orgId,
          knowledgeSourceId: source.id,
          connectorInput: {},
        });

        expect(second.stats.itemsUpdated).toBe(1);
        // El linaje lo deja escrito: no son dos documentos sueltos.
        expect(
          await prisma.knowledgeItemLineageEdge.count({
            where: { organizationId: org.orgId, type: 'UPDATES' },
          }),
        ).toBe(1);
      } finally {
        restore();
      }
    });

    it('sigue una redirección pública y cita la dirección FINAL', async () => {
      const restore = allowLoopback();
      try {
        handler = (path) =>
          path === '/vieja'
            ? { status: 301, headers: { location: '/nueva' } }
            : { body: PAGE() };

        const [content] = await connectors
          .get('web_page_v1')
          .extract({ config: { url: `${baseUrl}/vieja` } });

        expect(content.sourceUrl).toBe(`${baseUrl}/nueva`);
      } finally {
        restore();
      }
    });

    describe('lo que no puede convertirse en conocimiento se rechaza con motivo', () => {
      it('un tipo de contenido no textual', async () => {
        const restore = allowLoopback();
        try {
          handler = () => ({
            headers: { 'content-type': 'image/png' },
            body: 'binario',
          });

          await expect(
            connectors
              .get('web_page_v1')
              .extract({ config: { url: `${baseUrl}/x` } }),
          ).rejects.toThrow(/no devuelve texto/i);
        } finally {
          restore();
        }
      });

      it('una página sin texto suficiente', async () => {
        const restore = allowLoopback();
        try {
          handler = () => ({ body: '<html><body><div></div></body></html>' });

          await expect(
            connectors
              .get('web_page_v1')
              .extract({ config: { url: `${baseUrl}/x` } }),
          ).rejects.toThrow(/texto suficiente/i);
        } finally {
          restore();
        }
      });

      it('un error del servidor remoto', async () => {
        const restore = allowLoopback();
        try {
          handler = () => ({ status: 404, body: 'no está' });

          await expect(
            connectors
              .get('web_page_v1')
              .extract({ config: { url: `${baseUrl}/x` } }),
          ).rejects.toThrow(/respondió 404/i);
        } finally {
          restore();
        }
      });

      it('una fuente sin dirección configurada', async () => {
        await expect(
          connectors.get('web_page_v1').extract({ config: {} }),
        ).rejects.toThrow(/ninguna dirección web/i);
      });
    });
  });

  describe('sincronización programada', () => {
    it('una fuente web SÍ puede programarse', async () => {
      const { source } = await createWebSource(`${baseUrl}/politica`);
      const automations = new AutomationsService(
        db,
        auditService(db),
        new CronSchedulerAdapter(),
        connectors,
      );

      const automation = await automations.create({
        organizationId: org.orgId,
        actorUserId: org.userId,
        name: 'Revisar la página cada semana',
        triggerType: AutomationTriggerType.SCHEDULE,
        triggerConfig: { cron: '0 8 * * 1', timezone: 'UTC' },
        actions: [
          { type: 'SYNC_KNOWLEDGE_SOURCE', knowledgeSourceId: source.id },
          { type: 'RUN_ANALYSIS' },
        ],
      });

      expect(automation.nextRunAt).toBeInstanceOf(Date);
    });

    it('una fuente de SUBIDA MANUAL no puede programarse', async () => {
      // Dejaría una automatización fallando cada semana de madrugada, esperando un archivo
      // que nadie va a subir. Se rechaza al crearla, no al dispararla.
      const manual = await sources.create(org.orgId, org.userId, {
        name: 'Subidas a mano',
        type: 'FILE_UPLOAD',
        connectorKey: 'file_upload_v1',
      });
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
          name: 'Imposible',
          triggerType: AutomationTriggerType.SCHEDULE,
          triggerConfig: { cron: '0 8 * * 1', timezone: 'UTC' },
          actions: [
            { type: 'SYNC_KNOWLEDGE_SOURCE', knowledgeSourceId: manual.id },
          ],
        }),
      ).rejects.toThrow(/no puede sincronizarse sola/i);
    });

    it('RECHAZA sincronizar la fuente de OTRA organización', async () => {
      const otra = await createTestOrg('web-connector-ajena');
      const suya = await sources.create(otra.orgId, otra.userId, {
        name: 'La de la vecina',
        type: 'WEBSITE',
        connectorKey: 'web_page_v1',
        config: { url: 'https://ejemplo.com' },
      });
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
          name: 'Fuga',
          triggerType: AutomationTriggerType.MANUAL,
          triggerConfig: {},
          actions: [
            { type: 'SYNC_KNOWLEDGE_SOURCE', knowledgeSourceId: suya.id },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await destroyTestOrg(otra);
    });
  });
});
