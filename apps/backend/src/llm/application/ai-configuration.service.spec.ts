import { BadRequestException } from '@nestjs/common';
import {
  AiConfigurationService,
  explainVerificationFailure,
} from './ai-configuration.service';
import { EncryptionService } from '../../common/utils/encryption.util';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import type { ProviderRegistry } from './provider-registry.service';
import type { ConfigService } from '@nestjs/config';

describe('AiConfigurationService', () => {
  const encryption = new EncryptionService({
    get: () => Buffer.alloc(32, 9).toString('base64'),
  } as unknown as ConstructorParameters<typeof EncryptionService>[0]);

  let prisma: {
    llmProfile: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let embed: jest.Mock;
  let audit: { record: jest.Mock };
  let platformKeys: { openai?: string; anthropic?: string };
  let service: AiConfigurationService;

  beforeEach(() => {
    prisma = {
      llmProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'perfil-1' }),
        update: jest.fn().mockResolvedValue({ id: 'perfil-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    // Vector plausible: la comprobación exige que el proveedor devuelva algo real.
    embed = jest.fn().mockResolvedValue([new Array(1536).fill(0.1)]);
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    platformKeys = {};

    service = new AiConfigurationService(
      prisma as unknown as PrismaService,
      encryption,
      {
        getEmbeddingProvider: () => ({ embed }),
      } as unknown as ProviderRegistry,
      audit as unknown as AuditService,
      {
        get: () => platformKeys,
      } as unknown as ConfigService<never, true>,
    );
  });

  describe('configurar', () => {
    it('CRÍTICO: guarda la clave CIFRADA y no la devuelve jamás', async () => {
      // El estado se relee tras escribir, así que el doble tiene que reflejar lo guardado:
      // si no, la aserción hablaría del doble y no del servicio.
      prisma.llmProfile.create.mockImplementation(({ data }) => {
        prisma.llmProfile.findFirst.mockResolvedValue(data);
        return Promise.resolve({ id: 'perfil-1', ...data });
      });

      const resultado = await service.configure({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        provider: 'OPENAI',
        apiKey: 'sk-la-clave-de-la-empresa',
      });

      const guardado = prisma.llmProfile.create.mock.calls[0][0].data;
      // Cifrada de verdad: el valor en claro no está en lo que se escribe.
      expect(guardado.apiKeyEnc).not.toContain('sk-la-clave-de-la-empresa');
      expect(encryption.decrypt(guardado.apiKeyEnc)).toBe(
        'sk-la-clave-de-la-empresa',
      );

      // Y la respuesta no la lleva por ninguna vía, ni siquiera enmascarada.
      expect(JSON.stringify(resultado)).not.toContain('sk-');
      expect(resultado).toMatchObject({
        origin: 'PROPIA',
        ready: true,
        hasOwnKey: true,
      });
    });

    it('CRÍTICO: comprueba la clave ANTES de escribir nada', async () => {
      embed.mockRejectedValue(new Error('401 Unauthorized'));

      await expect(
        service.configure({
          organizationId: 'org-1',
          actorUserId: 'user-1',
          provider: 'OPENAI',
          apiKey: 'sk-mal',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // Guardar una clave que no funciona dejaría a la empresa creyendo que ya está lista.
      expect(prisma.llmProfile.create).not.toHaveBeenCalled();
      expect(prisma.llmProfile.update).not.toHaveBeenCalled();
    });

    it('se comprueba pidiendo un EMBEDDING, que es la capacidad de la que depende todo', async () => {
      // Una clave válida solo para conversar dejaría a la empresa subiendo documentos que
      // nunca podría preguntar, y el fallo aparecería lejos de esta pantalla.
      await service.configure({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        provider: 'OPENAI',
        apiKey: 'sk-buena',
      });

      expect(embed).toHaveBeenCalledWith(
        expect.any(Array),
        'text-embedding-3-small',
        'sk-buena',
      );
    });

    it('reconfigurar ACTUALIZA en vez de crear un segundo perfil', async () => {
      prisma.llmProfile.findFirst.mockResolvedValueOnce({
        id: 'perfil-existente',
      });

      await service.configure({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        provider: 'OPENAI',
        apiKey: 'sk-nueva',
      });

      // Dos perfiles por defecto dejarían la elección del modelo al azar de una consulta.
      expect(prisma.llmProfile.create).not.toHaveBeenCalled();
      expect(prisma.llmProfile.update).toHaveBeenCalled();
    });

    it('RECHAZA un proveedor fuera del catálogo, sin llamar a nadie', async () => {
      await expect(
        service.configure({
          organizationId: 'org-1',
          actorUserId: 'user-1',
          provider: 'GEMINI',
          apiKey: 'x'.repeat(20),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(embed).not.toHaveBeenCalled();
    });

    it('deja traza SIN la clave', async () => {
      await service.configure({
        organizationId: 'org-1',
        actorUserId: 'user-1',
        provider: 'OPENAI',
        apiKey: 'sk-secretisima',
      });

      const registrado = audit.record.mock.calls[0][0];
      expect(registrado).toMatchObject({
        organizationId: 'org-1',
        actorId: 'user-1',
        action: 'ai.configured',
      });
      // Ni la clave ni un fragmento de ella: una traza filtrada es peor que un log filtrado.
      expect(JSON.stringify(registrado)).not.toContain('sk-secretisima');
    });
  });

  describe('estado', () => {
    it('sin nada configurado NO se declara listo', async () => {
      expect(await service.status('org-1')).toMatchObject({
        ready: false,
        origin: 'SIN_CONFIGURAR',
        hasOwnKey: false,
      });
    });

    it('un perfil de plataforma SIN clave detrás no cuenta como listo', async () => {
      // Diría "listo" y fallaría en la primera pregunta, que es el peor momento para
      // enterarse.
      prisma.llmProfile.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          provider: 'OPENAI',
          modelName: 'gpt-4.1-mini',
        });

      expect((await service.status('org-1')).ready).toBe(false);
    });

    it('con clave de plataforma sí está listo, y se dice de quién es', async () => {
      platformKeys = { openai: 'sk-de-la-plataforma' };
      prisma.llmProfile.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          provider: 'OPENAI',
          modelName: 'gpt-4.1-mini',
        });

      const status = await service.status('org-1');

      expect(status).toMatchObject({ ready: true, origin: 'PLATAFORMA' });
      expect(JSON.stringify(status)).not.toContain('sk-de-la-plataforma');
    });
  });

  describe('retirar la clave propia', () => {
    it('borra el perfil entero, no solo la clave', async () => {
      // Un perfil sin clave seguiría ganando al de plataforma y dejaría a la empresa sin IA
      // sin haberlo pedido.
      await service.removeOwnKey({
        organizationId: 'org-1',
        actorUserId: 'user-1',
      });

      expect(prisma.llmProfile.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai.key_removed' }),
      );
    });
  });
});

describe('explainVerificationFailure', () => {
  it.each([
    ['401 Unauthorized', /copiado entera/i],
    ['invalid_api_key', /copiado entera/i],
    ['429 rate limit, quota exceeded', /saldo o el límite/i],
    ['billing hard limit reached', /saldo o el límite/i],
    ['fetch failed', /contactar con tu proveedor/i],
    ['network timeout', /contactar con tu proveedor/i],
    ['algo rarísimo', /no hemos podido validar/i],
  ])('traduce "%s" a algo accionable', (detalle, esperado) => {
    expect(explainVerificationFailure(detalle)).toMatch(esperado);
  });

  it('CRÍTICO: ninguna traducción filtra detalles técnicos', () => {
    // El motivo exacto queda en los registros. Aquí no puede aparecer el cuerpo de la
    // respuesta del proveedor, que puede llevar detalles de la cuenta del cliente.
    for (const detalle of [
      '401 {"error":{"message":"Incorrect API key provided: sk-abc123"}}',
      'Error: getaddrinfo ENOTFOUND api.openai.com',
    ]) {
      const mensaje = explainVerificationFailure(detalle);
      expect(mensaje).not.toContain('sk-abc123');
      expect(mensaje).not.toMatch(/401|ENOTFOUND|api\.openai\.com|\{/);
    }
  });
});
