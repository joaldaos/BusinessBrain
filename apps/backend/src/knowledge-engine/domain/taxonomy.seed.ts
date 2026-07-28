import { AgentArea } from '@businessbrain/database';

/**
 * Taxonomía de fábrica — KNOWLEDGE_ENGINE_DESIGN.md §9, "Categorías y taxonomía".
 *
 * Raíz común que toda organización recibe al sembrarse su taxonomía. Una organización
 * puede EXTENDERLA con subcategorías propias, pero no reemplazarla ni borrarla: mantener
 * una raíz compartida es lo que permite comparar y agrupar conocimiento a nivel de
 * producto (analítica interna, plantillas de agentes) sin depender de que cada tenant
 * nombre las cosas igual.
 *
 * Las claves son estables y jerárquicas (`hr.policies`), y las áreas se alinean 1:1 con
 * `AgentArea` para que el alcance de un agente por área siga funcionando sin traducción.
 */
export interface TaxonomySeedNode {
  key: string;
  label: string;
  businessArea: AgentArea;
  /** Clave del padre; ausente en los nodos raíz. */
  parentKey?: string;
}

export const FACTORY_TAXONOMY: readonly TaxonomySeedNode[] = [
  // Raíces por área de negocio
  { key: 'sales', label: 'Ventas', businessArea: AgentArea.SALES },
  { key: 'marketing', label: 'Marketing', businessArea: AgentArea.MARKETING },
  { key: 'support', label: 'Soporte', businessArea: AgentArea.SUPPORT },
  {
    key: 'operations',
    label: 'Operaciones',
    businessArea: AgentArea.OPERATIONS,
  },
  { key: 'finance', label: 'Finanzas', businessArea: AgentArea.FINANCE },
  { key: 'hr', label: 'Recursos Humanos', businessArea: AgentArea.HR },
  { key: 'general', label: 'General', businessArea: AgentArea.GENERAL },

  // Subcategorías de fábrica: profundidad mínima útil para que la clasificación pueda
  // asignar "el nodo más específico posible" (§9) desde el primer día, sin pretender
  // cubrir el dominio de ninguna empresa concreta — eso es trabajo de cada organización.
  {
    key: 'sales.proposals',
    label: 'Propuestas',
    businessArea: AgentArea.SALES,
    parentKey: 'sales',
  },
  {
    key: 'sales.contracts',
    label: 'Contratos',
    businessArea: AgentArea.SALES,
    parentKey: 'sales',
  },
  {
    key: 'sales.crm',
    label: 'Registros de CRM',
    businessArea: AgentArea.SALES,
    parentKey: 'sales',
  },

  {
    key: 'marketing.campaigns',
    label: 'Campañas',
    businessArea: AgentArea.MARKETING,
    parentKey: 'marketing',
  },
  {
    key: 'marketing.content',
    label: 'Contenidos',
    businessArea: AgentArea.MARKETING,
    parentKey: 'marketing',
  },

  {
    key: 'support.tickets',
    label: 'Tickets',
    businessArea: AgentArea.SUPPORT,
    parentKey: 'support',
  },
  {
    key: 'support.faq',
    label: 'Preguntas frecuentes',
    businessArea: AgentArea.SUPPORT,
    parentKey: 'support',
  },

  {
    key: 'operations.processes',
    label: 'Procesos',
    businessArea: AgentArea.OPERATIONS,
    parentKey: 'operations',
  },
  {
    key: 'operations.suppliers',
    label: 'Proveedores',
    businessArea: AgentArea.OPERATIONS,
    parentKey: 'operations',
  },

  {
    key: 'finance.invoicing',
    label: 'Facturación',
    businessArea: AgentArea.FINANCE,
    parentKey: 'finance',
  },
  {
    key: 'finance.reporting',
    label: 'Informes financieros',
    businessArea: AgentArea.FINANCE,
    parentKey: 'finance',
  },

  {
    key: 'hr.policies',
    label: 'Políticas',
    businessArea: AgentArea.HR,
    parentKey: 'hr',
  },
  {
    key: 'hr.recruiting',
    label: 'Selección',
    businessArea: AgentArea.HR,
    parentKey: 'hr',
  },
  {
    key: 'hr.policies.vacation',
    label: 'Vacaciones',
    businessArea: AgentArea.HR,
    parentKey: 'hr.policies',
  },
] as const;

/**
 * Ancestros de una clave, del más cercano al más lejano. La pertenencia a un nodo implica
 * pertenencia implícita a todos sus ancestros (§9, "Relaciones y jerarquías"): un ítem
 * clasificado en `hr.policies.vacation` es recuperable por un agente con alcance sobre `hr`.
 */
export function ancestorKeysOf(key: string): string[] {
  const parts = key.split('.');
  const ancestors: string[] = [];
  for (let i = parts.length - 1; i > 0; i--) {
    ancestors.push(parts.slice(0, i).join('.'));
  }
  return ancestors;
}
