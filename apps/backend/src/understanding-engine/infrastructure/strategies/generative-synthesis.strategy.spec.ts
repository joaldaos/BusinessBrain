import { InsightType } from '@businessbrain/database';
import { GenerativeSynthesisStrategy } from './generative-synthesis.strategy';
import type { ProviderRegistry } from '../../../llm/application/provider-registry.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  KnowledgeRetrievalPort,
  RetrievedKnowledge,
} from '../../domain/ports/knowledge-retrieval.port';

/**
 * Criterio de aceptación de la subfase 3.3 (UNDERSTANDING_ENGINE_DESIGN.md §17):
 * "todo Insight generado por esta estrategia incluye razonamiento estructurado, no solo
 * una conclusión".
 *
 * El foco es que NADA de lo que un modelo alucine llegue a persistirse: ni un tipo
 * inventado, ni una cita a un fragmento inexistente, ni una conclusión sin razonamiento.
 */
describe('GenerativeSynthesisStrategy (§6, generativa)', () => {
  const chunk = (id: string): RetrievedKnowledge => ({
    chunkId: id,
    content: `Contenido del fragmento ${id}`,
    knowledgeItemId: `item-${id}`,
    title: 'Documento',
    chunkIndex: 0,
    heading: null,
    headingPath: [],
    confidenceScore: 0.8,
  });

  const available = [chunk('c1'), chunk('c2'), chunk('c3'), chunk('c4')];

  let complete: jest.Mock;
  let retrieval: KnowledgeRetrievalPort;
  let strategy: GenerativeSynthesisStrategy;

  const buildStrategy = (chunks: RetrievedKnowledge[] = available) => {
    retrieval = { retrieve: jest.fn().mockResolvedValue(chunks) };
    const registry = {
      resolveForOrganization: jest.fn().mockResolvedValue({
        profile: { modelName: 'model-x', apiKeyEnc: null },
        provider: { complete },
      }),
    };
    return new GenerativeSynthesisStrategy(
      {} as PrismaService,
      registry as unknown as ProviderRegistry,
      retrieval,
    );
  };

  const run = () => strategy.generate({ organizationId: 'org-1', signals: [] });

  const finding = (overrides: Record<string, unknown> = {}) => ({
    subject: 'retrasos-entrega-proveedor',
    type: 'PATTERN',
    summary: 'Varios documentos mencionan retrasos del mismo proveedor',
    reasoning:
      'Tres documentos de meses distintos citan el mismo incumplimiento.',
    chunkIds: ['c1', 'c2'],
    confidence: 0.7,
    ...overrides,
  });

  beforeEach(() => {
    complete = jest.fn();
    strategy = buildStrategy();
  });

  it('declara fiabilidad base MENOR que una estrategia simbólica (§9)', () => {
    // Un modelo interpreta, no verifica: esa diferencia debe viajar a la confianza.
    expect(strategy.kind).toBe('GENERATIVE');
    expect(strategy.baseReliability).toBeLessThan(0.9);
  });

  it('consume el Retriever, nunca el Context Builder (§13)', async () => {
    complete.mockResolvedValue({ content: '[]' });
    await run();

    expect(retrieval.retrieve).toHaveBeenCalled();
    expect(
      (retrieval.retrieve as jest.Mock).mock.calls[0][0].organizationId,
    ).toBe('org-1');
  });

  describe('traza de razonamiento obligatoria (§10)', () => {
    it('incluye el razonamiento del modelo y las referencias verificables al contexto', async () => {
      complete.mockResolvedValue({ content: JSON.stringify([finding()]) });

      const [candidate] = await run();

      expect(candidate.reasoningTrace.strategyKind).toBe('GENERATIVE');
      expect(candidate.reasoningTrace.modelReasoning).toBe(
        'Tres documentos de meses distintos citan el mismo incumplimiento.',
      );
      expect(candidate.reasoningTrace.citedChunkIds).toEqual(['c1', 'c2']);
    });

    it('DESCARTA un hallazgo sin razonamiento: no sería auditable', async () => {
      complete.mockResolvedValue({
        content: JSON.stringify([finding({ reasoning: '' })]),
      });

      expect(await run()).toEqual([]);
    });

    it('descarta un hallazgo cuyo razonamiento no es texto', async () => {
      complete.mockResolvedValue({
        content: JSON.stringify([finding({ reasoning: 42 })]),
      });

      expect(await run()).toEqual([]);
    });
  });

  describe('protección frente a alucinaciones', () => {
    it('descarta un hallazgo que cita fragmentos inexistentes', async () => {
      complete.mockResolvedValue({
        content: JSON.stringify([finding({ chunkIds: ['inventado-1'] })]),
      });

      expect(await run()).toEqual([]);
    });

    it('conserva solo las citas reales cuando el modelo mezcla válidas e inventadas', async () => {
      complete.mockResolvedValue({
        content: JSON.stringify([finding({ chunkIds: ['c1', 'no-existe'] })]),
      });

      const [candidate] = await run();
      expect(candidate.evidence.map((e) => e.refId)).toEqual(['c1']);
    });

    it('descarta un tipo que no existe en el enum', async () => {
      complete.mockResolvedValue({
        content: JSON.stringify([finding({ type: 'CATASTROFE' })]),
      });

      expect(await run()).toEqual([]);
    });

    it('acota la confianza al rango [0,1]', async () => {
      complete.mockResolvedValue({
        content: JSON.stringify([finding({ confidence: 7 })]),
      });

      const [candidate] = await run();
      expect(candidate.rawConfidence).toBe(1);
    });
  });

  describe('interacción con el gate de riesgo/oportunidad (§8, §13)', () => {
    it('un RISK con degradación declarada la propaga al candidato', async () => {
      complete.mockResolvedValue({
        content: JSON.stringify([
          finding({ type: 'RISK', degradesTo: 'ANOMALY' }),
        ]),
      });

      const [candidate] = await run();
      expect(candidate.type).toBe(InsightType.RISK);
      expect(candidate.degradesTo).toBe(InsightType.ANOMALY);
    });

    it('un RISK SIN degradación declarada se reclasifica como ANOMALY, no se descarta', async () => {
      // La observación es válida; lo que no puede sostenerse es el juicio de valor.
      complete.mockResolvedValue({
        content: JSON.stringify([finding({ type: 'RISK' })]),
      });

      const [candidate] = await run();
      expect(candidate.type).toBe(InsightType.ANOMALY);
    });

    it('un PATTERN no necesita declarar degradación', async () => {
      complete.mockResolvedValue({ content: JSON.stringify([finding()]) });

      const [candidate] = await run();
      expect(candidate.degradesTo).toBeUndefined();
    });
  });

  describe('robustez', () => {
    it('no razona sobre material insuficiente', async () => {
      strategy = buildStrategy([chunk('c1')]);
      expect(await run()).toEqual([]);
      expect(complete).not.toHaveBeenCalled();
    });

    it('un fallo del proveedor no tumba la ejecución: devuelve sin candidatos', async () => {
      complete.mockRejectedValue(new Error('429 Too Many Requests'));
      expect(await run()).toEqual([]);
    });

    it('tolera una respuesta que no es JSON', async () => {
      complete.mockResolvedValue({
        content: 'No he encontrado nada relevante.',
      });
      expect(await run()).toEqual([]);
    });

    it('la identidad de sujeto describe el ASUNTO, no el documento ni el momento (§3.4)', async () => {
      complete.mockResolvedValue({ content: JSON.stringify([finding()]) });

      const [candidate] = await run();
      expect(candidate.subjectIdentity).toBe(
        'generative-synthesis:retrasos-entrega-proveedor',
      );
      expect(candidate.subjectIdentity).not.toContain('c1');
    });
  });
});
