import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@businessbrain/database';
import { ClassifyContentUseCase } from './classify-content.use-case';
import { IngestFromSourceUseCase } from './ingest-from-source.use-case';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConnectorRegistry } from '../infrastructure/connectors/connector-registry.service';
import type { ExtractedContent } from '../domain/ports/connector.port';

describe('IngestFromSourceUseCase', () => {
  let tx: {
    knowledgeItem: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    knowledgeItemLineageEdge: { create: jest.Mock };
    knowledgeItemCollection: { findMany: jest.Mock; createMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    knowledgeSource: { findFirst: jest.Mock; update: jest.Mock };
    organization: { findUniqueOrThrow: jest.Mock };
    ingestionJob: { create: jest.Mock; update: jest.Mock };
    knowledgeItem: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let classifyContent: { execute: jest.Mock };
  let connectorRegistry: { get: jest.Mock };
  let useCase: IngestFromSourceUseCase;

  const knowledgeSource = {
    id: 'source-1',
    organizationId: 'org-1',
    connectorKey: 'file_upload_v1',
  };

  beforeEach(() => {
    tx = {
      knowledgeItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      knowledgeItemLineageEdge: { create: jest.fn().mockResolvedValue({}) },
      knowledgeItemCollection: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn(),
    };

    prisma = {
      knowledgeSource: { findFirst: jest.fn(), update: jest.fn() },
      organization: { findUniqueOrThrow: jest.fn() },
      ingestionJob: { create: jest.fn(), update: jest.fn() },
      knowledgeItem: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ classificationSource: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    connectorRegistry = { get: jest.fn() };

    prisma.knowledgeSource.findFirst.mockResolvedValue(knowledgeSource);
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ settings: {} });
    prisma.ingestionJob.create.mockResolvedValue({ id: 'job-1' });
    prisma.ingestionJob.update.mockResolvedValue({});
    prisma.knowledgeSource.update.mockResolvedValue({});
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(tx),
    );

    // Doble de la clasificación: la subfase 2.3 la ejecuta tras deduplicar, y estos tests
    // verifican deduplicación y versionado (2.2), no el clasificador — que tiene su propia
    // suite. Devuelve un resultado sin clasificar, el mismo camino que un fallo de proveedor.
    classifyContent = {
      execute: jest.fn().mockResolvedValue({
        taxonomyNodeId: null,
        taxonomyKey: null,
        businessArea: null,
        tags: [],
        certainty: 0,
      }),
    };

    useCase = new IngestFromSourceUseCase(
      prisma as unknown as PrismaService,
      connectorRegistry as unknown as ConnectorRegistry,
      classifyContent as unknown as ClassifyContentUseCase,
    );
  });

  function extractedOf(content: ExtractedContent[]) {
    connectorRegistry.get.mockReturnValue({
      key: 'file_upload_v1',
      extract: jest.fn().mockResolvedValue(content),
    });
  }

  it('lanza NotFoundException si la KnowledgeSource no existe en la organización', async () => {
    prisma.knowledgeSource.findFirst.mockResolvedValueOnce(null);

    await expect(
      useCase.execute({
        organizationId: 'org-1',
        knowledgeSourceId: 'no-existe',
        connectorInput: {},
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });

  it('camino feliz: contenido nuevo crea un KnowledgeItem, sin arista de linaje', async () => {
    extractedOf([
      {
        title: 'politica-vacaciones.txt',
        mimeType: 'text/plain',
        sizeBytes: 42,
        rawContent: Buffer.from('22 días de vacaciones al año.'),
      },
    ]);
    tx.knowledgeItem.create.mockResolvedValue({ id: 'item-1' });

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    expect(result).toEqual({
      ingestionJobId: 'job-1',
      status: 'SUCCESS',
      stats: {
        itemsFound: 1,
        itemsCreated: 1,
        itemsUpdated: 0,
        itemsSkippedDuplicate: 0,
        itemsFailed: 0,
      },
      knowledgeItemIds: ['item-1'],
    });

    expect(tx.knowledgeItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          originKnowledgeSourceId: 'source-1',
          originIngestionJobId: 'job-1',
          currentKnowledgeSourceId: 'source-1',
          contentText: '22 días de vacaciones al año.',
          status: 'PROCESSING',
        }),
      }),
    );
    expect(tx.knowledgeItemLineageEdge.create).not.toHaveBeenCalled();

    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'SUCCESS', error: null }),
      }),
    );
    expect(prisma.knowledgeSource.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONNECTED' }),
      }),
    );
  });

  it('nivel 1 — duplicado exacto: no crea un ítem nuevo y el job termina en éxito', async () => {
    extractedOf([
      {
        title: 'politica-vacaciones.txt',
        mimeType: 'text/plain',
        sizeBytes: 42,
        rawContent: Buffer.from('22 días de vacaciones al año.'),
      },
    ]);
    tx.knowledgeItem.findFirst.mockResolvedValue({ id: 'existing-item' });

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.stats).toEqual({
      itemsFound: 1,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsSkippedDuplicate: 1,
      itemsFailed: 0,
    });
    expect(result.knowledgeItemIds).toEqual(['existing-item']);
    expect(tx.knowledgeItem.create).not.toHaveBeenCalled();
  });

  it('nivel 1 — carrera de concurrencia: una violación de unicidad se trata como duplicado, no como fallo', async () => {
    extractedOf([
      {
        title: 'politica-vacaciones.txt',
        mimeType: 'text/plain',
        sizeBytes: 42,
        rawContent: Buffer.from('22 días de vacaciones al año.'),
      },
    ]);
    // La comprobación de nivel 1 dentro de la transacción no encuentra nada (todavía no ha
    // comprometido la transacción ganadora), pero el propio INSERT choca con la restricción de
    // unicidad — exactamente la carrera descrita en KNOWLEDGE_ENGINE_DESIGN.md §7.
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    prisma.$transaction.mockRejectedValueOnce(uniqueViolation);
    prisma.knowledgeItem.findFirst.mockResolvedValue({ id: 'winner-item' });

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.stats.itemsSkippedDuplicate).toBe(1);
    expect(result.knowledgeItemIds).toEqual(['winner-item']);
  });

  // Párrafo de longitud realista (no una frase de juguete): con shingles de 5 palabras, un
  // documento corto exagera el efecto de cambiar una sola palabra sobre la similitud de Jaccard.
  const politicaVacacionesOriginal =
    'La política de vacaciones de la empresa establece que todos los empleados a tiempo completo ' +
    'tienen derecho a 22 días laborables de vacaciones al año, contados desde la fecha de ' +
    'incorporación oficial a la plantilla. Estos días deben solicitarse con al menos dos semanas ' +
    'de antelación a través del sistema interno de recursos humanos y quedan sujetos a la ' +
    'aprobación expresa del responsable directo de cada departamento antes de considerarse ' +
    'confirmados de forma definitiva por la organización.';
  const politicaVacacionesEditada = politicaVacacionesOriginal.replace(
    '22 días',
    '25 días',
  );

  it('nivel 2 — similitud estructural alta: crea una nueva versión, arista UPDATES y hereda colecciones', async () => {
    extractedOf([
      {
        title: 'politica-vacaciones.txt',
        mimeType: 'text/plain',
        sizeBytes: 45,
        rawContent: Buffer.from(politicaVacacionesEditada),
      },
    ]);
    const predecessor = {
      id: 'predecessor-item',
      title: 'politica-vacaciones.txt',
      contentText: politicaVacacionesOriginal,
      status: 'PROCESSING',
    };
    tx.knowledgeItem.findMany.mockResolvedValue([predecessor]);
    tx.$queryRaw.mockResolvedValue([
      { id: predecessor.id, status: 'PROCESSING' },
    ]);
    tx.knowledgeItem.create.mockResolvedValue({ id: 'new-version-item' });
    tx.knowledgeItemCollection.findMany.mockResolvedValue([
      { knowledgeCollectionId: 'collection-a' },
      { knowledgeCollectionId: 'collection-b' },
    ]);

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    expect(result.stats).toEqual({
      itemsFound: 1,
      itemsCreated: 0,
      itemsUpdated: 1,
      itemsSkippedDuplicate: 0,
      itemsFailed: 0,
    });
    expect(result.knowledgeItemIds).toEqual(['new-version-item']);

    expect(tx.knowledgeItemLineageEdge.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        fromKnowledgeItemId: 'new-version-item',
        toKnowledgeItemId: 'predecessor-item',
        type: 'UPDATES',
      },
    });
    expect(tx.knowledgeItem.update).toHaveBeenCalledWith({
      where: { id: 'predecessor-item' },
      data: { status: 'SUPERSEDED' },
    });
    expect(tx.knowledgeItemCollection.createMany).toHaveBeenCalledWith({
      data: [
        {
          knowledgeItemId: 'new-version-item',
          knowledgeCollectionId: 'collection-a',
          organizationId: 'org-1',
        },
        {
          knowledgeItemId: 'new-version-item',
          knowledgeCollectionId: 'collection-b',
          organizationId: 'org-1',
        },
      ],
    });
  });

  it('nivel 2 — el predecesor bloqueado ya no está activo (carrera concurrente): se trata como contenido nuevo', async () => {
    extractedOf([
      {
        title: 'politica-vacaciones.txt',
        mimeType: 'text/plain',
        sizeBytes: 45,
        rawContent: Buffer.from(politicaVacacionesEditada),
      },
    ]);
    const predecessor = {
      id: 'predecessor-item',
      title: 'politica-vacaciones.txt',
      contentText: politicaVacacionesOriginal,
      status: 'PROCESSING',
    };
    tx.knowledgeItem.findMany.mockResolvedValue([predecessor]);
    // Al bloquear la fila, otra transacción ya la superó (concurrencia real).
    tx.$queryRaw.mockResolvedValue([
      { id: predecessor.id, status: 'SUPERSEDED' },
    ]);
    tx.knowledgeItem.create.mockResolvedValue({ id: 'new-item-race' });

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    // La similitud sí superó el umbral (se llegó a bloquear la fila) — la carrera se resuelve
    // como contenido nuevo precisamente porque el predecesor ya no estaba activo al bloquearlo.
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(result.stats.itemsCreated).toBe(1);
    expect(result.stats.itemsUpdated).toBe(0);
    expect(tx.knowledgeItemLineageEdge.create).not.toHaveBeenCalled();
  });

  it('contenido no normalizable: el job queda FAILED y la fuente en ERROR (fallo total, único ítem)', async () => {
    extractedOf([
      {
        title: 'archivo.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        rawContent: Buffer.from('%PDF-1.4'),
      },
    ]);

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    expect(result.status).toBe('FAILED');
    expect(result.stats).toEqual({
      itemsFound: 1,
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsSkippedDuplicate: 0,
      itemsFailed: 1,
    });
    expect(result.knowledgeItemIds).toEqual([]);
    expect(tx.knowledgeItem.create).not.toHaveBeenCalled();
    expect(prisma.knowledgeSource.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ERROR' }),
      }),
    );
  });

  it('si el conector falla por completo, el job y la fuente quedan en error y el use-case relanza', async () => {
    connectorRegistry.get.mockReturnValue({
      key: 'file_upload_v1',
      extract: jest.fn().mockRejectedValue(new Error('conector caído')),
    });

    await expect(
      useCase.execute({
        organizationId: 'org-1',
        knowledgeSourceId: 'source-1',
        connectorInput: { file: {} },
      }),
    ).rejects.toThrow('conector caído');

    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'conector caído',
        }),
      }),
    );
    expect(prisma.knowledgeSource.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ERROR',
          lastError: 'conector caído',
        }),
      }),
    );
  });
});
