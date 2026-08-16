import { NotFoundException } from '@nestjs/common';
import { KnowledgeSourcesService } from './knowledge-sources.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { EncryptionService } from '../../common/utils/encryption.util';

describe('KnowledgeSourcesService', () => {
  let prisma: {
    knowledgeSource: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    knowledgeSourceCollection: { createMany: jest.Mock };
    knowledgeCollection: { count: jest.Mock };
    $transaction: jest.Mock;
  };
  let encryption: { encrypt: jest.Mock };
  let service: KnowledgeSourcesService;

  beforeEach(() => {
    prisma = {
      knowledgeSource: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      // Colecciones de destino de la fuente: sin ellas, lo que entre por aquí nace invisible.
      knowledgeSourceCollection: {
        createMany: jest.fn().mockResolvedValue({}),
      },
      knowledgeCollection: { count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
      fn(prisma),
    );
    encryption = { encrypt: jest.fn().mockReturnValue('iv:tag:cipher') };
    service = new KnowledgeSourcesService(
      prisma as unknown as PrismaService,
      encryption as unknown as EncryptionService,
    );
  });

  it('cifra la config antes de guardarla y nunca selecciona configEnc en la respuesta', async () => {
    prisma.knowledgeSource.create.mockImplementation(({ data, select }) =>
      Promise.resolve({ id: 'source-1', ...data, select }),
    );

    await service.create('org-1', 'user-1', {
      name: 'Documentos RR. HH.',
      type: 'FILE_UPLOAD',
      connectorKey: 'file_upload_v1',
      config: { foo: 'bar' },
    });

    expect(encryption.encrypt).toHaveBeenCalledWith(
      JSON.stringify({ foo: 'bar' }),
    );
    const call = prisma.knowledgeSource.create.mock.calls[0][0];
    expect(call.data.configEnc).toBe('iv:tag:cipher');
    expect(call.select).not.toHaveProperty('configEnc');
  });

  it('cifra un objeto vacío cuando no se pasa config', async () => {
    prisma.knowledgeSource.create.mockResolvedValue({ id: 'source-1' });

    await service.create('org-1', 'user-1', {
      name: 'Carga manual',
      type: 'FILE_UPLOAD',
      connectorKey: 'file_upload_v1',
    });

    expect(encryption.encrypt).toHaveBeenCalledWith('{}');
  });

  it('lanza NotFoundException si la fuente no existe en la organización', async () => {
    prisma.knowledgeSource.findFirst.mockResolvedValue(null);

    await expect(service.findOne('org-1', 'no-existe')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
