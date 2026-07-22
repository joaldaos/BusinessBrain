/**
 * Umbral de similitud estructural (KNOWLEDGE_ENGINE_DESIGN.md §7, nivel 2) por defecto de
 * plataforma. Nunca se usa como constante fija de código en la decisión de deduplicación — es
 * solo el valor de respaldo cuando la organización no ha configurado el suyo (hallazgo #10 de la
 * auditoría previa a la congelación: "todos estos umbrales son configuración por organización,
 * nunca constantes de código").
 */
export const DEFAULT_STRUCTURAL_SIMILARITY_THRESHOLD = 0.7;

interface KnowledgeEngineDeduplicationSettings {
  structuralSimilarityThreshold?: number;
}

interface OrganizationSettingsShape {
  knowledgeEngine?: {
    deduplication?: KnowledgeEngineDeduplicationSettings;
  };
}

/**
 * Lee el umbral de similitud estructural configurado por la organización en `Organization.settings`
 * (campo JSON genérico ya existente, ver §6 de BUSINESSBRAIN_MIGRATION_PLAN.md) — se reutiliza en
 * vez de crear una tabla de configuración dedicada, dado que hoy es un único valor numérico.
 */
export function getStructuralSimilarityThreshold(
  organizationSettings: unknown,
): number {
  const settings = organizationSettings as
    OrganizationSettingsShape | null | undefined;
  const configured =
    settings?.knowledgeEngine?.deduplication?.structuralSimilarityThreshold;
  if (typeof configured === 'number' && configured > 0 && configured <= 1) {
    return configured;
  }
  return DEFAULT_STRUCTURAL_SIMILARITY_THRESHOLD;
}
