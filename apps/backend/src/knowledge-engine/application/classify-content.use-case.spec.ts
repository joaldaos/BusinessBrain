import { AgentArea } from '@businessbrain/database';
import { ClassifyContentUseCase } from './classify-content.use-case';
import type { ProviderRegistry } from '../../llm/application/provider-registry.service';
import type { TaxonomyService } from './taxonomy.service';

/**
 * Clasificación automática — KNOWLEDGE_ENGINE_DESIGN.md §9.
 *
 * El foco de estos tests es que el sistema NUNCA acepte una clasificación que no resuelva
 * contra la taxonomía real de la organización: un modelo puede devolver una clave con
 * aspecto plausible pero inexistente, y aceptarla degradaría el alcance por área de los
 * agentes con una etiqueta inventada.
 */
describe('ClassifyContentUseCase (§9)', () => {
  const nodes = [
    { id: 'n-hr', key: 'hr', label: 'RR. HH.', businessArea: AgentArea.HR },
    {
      id: 'n-vac',
      key: 'hr.policies.vacation',
      label: 'Vacaciones',
      businessArea: AgentArea.HR,
    },
  ];

  let taxonomy: { ensureSeeded: jest.Mock; listNodes: jest.Mock };
  let complete: jest.Mock;
  let registry: { resolveForOrganization: jest.Mock };
  let useCase: ClassifyContentUseCase;

  beforeEach(() => {
    taxonomy = {
      ensureSeeded: jest.fn().mockResolvedValue(undefined),
      listNodes: jest.fn().mockResolvedValue(nodes),
    };
    complete = jest.fn();
    registry = {
      resolveForOrganization: jest.fn().mockResolvedValue({
        profile: { modelName: 'model-x', apiKeyEnc: null },
        provider: { complete },
      }),
    };
    useCase = new ClassifyContentUseCase(
      registry as unknown as ProviderRegistry,
      taxonomy as unknown as TaxonomyService,
    );
  });

  const params = {
    organizationId: 'org-1',
    title: 'Política de vacaciones',
    contentText: 'Los empleados disponen de 23 días laborables.',
  };

  it('asigna el nodo más específico y deriva su área de negocio', async () => {
    complete.mockResolvedValue({
      content:
        '{"key":"hr.policies.vacation","tags":["rrhh"],"certainty":0.92}',
      model: 'model-x',
    });

    const result = await useCase.execute(params);

    expect(result.taxonomyNodeId).toBe('n-vac');
    expect(result.taxonomyKey).toBe('hr.policies.vacation');
    expect(result.businessArea).toBe(AgentArea.HR);
    expect(result.certainty).toBeCloseTo(0.92);
  });

  it('siembra la taxonomía antes de clasificar', async () => {
    complete.mockResolvedValue({
      content: '{"key":"hr","tags":[],"certainty":0.5}',
    });

    await useCase.execute(params);

    expect(taxonomy.ensureSeeded).toHaveBeenCalledWith('org-1');
  });

  it('descarta una clave inexistente en la taxonomía, aunque el modelo la reporte con certeza alta', async () => {
    complete.mockResolvedValue({
      content: '{"key":"legal.contracts.nda","tags":[],"certainty":0.99}',
    });

    const result = await useCase.execute(params);

    expect(result.taxonomyNodeId).toBeNull();
    expect(result.businessArea).toBeNull();
    // La certeza no puede sostenerse si la clasificación no resolvió.
    expect(result.certainty).toBe(0);
  });

  it('tolera que el modelo envuelva el JSON en prosa o en un bloque de código', async () => {
    complete.mockResolvedValue({
      content:
        'Claro:\n```json\n{"key":"hr","tags":["a"],"certainty":0.7}\n```',
    });

    const result = await useCase.execute(params);

    expect(result.taxonomyKey).toBe('hr');
    expect(result.certainty).toBeCloseTo(0.7);
  });

  it('no rompe la ingesta si el proveedor falla: devuelve sin clasificar', async () => {
    complete.mockRejectedValue(new Error('502 Bad Gateway'));

    const result = await useCase.execute(params);

    expect(result.taxonomyNodeId).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.certainty).toBe(0);
  });

  it('no rompe ante una respuesta que no es JSON', async () => {
    complete.mockResolvedValue({ content: 'No sé clasificar esto.' });

    const result = await useCase.execute(params);

    expect(result.taxonomyNodeId).toBeNull();
    expect(result.certainty).toBe(0);
  });

  it('normaliza y acota las etiquetas libres', async () => {
    complete.mockResolvedValue({
      content: JSON.stringify({
        key: 'hr',
        tags: ['  RRHH  ', 'Vacaciones', '', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
        certainty: 0.8,
      }),
    });

    const result = await useCase.execute(params);

    expect(result.tags).toHaveLength(8);
    expect(result.tags[0]).toBe('rrhh');
    expect(result.tags).not.toContain('');
  });

  it('acota la certeza al rango [0,1] aunque el modelo devuelva un valor fuera de rango', async () => {
    complete.mockResolvedValue({
      content: '{"key":"hr","tags":[],"certainty":4.5}',
    });

    const result = await useCase.execute(params);

    expect(result.certainty).toBe(1);
  });

  it('ofrece al clasificador la taxonomía real de la organización como vocabulario cerrado', async () => {
    complete.mockResolvedValue({
      content: '{"key":"hr","tags":[],"certainty":0.6}',
    });

    await useCase.execute(params);

    const systemPrompt = complete.mock.calls[0][0].systemPrompt as string;
    expect(systemPrompt).toContain('hr.policies.vacation');
    expect(systemPrompt).toContain('Vacaciones');
  });
});
