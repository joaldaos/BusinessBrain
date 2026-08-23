import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@businessbrain/database';

/**
 * El ensayo de recuperación: copia → pérdida → restauración → comprobación.
 *
 * ## Por qué esto es un test y no un documento
 *
 * "Tenemos copias de seguridad" y "sabemos que restauran" son afirmaciones distintas, y la
 * primera no implica la segunda. Una copia que nunca se ha restaurado no es una copia: es un
 * fichero del que nadie sabe nada. Los desastres de datos casi nunca son por no tener copia —
 * son por descubrir el día malo que la copia estaba incompleta, o que nadie sabía el
 * procedimiento, o que el procedimiento no funcionaba en esa máquina.
 *
 * Así que se ensaya de verdad: se crea una empresa con contenido real, se hace la copia, se
 * BORRA la empresa, se restaura en una base aparte y se comprueba que todo está.
 *
 * ## Por qué se restaura al lado y no encima
 *
 * Restaurar sobre la base que está en uso convierte un susto en un desastre: si la copia está
 * incompleta, ya no hay a qué volver. Se restaura en otra base, se comprueba, y solo entonces
 * alguien decide. Es también lo que permite que este ensayo se pueda ejecutar cualquier día
 * sin arriesgar nada.
 *
 * ## Cómo ejecutarlo
 *
 *   npm run test:ops --workspace @businessbrain/backend
 *
 * Necesita Postgres en marcha (`docker compose up -d`) y `DATABASE_URL` en el entorno.
 */

const ejecutar = promisify(execFile);

const RAIZ = resolve(__dirname, '..', '..', '..', '..');
const BASE_RESTAURADA = 'businessbrain_ensayo_restauracion';

const prisma = new PrismaClient();

describe('Copia de seguridad y restauración', () => {
  let carpeta: string;
  let copia: string;
  let restaurada: PrismaClient;

  /** Lo que tiene que sobrevivir, y que se comprueba una por una al final. */
  const marcas = {
    empresa: `Ensayo ${Date.now()}`,
    documento: `Contrato de ensayo ${Date.now()}`,
    coleccion: `Colección de ensayo ${Date.now()}`,
    conclusion: `Conclusión de ensayo ${Date.now()}`,
    recomendacion: `Recomendación de ensayo ${Date.now()}`,
  };

  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    carpeta = await mkdtemp(join(tmpdir(), 'bb-ensayo-'));
    copia = join(carpeta, 'copia.dump');
  }, 60_000);

  afterAll(async () => {
    await restaurada?.$disconnect();
    // La empresa se borró durante el ensayo; queda el usuario, que no pertenece a la empresa.
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(carpeta, { recursive: true, force: true });
  }, 60_000);

  it('1 · una empresa con contenido real', async () => {
    const usuario = await prisma.user.create({
      data: {
        email: `ensayo-${Date.now()}@ops.local`,
        passwordHash: 'no-importa',
        name: 'Dueña del ensayo',
      },
    });
    userId = usuario.id;

    const empresa = await prisma.organization.create({
      data: {
        name: marcas.empresa,
        slug: `ensayo-${Date.now()}`,
        // Configuración: si esto no vuelve, la empresa restaurada no sabe cómo pensar.
        settings: { knowledgeEngine: { confidence: { minimumFloor: 0.77 } } },
        memberships: { create: { userId: usuario.id, role: 'OWNER' } },
      },
    });
    organizationId = empresa.id;

    const coleccion = await prisma.knowledgeCollection.create({
      data: { organizationId, name: marcas.coleccion },
    });
    const fuente = await prisma.knowledgeSource.create({
      data: {
        organizationId,
        type: 'FILE_UPLOAD',
        name: 'Fuente del ensayo',
        connectorKey: 'file_upload_v1',
        createdById: usuario.id,
        status: 'CONNECTED',
        configEnc: '',
      },
    });
    const documento = await prisma.knowledgeItem.create({
      data: {
        organizationId,
        originKnowledgeSourceId: fuente.id,
        currentKnowledgeSourceId: fuente.id,
        title: marcas.documento,
        contentText: 'El contenido que la empresa perdería.',
        contentHash: `ensayo-${Date.now()}`,
        status: 'INDEXED',
        indexedAt: new Date(),
      },
    });
    await prisma.knowledgeItemCollection.create({
      data: {
        organizationId,
        knowledgeItemId: documento.id,
        knowledgeCollectionId: coleccion.id,
      },
    });

    const analisis = await prisma.analysisRun.create({
      data: { organizationId, trigger: 'MANUAL', status: 'SUCCESS' },
    });
    const conclusion = await prisma.insight.create({
      data: {
        organizationId,
        analysisRunId: analisis.id,
        subjectIdentity: `ensayo-${Date.now()}`,
        type: 'RISK',
        summary: marcas.conclusion,
        status: 'ACTIVE',
        strategyKey: 'ensayo',
        strategyVersion: '1.0.0',
        reasoningTrace: {},
        confidence: 0.9,
        confidenceComputedAt: new Date(),
        transitiveEvidenceClosure: [
          { kind: 'KNOWLEDGE_ITEM', refId: documento.id },
        ],
      },
    });
    await prisma.recommendation.create({
      data: {
        organizationId,
        sourceInsightId: conclusion.id,
        title: marcas.recomendacion,
        description: 'Propuesta del ensayo de recuperación.',
        status: 'NEW',
        detected: 'Algo que revisar.',
        justification: 'Porque sí.',
        estimatedImpact: 'Poco.',
        advantages: 'Alguna.',
        drawbacks: 'Alguna.',
        affectedAreas: 'Una.',
        migrationPlan: 'Ninguno.',
        effectiveCollectionScope: [coleccion.id],
      },
    });

    expect(organizationId).toBeTruthy();
  });

  it('2 · se hace la copia', async () => {
    await ejecutar(
      process.execPath,
      [join(RAIZ, 'scripts', 'db-backup.mjs'), copia],
      { cwd: RAIZ, env: process.env, maxBuffer: 64 * 1024 * 1024 },
    );

    // El fichero existe y no está vacío. Una copia de cero bytes es el fallo clásico que solo
    // se descubre al necesitarla.
    const { statSync } = await import('node:fs');
    expect(statSync(copia).size).toBeGreaterThan(1024);
  });

  it('3 · la empresa se pierde', async () => {
    await prisma.organization.delete({ where: { id: organizationId } });

    await expect(
      prisma.organization.count({ where: { id: organizationId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.knowledgeItem.count({ where: { organizationId } }),
    ).resolves.toBe(0);
  });

  it('4 · se restaura en una base aparte', async () => {
    await ejecutar(
      process.execPath,
      [join(RAIZ, 'scripts', 'db-restore.mjs'), copia, BASE_RESTAURADA],
      { cwd: RAIZ, env: process.env, maxBuffer: 64 * 1024 * 1024 },
    );

    const url = new URL(process.env.DATABASE_URL ?? '');
    url.pathname = `/${BASE_RESTAURADA}`;
    restaurada = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
  });

  it('5 · CRÍTICO: la empresa y todo su contenido están de vuelta', async () => {
    const empresa = await restaurada.organization.findUnique({
      where: { id: organizationId },
    });

    expect(empresa).not.toBeNull();
    expect(empresa?.name).toBe(marcas.empresa);
    // La configuración también: sin ella, la empresa restaurada no se comporta igual.
    expect(empresa?.settings).toMatchObject({
      knowledgeEngine: { confidence: { minimumFloor: 0.77 } },
    });
  });

  it('5 · CRÍTICO: los documentos, con su contenido', async () => {
    const documentos = await restaurada.knowledgeItem.findMany({
      where: { organizationId },
    });

    expect(documentos).toHaveLength(1);
    expect(documentos[0].title).toBe(marcas.documento);
    // El texto, no solo la fila: un documento sin contenido no se puede volver a preguntar.
    expect(documentos[0].contentText).toContain('la empresa perdería');
  });

  it('5 · CRÍTICO: las colecciones y su pertenencia', async () => {
    // La colección es la frontera de acceso. Restaurarla vacía dejaría a todo el mundo sin
    // ver nada, o —peor— dejaría los documentos fuera de cualquier frontera.
    const colecciones = await restaurada.knowledgeCollection.findMany({
      where: { organizationId },
    });
    expect(colecciones.map((c) => c.name)).toEqual([marcas.coleccion]);

    await expect(
      restaurada.knowledgeItemCollection.count({ where: { organizationId } }),
    ).resolves.toBe(1);
  });

  it('5 · CRÍTICO: las conclusiones y las recomendaciones pendientes', async () => {
    const conclusiones = await restaurada.insight.findMany({
      where: { organizationId },
    });
    expect(conclusiones.map((i) => i.summary)).toEqual([marcas.conclusion]);

    const recomendaciones = await restaurada.recommendation.findMany({
      where: { organizationId },
    });
    expect(recomendaciones).toHaveLength(1);
    expect(recomendaciones[0].title).toBe(marcas.recomendacion);
    // Y sigue pendiente de decisión humana: una restauración no puede aprobar nada.
    expect(recomendaciones[0].status).toBe('NEW');
    expect(recomendaciones[0].resolvedById).toBeNull();
  });

  it('5 · las personas y su pertenencia a la empresa', async () => {
    const miembros = await restaurada.membership.findMany({
      where: { organizationId },
      include: { user: true },
    });

    expect(miembros).toHaveLength(1);
    expect(miembros[0].role).toBe('OWNER');
    expect(miembros[0].user.name).toBe('Dueña del ensayo');
  });
});
