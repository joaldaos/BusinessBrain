import { MessageRole } from '@businessbrain/database';
import { ConversationsService } from '../../src/conversations/conversations.service';
import { SendMessageUseCase } from '../../src/conversations/send-message.use-case';
import type { RetrieveContextUseCase } from '../../src/knowledge-engine/application/retrieve-context.use-case';
import type { RetrieveInsightsUseCase } from '../../src/understanding-engine/application/retrieve-insights.use-case';
import type { ProviderRegistry } from '../../src/llm/application/provider-registry.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  createInsight,
  createKnowledgeItem,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Fase 4, subfase 4.1 — conversaciones y pipeline de respuesta.
 *
 * Verifican lo que un doble no puede: el aislamiento real por organización y por usuario, y
 * que la respuesta persiste sus citas con trazabilidad hasta el fragmento exacto.
 *
 * El proveedor de LLM se dobla: su contrato tiene su propia suite y una llamada real está
 * pendiente de credencial (ver README del understanding-engine).
 */
describe('Conversations (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let conversations: ConversationsService;
  let sendMessage: SendMessageUseCase;
  let complete: jest.Mock<
    Promise<{ content: string }>,
    [{ systemPrompt: string; messages: { content: string }[] }]
  >;
  let retrievedChunks: unknown[];
  let retrievedInsights: unknown[];

  beforeEach(async () => {
    org = await createTestOrg('conv-int');
    conversations = new ConversationsService(db);
    complete = jest.fn<
      Promise<{ content: string }>,
      [{ systemPrompt: string; messages: { content: string }[] }]
    >(() => Promise.resolve({ content: 'Según [1], son 23 días.' }));
    retrievedChunks = [];
    retrievedInsights = [];

    sendMessage = new SendMessageUseCase(
      db,
      conversations,
      {
        execute: () => Promise.resolve(retrievedChunks),
      } as unknown as RetrieveContextUseCase,
      {
        execute: () => Promise.resolve(retrievedInsights),
      } as unknown as RetrieveInsightsUseCase,
      {
        resolveForOrganization: () =>
          Promise.resolve({
            profile: { modelName: 'model-x', apiKeyEnc: null },
            provider: { complete },
          }),
      } as unknown as ProviderRegistry,
    );
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const chunk = (id: string, content: string) => ({
    chunkId: id,
    content,
    confidenceScore: 0.85,
    citation: {
      knowledgeItemId: `item-${id}`,
      title: 'Política de Vacaciones',
      chunkIndex: 0,
      heading: 'Días disponibles',
      headingPath: ['Política de Vacaciones', 'Días disponibles'],
    },
  });

  describe('ciclo de vida de la conversación', () => {
    it('crea, lista y recupera una conversación con su historial', async () => {
      const created = await conversations.create({
        organizationId: org.orgId,
        userId: org.userId,
        title: 'Dudas de RR. HH.',
      });

      expect(
        await conversations.listForUser({
          organizationId: org.orgId,
          userId: org.userId,
        }),
      ).toHaveLength(1);

      const found = await conversations.findOne({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: created.id,
      });
      expect(found.title).toBe('Dudas de RR. HH.');
      expect(found.messages).toEqual([]);
    });

    it('archivar es baja lógica: deja de listarse pero conserva el historial', async () => {
      const created = await conversations.create({
        organizationId: org.orgId,
        userId: org.userId,
      });

      await conversations.archive({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: created.id,
      });

      expect(
        await conversations.listForUser({
          organizationId: org.orgId,
          userId: org.userId,
        }),
      ).toHaveLength(0);
      expect(
        await conversations.listForUser({
          organizationId: org.orgId,
          userId: org.userId,
          includeArchived: true,
        }),
      ).toHaveLength(1);
    });

    it('una organización no accede a conversaciones de otra', async () => {
      const other = await createTestOrg('conv-int-b');
      const theirs = await conversations.create({
        organizationId: other.orgId,
        userId: other.userId,
      });

      await expect(
        conversations.findOne({
          organizationId: org.orgId,
          userId: org.userId,
          conversationId: theirs.id,
        }),
      ).rejects.toThrow();

      await destroyTestOrg(other);
    });

    it('un usuario no accede a conversaciones de otro usuario de su misma organización', async () => {
      const otherUser = await prisma.user.create({
        data: {
          email: `otro-${Date.now()}@t.local`,
          passwordHash: 'x',
          name: 'Otro',
        },
      });
      const theirs = await conversations.create({
        organizationId: org.orgId,
        userId: otherUser.id,
      });

      await expect(
        conversations.findOne({
          organizationId: org.orgId,
          userId: org.userId,
          conversationId: theirs.id,
        }),
      ).rejects.toThrow();

      await prisma.conversation.deleteMany({ where: { userId: otherUser.id } });
      await prisma.user.delete({ where: { id: otherUser.id } });
    });
  });

  describe('pipeline de respuesta (§7.2)', () => {
    it('persiste pregunta y respuesta, con citas trazables al fragmento exacto', async () => {
      retrievedChunks = [
        chunk('c1', 'Los empleados disponen de 23 días laborables.'),
      ];

      const conversation = await conversations.create({
        organizationId: org.orgId,
        userId: org.userId,
      });

      const result = await sendMessage.execute({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: conversation.id,
        content: '¿Cuántos días de vacaciones tengo?',
      });

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].chunkId).toBe('c1');
      expect(result.citations[0].label).toContain('Política de Vacaciones');

      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(messages.map((m) => m.role)).toEqual([
        MessageRole.USER,
        MessageRole.ASSISTANT,
      ]);
      // Trazabilidad de "por qué la IA dijo esto": la cita queda persistida.
      expect(messages[1].citations).toBeTruthy();
    });

    it('pide COMPRENSIÓN al Understanding Engine, no solo fragmentos', async () => {
      const item = await createKnowledgeItem(org);
      await createInsight(org, {
        subjectIdentity: 'retrasos-proveedor',
        evidenceItemIds: [item.id],
      });
      retrievedChunks = [chunk('c1', 'Contenido relevante')];
      retrievedInsights = [
        {
          id: 'i1',
          summary: 'Hay retrasos recurrentes con el mismo proveedor',
          confidence: 0.82,
          freshness: 'FRESH',
        },
      ];

      const conversation = await conversations.create({
        organizationId: org.orgId,
        userId: org.userId,
      });
      const result = await sendMessage.execute({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: conversation.id,
        content: '¿Qué problemas tenemos?',
      });

      expect(result.insightsUsed).toHaveLength(1);
      // La comprensión llega al prompt, no solo el conocimiento recuperado.
      const systemPrompt = complete.mock.calls[0][0].systemPrompt;
      expect(systemPrompt).toContain('retrasos recurrentes');
      expect(systemPrompt).toContain('comprendido');
    });

    it('sin conocimiento ni comprensión NO inventa: declara que no lo sabe', async () => {
      const conversation = await conversations.create({
        organizationId: org.orgId,
        userId: org.userId,
      });

      const result = await sendMessage.execute({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: conversation.id,
        content: '¿Cuál es la política de teletrabajo?',
      });

      expect(complete).not.toHaveBeenCalled();
      expect(result.content).toMatch(/no tengo conocimiento/i);
      expect(result.citations).toEqual([]);
    });

    it('un fallo del proveedor no pierde el mensaje del usuario', async () => {
      retrievedChunks = [chunk('c1', 'algo')];
      complete.mockRejectedValue(new Error('503 Service Unavailable'));

      const conversation = await conversations.create({
        organizationId: org.orgId,
        userId: org.userId,
      });
      const result = await sendMessage.execute({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: conversation.id,
        content: 'pregunta',
      });

      expect(result.content).toMatch(/no he podido generar/i);
      const messages = await prisma.message.findMany({
        where: { conversationId: conversation.id },
      });
      // La pregunta sigue persistida: no se pierde por un fallo del proveedor.
      expect(messages.some((m) => m.content === 'pregunta')).toBe(true);
    });

    it('incluye el historial previo en el prompt', async () => {
      retrievedChunks = [chunk('c1', 'contenido')];
      const conversation = await conversations.create({
        organizationId: org.orgId,
        userId: org.userId,
      });

      await sendMessage.execute({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: conversation.id,
        content: 'primera pregunta',
      });
      await sendMessage.execute({
        organizationId: org.orgId,
        userId: org.userId,
        conversationId: conversation.id,
        content: 'segunda pregunta',
      });

      const secondCall = complete.mock.calls[1][0];
      expect(
        secondCall.messages.some((m) => m.content === 'primera pregunta'),
      ).toBe(true);
    });

    it('no permite enviar a una conversación de otro usuario', async () => {
      const other = await createTestOrg('conv-int-c');
      const theirs = await conversations.create({
        organizationId: other.orgId,
        userId: other.userId,
      });

      await expect(
        sendMessage.execute({
          organizationId: org.orgId,
          userId: org.userId,
          conversationId: theirs.id,
          content: 'intruso',
        }),
      ).rejects.toThrow();

      await destroyTestOrg(other);
    });
  });
});
