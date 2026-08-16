/**
 * Plantilla de un informe — BUSINESSBRAIN_MIGRATION_PLAN.md §5, §10 (fase 6).
 *
 * ## Por qué el catálogo de secciones es CERRADO
 *
 * El esquema guarda `template` como `Json`: "definición de secciones/queries del informe".
 * Aceptar consultas con forma libre sería reintroducir por la puerta de atrás justo lo que el
 * proyecto prohíbe desde la subfase 5.7 — SQL libre, o cualquier equivalente que permita
 * pedirle a la base de datos algo que ningún punto de lectura ha filtrado por alcance.
 *
 * Una sección **declara qué quiere ver**, y cada tipo se resuelve exclusivamente a través de
 * los dos puntos de lectura del sistema: `RetrieveInsights` para la comprensión (§12) y
 * `RetrieveContext` para el conocimiento (§13). Ambos aplican el alcance de 6.3, la frescura
 * y la curación heredada por su cuenta. Un informe no puede ver más que su lector porque
 * literalmente lee por donde lee él.
 *
 * Dominio puro: sin base de datos, sin red, determinista.
 */

import { InsightType } from '@businessbrain/database';

export const REPORT_SECTION_TYPES = [
  /** Comprensión viva: `Insight` con su confianza, frescura y curación (§12). */
  'INSIGHTS',
  /** Fragmentos de conocimiento recuperados para una pregunta declarada (§13). */
  'KNOWLEDGE_SEARCH',
] as const;

export type ReportSectionType = (typeof REPORT_SECTION_TYPES)[number];

export type ReportSection =
  | {
      type: 'INSIGHTS';
      title: string;
      /** Acota a unos tipos concretos. Vacío o ausente = todos. */
      insightTypes?: InsightType[];
      /** Endurece el piso de confianza; nunca puede relajarlo (§9). */
      minimumConfidence?: number;
      limit: number;
    }
  | {
      type: 'KNOWLEDGE_SEARCH';
      title: string;
      /** Pregunta declarada en la plantilla. Es texto para el Retriever, nunca una consulta. */
      query: string;
      minimumConfidence?: number;
      limit: number;
    };

export interface ReportTemplate {
  sections: ReportSection[];
}

export const MAX_SECTIONS_PER_REPORT = 12;
export const MAX_ITEMS_PER_SECTION = 50;
export const DEFAULT_ITEMS_PER_SECTION = 10;
export const MAX_QUERY_LENGTH = 500;
export const MAX_TITLE_LENGTH = 120;

export class InvalidReportTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReportTemplateError';
  }
}

const SECTION_TYPES = new Set<string>(REPORT_SECTION_TYPES);
const INSIGHT_TYPES = new Set<string>(Object.values(InsightType));

/**
 * Valida y normaliza una plantilla.
 *
 * Fail-closed: un tipo de sección desconocido se rechaza, no se ignora. Ignorarlo produciría
 * un informe con menos secciones de las que su plantilla declara, y quien lo reciba no tendría
 * forma de saber que falta algo — un informe incompleto presentado como completo es peor que
 * uno que no se genera.
 */
export function parseReportTemplate(raw: unknown): ReportTemplate {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidReportTemplateError(
      'Un informe debe declarar su plantilla',
    );
  }

  const sections = (raw as { sections?: unknown }).sections;
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new InvalidReportTemplateError(
      'Un informe debe declarar al menos una sección',
    );
  }
  if (sections.length > MAX_SECTIONS_PER_REPORT) {
    throw new InvalidReportTemplateError(
      `Un informe no puede declarar más de ${MAX_SECTIONS_PER_REPORT} secciones`,
    );
  }

  return {
    sections: sections.map((entry, index) => parseSection(entry, index)),
  };
}

function parseSection(raw: unknown, index: number): ReportSection {
  const position = `La sección ${index + 1}`;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new InvalidReportTemplateError(
      `${position} no es una sección válida`,
    );
  }

  const section = raw as Record<string, unknown>;
  const type = section.type;

  if (typeof type !== 'string' || !SECTION_TYPES.has(type)) {
    throw new InvalidReportTemplateError(
      `${position} declara un tipo desconocido. Un informe solo lee por los puntos de ` +
        `lectura del sistema: ${REPORT_SECTION_TYPES.join(', ')}`,
    );
  }

  const title = requireText(
    section.title,
    `${position}: title`,
    MAX_TITLE_LENGTH,
  );
  const limit = parseLimit(section.limit, position);
  const minimumConfidence = parseConfidence(
    section.minimumConfidence,
    position,
  );

  if (type === 'KNOWLEDGE_SEARCH') {
    return {
      type,
      title,
      query: requireText(section.query, `${position}: query`, MAX_QUERY_LENGTH),
      limit,
      ...(minimumConfidence !== undefined ? { minimumConfidence } : {}),
    };
  }

  return {
    type: 'INSIGHTS',
    title,
    limit,
    ...(minimumConfidence !== undefined ? { minimumConfidence } : {}),
    ...(section.insightTypes !== undefined
      ? { insightTypes: parseInsightTypes(section.insightTypes, position) }
      : {}),
  };
}

function requireText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new InvalidReportTemplateError(`${label} es obligatorio`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new InvalidReportTemplateError(
      `${label} supera ${maxLength} caracteres`,
    );
  }
  return text;
}

/** Sin cota, una sección podría arrastrar la organización entera a un PDF. */
function parseLimit(value: unknown, position: string): number {
  if (value === undefined || value === null) return DEFAULT_ITEMS_PER_SECTION;

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_ITEMS_PER_SECTION
  ) {
    throw new InvalidReportTemplateError(
      `${position}: limit debe ser un entero entre 1 y ${MAX_ITEMS_PER_SECTION}`,
    );
  }
  return value;
}

function parseConfidence(value: unknown, position: string): number | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== 'number' || value < 0 || value > 1) {
    throw new InvalidReportTemplateError(
      `${position}: minimumConfidence debe estar entre 0 y 1`,
    );
  }
  return value;
}

function parseInsightTypes(value: unknown, position: string): InsightType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidReportTemplateError(
      `${position}: insightTypes debe ser una lista de tipos`,
    );
  }

  return value.map((entry) => {
    if (typeof entry !== 'string' || !INSIGHT_TYPES.has(entry)) {
      throw new InvalidReportTemplateError(
        `${position}: "${String(entry)}" no es un tipo de Insight`,
      );
    }
    return entry as InsightType;
  });
}
