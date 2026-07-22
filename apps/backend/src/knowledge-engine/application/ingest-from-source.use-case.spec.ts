import { NotFoundException } from '@nestjs/common';
import { IngestFromSourceUseCase } from './ingest-from-source.use-case';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ConnectorRegistry } from '../infrastructure/connectors/connector-registry.service';
import type { ExtractedContent } from '../domain/ports/connector.port';

describe('IngestFromSourceUseCase', () => {
  let prisma: {
    knowledgeSource: { findFirst: jest.Mock; update: jest.Mock };
    ingestionJob: { create: jest.Mock; update: jest.Mock };
    knowledgeItem: { create: jest.Mock };
  };
  let connectorRegistry: { get: jest.Mock };
  let useCase: IngestFromSourceUseCase;

  const knowledgeSource = {
    id: 'source-1',
    organizationId: 'org-1',
    connectorKey: 'file_upload_v1',
  };

  beforeEach(() => {
    prisma = {
      knowledgeSource: { findFirst: jest.fn(), update: jest.fn() },
      ingestionJob: { create: jest.fn(), update: jest.fn() },
      knowledgeItem: { create: jest.fn() },
    };
    connectorRegistry = { get: jest.fn() };

    prisma.knowledgeSource.findFirst.mockResolvedValue(knowledgeSource);
    prisma.ingestionJob.create.mockResolvedValue({ id: 'job-1' });
    prisma.ingestionJob.update.mockResolvedValue({});
    prisma.knowledgeSource.update.mockResolvedValue({});

    useCase = new IngestFromSourceUseCase(
      prisma as unknown as PrismaService,
      connectorRegistry as unknown as ConnectorRegistry,
    );
  });

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

  it('camino feliz: normaliza el contenido extraído y crea un KnowledgeItem trazable a su job', async () => {
    const extracted: ExtractedContent[] = [
      {
        title: 'politica-vacaciones.txt',
        mimeType: 'text/plain',
        sizeBytes: 42,
        rawContent: Buffer.from('22 días de vacaciones al año.'),
      },
    ];
    connectorRegistry.get.mockReturnValue({
      key: 'file_upload_v1',
      extract: jest.fn().mockResolvedValue(extracted),
    });
    prisma.knowledgeItem.create.mockResolvedValue({ id: 'item-1' });

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    expect(result).toEqual({
      ingestionJobId: 'job-1',
      status: 'SUCCESS',
      stats: { itemsFound: 1, itemsCreated: 1, itemsFailed: 0 },
      knowledgeItemIds: ['item-1'],
    });

    // Procedencia inmutable y ubicación actual coinciden en esta subfase (§3.5).
    expect(prisma.knowledgeItem.create).toHaveBeenCalledWith(
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

  it('contenido no normalizable: el job queda FAILED y la fuente en ERROR (fallo total, único ítem)', async () => {
    const extracted: ExtractedContent[] = [
      {
        title: 'archivo.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
        rawContent: Buffer.from('%PDF-1.4'),
      },
    ];
    connectorRegistry.get.mockReturnValue({
      key: 'file_upload_v1',
      extract: jest.fn().mockResolvedValue(extracted),
    });

    const result = await useCase.execute({
      organizationId: 'org-1',
      knowledgeSourceId: 'source-1',
      connectorInput: { file: {} },
    });

    expect(result.status).toBe('FAILED');
    expect(result.stats).toEqual({
      itemsFound: 1,
      itemsCreated: 0,
      itemsFailed: 1,
    });
    expect(result.knowledgeItemIds).toEqual([]);
    expect(prisma.knowledgeItem.create).not.toHaveBeenCalled();
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
