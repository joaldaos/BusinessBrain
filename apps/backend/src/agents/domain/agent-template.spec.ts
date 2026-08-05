import { AgentTemplateVisibility } from '@businessbrain/database';
import {
  evaluateTemplateUsage,
  templateDefaultsToConfiguration,
} from './agent-template';
import { InvalidAgentConfigurationError } from './agent-configuration';

/**
 * Subfase 5.7 — reglas de uso de plantillas.
 *
 * Instalar una plantilla concede capacidades y herramientas a un agente nuevo. Lo que se
 * prueba aquí es que esa concesión no puede cruzar la frontera de la organización, y que el
 * `Json` de la plantilla no entra al agente sin volver a validarse.
 */
describe('evaluateTemplateUsage', () => {
  const ORG = 'org-propia';
  const OTHER = 'org-ajena';

  const evaluate = (
    publisherOrgId: string | null,
    visibility: AgentTemplateVisibility,
    requestingOrganizationId = ORG,
  ) =>
    evaluateTemplateUsage({
      publisherOrgId,
      visibility,
      requestingOrganizationId,
    });

  describe('dentro de la propia organización', () => {
    it.each([
      AgentTemplateVisibility.PRIVATE,
      AgentTemplateVisibility.ORGANIZATION,
      AgentTemplateVisibility.PUBLIC,
    ])('permite una plantilla %s de la propia organización', (visibility) => {
      expect(evaluate(ORG, visibility)).toEqual({ allowed: true, visibility });
    });
  });

  describe('frontera entre organizaciones', () => {
    it.each([
      AgentTemplateVisibility.PRIVATE,
      AgentTemplateVisibility.ORGANIZATION,
    ])('DENIEGA una plantilla %s de otra organización', (visibility) => {
      const decision = evaluate(OTHER, visibility);

      expect(decision.allowed).toBe(false);
      expect(decision.allowed === false && decision.reason).toBe(
        'CROSS_ORG_TEMPLATE',
      );
    });

    it('DENIEGA una plantilla PUBLIC de otra organización: cross-org no existe en Fase 5', () => {
      // `PUBLIC` es groundwork del modelo, no un permiso efectivo. Si aquí se permitiera,
      // una organización aceptaría un system prompt y una lista de herramientas escritos
      // por alguien de fuera del tenant, sin moderación ni revisión de contenido.
      const decision = evaluate(OTHER, AgentTemplateVisibility.PUBLIC);

      expect(decision.allowed === false && decision.reason).toBe(
        'CROSS_ORG_TEMPLATE',
      );
    });

    it('DENIEGA una plantilla de plataforma: distribuirla es marketplace', () => {
      const decision = evaluate(null, AgentTemplateVisibility.PUBLIC);

      expect(decision.allowed === false && decision.reason).toBe(
        'PLATFORM_TEMPLATE_NOT_DISTRIBUTED',
      );
    });

    it('la denegación explica el motivo, no solo que se denegó', () => {
      const decision = evaluate(OTHER, AgentTemplateVisibility.ORGANIZATION);

      expect(decision.allowed === false && decision.explanation).toMatch(
        /otra organización/i,
      );
    });
  });
});

describe('templateDefaultsToConfiguration', () => {
  it('normaliza los defaults de la plantilla con las invariantes de 5.1', () => {
    const configuration = templateDefaultsToConfiguration({
      defaultCapabilities: ['answer_questions', 'summarize'],
      defaultTools: [{ tool: 'knowledge_search', permission: 'READ_ONLY' }],
    });

    expect(configuration.capabilities).toEqual([
      'answer_questions',
      'summarize',
    ]);
    expect(configuration.tools).toEqual([
      { tool: 'knowledge_search', permission: 'READ_ONLY' },
    ]);
  });

  it('lo que la plantilla no declara NO se hereda: sin memoria y sin herramientas', () => {
    const configuration = templateDefaultsToConfiguration({
      defaultCapabilities: [],
      defaultTools: [],
    });

    expect(configuration.tools).toEqual([]);
    expect(configuration.memoryConfig).toEqual({
      strategy: 'none',
      windowSize: 10,
    });
  });

  it('RECHAZA una herramienta inexistente declarada por la plantilla', () => {
    expect(() =>
      templateDefaultsToConfiguration({
        defaultCapabilities: [],
        defaultTools: [{ tool: 'borrar_todo', permission: 'AUTONOMOUS' }],
      }),
    ).toThrow(InvalidAgentConfigurationError);
  });

  it('RECHAZA que la plantilla declare READ_ONLY una herramienta con efectos', () => {
    // Es la mentira que el gate de políticas usaría para dejar pasar la llamada.
    expect(() =>
      templateDefaultsToConfiguration({
        defaultCapabilities: [],
        defaultTools: [{ tool: 'send_email', permission: 'READ_ONLY' }],
      }),
    ).toThrow(/send_email/);
  });

  it('acepta `sql_query` como capacidad declarable READ_ONLY', () => {
    // Decisión de la Fase 5: `sql_query` se declara y se conserva, pero no tiene adaptador
    // ejecutable, así que el registro cerrado de herramientas la deja sin ejecutar.
    const configuration = templateDefaultsToConfiguration({
      defaultCapabilities: [],
      defaultTools: [{ tool: 'sql_query', permission: 'READ_ONLY' }],
    });

    expect(configuration.tools).toEqual([
      { tool: 'sql_query', permission: 'READ_ONLY' },
    ]);
  });
});
