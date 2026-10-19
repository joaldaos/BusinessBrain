import { randomBytes } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import {
  ConnectionStatus,
  ConnectorAuthKind,
  IntegrationProvider,
} from '@businessbrain/database';
import { ReceiveWebhookUseCase } from '../../src/connectors/application/receive-webhook.use-case';
import { PostgresJobQueue } from '../../src/jobs/infrastructure/postgres-job-queue';
import { EncryptionService } from '../../src/common/utils/encryption.util';
import { forOrganization } from '../../src/common/utils/encryption-scope';
import {
  computeSignature,
  REPLAY_WINDOW_MS,
} from '../../src/connectors/domain/webhook-signature';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * La puerta abierta del sistema, contra Postgres de verdad — Fase 9B.
 *
 * Un webhook es el único endpoint sin sesión: la autenticación la da la firma. Lo que se
 * comprueba aquí es que un envío no verificado **no deja rastro ninguno** —ni trabajo
 * encolado, ni hecho escrito— y que uno válido encola exactamente un trabajo por mucho que
 * se repita.
 */
describe('Webhooks entrantes (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let caso: ReceiveWebhookUseCase;
  let encryption: EncryptionService;
  let connectorId: string;

  const SECRETO = 'secreto-compartido-con-el-proveedor';
  const CUERPO = JSON.stringify({ aviso: 'hay ventas nuevas' });

  beforeEach(async () => {
    org = await createTestOrg('webhook-int');
    encryption = new EncryptionService({
      get: () => randomBytes(32).toString('base64'),
    } as never);

    caso = new ReceiveWebhookUseCase(db, encryption, new PostgresJobQueue(db));

    const integration = await prisma.integration.create({
      data: {
        organizationId: org.orgId,
        provider: IntegrationProvider.CUSTOM,
        connectorKey: 'tpv_ficticio_v1',
        authKind: ConnectorAuthKind.API_KEY,
        status: ConnectionStatus.CONNECTED,
        connectedById: org.userId,
        secretEnc: encryption.encryptFor(forOrganization(org.orgId), SECRETO),
      },
      select: { id: true },
    });

    const connector = await prisma.organizationConnector.create({
      data: {
        organizationId: org.orgId,
        connectorKey: 'tpv_ficticio_v1',
        displayName: 'TPV de prueba',
        status: ConnectionStatus.CONNECTED,
        createdById: org.userId,
        integrationId: integration.id,
      },
      select: { id: true },
    });
    connectorId = connector.id;
  });

  afterEach(async () => {
    await prisma.job.deleteMany({ where: { organizationId: org.orgId } });
    await prisma.connectorSync.deleteMany({
      where: { organizationId: org.orgId },
    });
    await prisma.organizationConnector.deleteMany({
      where: { organizationId: org.orgId },
    });
    await destroyTestOrg(org);
  });

  const envio = (extra: Record<string, unknown> = {}) => {
    const timestamp = String(Date.now());
    return {
      connectorId,
      rawBody: CUERPO,
      timestamp,
      signature: computeSignature(SECRETO, timestamp, CUERPO),
      ...extra,
    };
  };

  const trabajos = () =>
    prisma.job.findMany({ where: { organizationId: org.orgId } });

  describe('un envío válido', () => {
    it('se acepta y encola una sincronización', async () => {
      await expect(caso.receive(envio())).resolves.toEqual({ accepted: true });

      const encolados = await trabajos();
      expect(encolados).toHaveLength(1);
      expect(encolados[0]?.kind).toBe('connector.sync');
      expect(encolados[0]?.payload).toMatchObject({
        connectorId,
        origen: 'webhook',
      });
    });

    /**
     * Un proveedor activo manda avisos continuamente. Sin deduplicación, cada uno encolaría
     * un trabajo y la cola se llenaría de sincronizaciones idénticas del mismo conector.
     */
    it('diez avisos seguidos encolan UN solo trabajo', async () => {
      for (let i = 0; i < 10; i++) await caso.receive(envio());

      expect(await trabajos()).toHaveLength(1);
    });

    it('el trabajo NO lleva los datos del envío, solo el aviso', async () => {
      // Firmado DE VERDAD sobre este cuerpo: aquí se comprueba qué se guarda de un envío
      // legítimo, no que se rechace uno manipulado (eso ya tiene su propia prueba).
      const cuerpo = JSON.stringify({ venta: { importe: 999999 } });
      const timestamp = String(Date.now());
      await caso.receive({
        connectorId,
        rawBody: cuerpo,
        timestamp,
        signature: computeSignature(SECRETO, timestamp, cuerpo),
      });

      // El cuerpo del webhook no es una vía de escritura: la verdad la sigue teniendo el
      // proveedor, y la sincronización va a buscarla. Aunque alguien tuviera el secreto, no
      // podría inyectar una venta.
      const [trabajo] = await trabajos();
      expect(JSON.stringify(trabajo?.payload)).not.toContain('999999');
    });
  });

  describe('un envío NO verificado no deja rastro', () => {
    const rechazos: [string, Record<string, unknown>][] = [
      ['sin firma', { signature: undefined }],
      ['con firma de otro secreto', { signature: 'a'.repeat(64) }],
      ['sin marca de tiempo', { timestamp: undefined }],
    ];

    it.each(rechazos)('%s', async (_caso, extra) => {
      await expect(caso.receive(envio(extra))).rejects.toThrow(
        UnauthorizedException,
      );

      expect(await trabajos()).toHaveLength(0);
    });

    it('con el cuerpo manipulado tras firmar', async () => {
      const bueno = envio();

      await expect(
        caso.receive({ ...bueno, rawBody: JSON.stringify({ aviso: 'otro' }) }),
      ).rejects.toThrow(UnauthorizedException);

      expect(await trabajos()).toHaveLength(0);
    });

    it('reenviado fuera de ventana', async () => {
      const viejo = String(Date.now() - REPLAY_WINDOW_MS - 10_000);

      await expect(
        caso.receive(
          envio({
            timestamp: viejo,
            signature: computeSignature(SECRETO, viejo, CUERPO),
          }),
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(await trabajos()).toHaveLength(0);
    });
  });

  describe('qué se le cuenta a quien llama', () => {
    /**
     * Un 404 para un conector inexistente permitiría recorrer identificadores para descubrir
     * cuáles existen, y eso ya es información sobre los clientes que hay.
     */
    it('un conector inexistente se rechaza IGUAL que una firma mala', async () => {
      const inexistente = caso
        .receive(envio({ connectorId: 'no-existe-este-id' }))
        .catch((e: Error) => e.message);
      const firmaMala = caso
        .receive(envio({ signature: 'b'.repeat(64) }))
        .catch((e: Error) => e.message);

      expect(await inexistente).toBe(await firmaMala);
    });

    it('el motivo del rechazo nunca sale hacia fuera', async () => {
      const mensaje = await caso
        .receive(envio({ timestamp: String(Date.now() - 999_999) }))
        .catch((e: Error) => e.message);

      // Ni "ventana", ni "firma", ni "timestamp": nada que diga qué parte ya estaba bien.
      expect(mensaje).not.toMatch(/ventana|firma|timestamp|secreto/i);
    });
  });

  describe('conexión revocada', () => {
    it('deja de aceptar envíos aunque la firma siga siendo correcta', async () => {
      await prisma.integration.updateMany({
        where: { organizationId: org.orgId },
        data: { revokedAt: new Date() },
      });

      await expect(caso.receive(envio())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(await trabajos()).toHaveLength(0);
    });
  });

  describe('aislamiento', () => {
    it('el secreto de una empresa no vale para el conector de otra', async () => {
      const otra = await createTestOrg('webhook-vecina');
      const suIntegracion = await prisma.integration.create({
        data: {
          organizationId: otra.orgId,
          provider: IntegrationProvider.CUSTOM,
          authKind: ConnectorAuthKind.API_KEY,
          status: ConnectionStatus.CONNECTED,
          connectedById: otra.userId,
          // El MISMO secreto en claro, pero cifrado para OTRA organización.
          secretEnc: encryption.encryptFor(
            forOrganization(otra.orgId),
            SECRETO,
          ),
        },
        select: { id: true },
      });
      const suConector = await prisma.organizationConnector.create({
        data: {
          organizationId: otra.orgId,
          connectorKey: 'tpv_ficticio_v1',
          displayName: 'TPV vecino',
          status: ConnectionStatus.CONNECTED,
          createdById: otra.userId,
          integrationId: suIntegracion.id,
        },
        select: { id: true },
      });

      // Firmado con el secreto correcto: debe aceptarse en SU conector...
      await expect(
        caso.receive(envio({ connectorId: suConector.id })),
      ).resolves.toEqual({ accepted: true });

      // ...y el trabajo queda a nombre de SU empresa, no de la mía.
      const suyos = await prisma.job.findMany({
        where: { organizationId: otra.orgId },
      });
      expect(suyos).toHaveLength(1);
      expect(await trabajos()).toHaveLength(0);

      await prisma.job.deleteMany({ where: { organizationId: otra.orgId } });
      await prisma.organizationConnector.deleteMany({
        where: { organizationId: otra.orgId },
      });
      await destroyTestOrg(otra);
    });
  });
});
