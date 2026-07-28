import { KnowledgeSourceType } from '@businessbrain/database';

/**
 * Cálculo inicial del confidence score — KNOWLEDGE_ENGINE_DESIGN.md §3.9, §8.1.
 *
 * El score NACE aquí. Su evolución (decaimiento temporal, recálculo por corroboración,
 * contradicción o curación humana) es la subfase 2.4 y no se implementa todavía.
 *
 * Función pura y determinista: mismo input, mismo output. Devuelve el score junto con los
 * factores que lo componen, porque la confianza debe ser EXPLICABLE y auditable, no un
 * número opaco (§8.4).
 *
 * Todos los pesos y valores base son configuración con valor por defecto de plataforma,
 * nunca constantes semánticas ocultas (§8.3, hallazgo #10 de la auditoría).
 */

/** Confianza base por tipo de conector (§8.1, "Confianza de la fuente"). */
export const DEFAULT_SOURCE_TRUST: Readonly<
  Record<KnowledgeSourceType, number>
> = {
  // Carga manual: alguien de la organización subió el documento a propósito.
  FILE_UPLOAD: 0.8,
  // Sistemas de registro: dato estructurado y gobernado.
  CRM: 0.75,
  ERP: 0.8,
  DATABASE: 0.8,
  // Captura automática de flujos de trabajo: alta cobertura, menor curación.
  GOOGLE_DRIVE: 0.7,
  GMAIL: 0.5,
  API: 0.7,
  // Contenido externo o público: el menos gobernado.
  WEBSITE: 0.5,
  SOCIAL_MEDIA: 0.4,
};

export interface ConfidenceWeights {
  sourceTrust: number;
  classificationCertainty: number;
  contentCompleteness: number;
  authoritySignal: number;
}

/** Pesos por defecto de plataforma. Suman 1: el score resultante queda en [0,1]. */
export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  sourceTrust: 0.4,
  classificationCertainty: 0.2,
  contentCompleteness: 0.25,
  authoritySignal: 0.15,
};

/** Marcadores de autoridad explícita en el documento o su origen (§8.1). */
export const AUTHORITY_MARKERS: Readonly<Record<string, number>> = {
  firmado: 1,
  signed: 1,
  aprobado: 0.95,
  approved: 0.95,
  oficial: 0.9,
  official: 0.9,
  vigente: 0.85,
  borrador: 0.3,
  draft: 0.3,
  obsoleto: 0.15,
  deprecated: 0.15,
};

/** Longitud a partir de la cual se considera que el contenido se extrajo completo. */
export const COMPLETENESS_REFERENCE_LENGTH = 500;

export interface ConfidenceInput {
  sourceType: KnowledgeSourceType | null;
  /** Certeza reportada por la clasificación (§9). `null` si no se pudo clasificar. */
  classificationCertainty: number | null;
  contentText: string;
  /** Título y metadatos donde buscar señales de autoridad explícita. */
  title: string;
}

export interface ConfidenceFactor {
  name: keyof ConfidenceWeights;
  value: number;
  weight: number;
  /** Por qué ese valor — es lo que hace el score explicable ante un humano. */
  rationale: string;
}

export interface ConfidenceResult {
  score: number;
  factors: ConfidenceFactor[];
}

/**
 * Completitud del contenido (§8.1). Penaliza contenido truncado o mal extraído: un PDF
 * escaneado sin buen OCR produce texto muy corto o con una proporción anómala de
 * caracteres no alfanuméricos.
 */
function completenessOf(contentText: string): {
  value: number;
  rationale: string;
} {
  const length = contentText.trim().length;
  if (length === 0) {
    return { value: 0, rationale: 'Contenido vacío tras la normalización' };
  }

  const lengthScore = Math.min(1, length / COMPLETENESS_REFERENCE_LENGTH);
  const alphanumeric = (contentText.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const ratio = alphanumeric / length;

  // Una proporción baja de caracteres con significado sugiere extracción defectuosa.
  const ratioScore = Math.min(1, ratio / 0.6);
  const value = Number((lengthScore * 0.5 + ratioScore * 0.5).toFixed(4));

  return {
    value,
    rationale: `${length} caracteres, ${(ratio * 100).toFixed(0)}% alfanuméricos`,
  };
}

function authorityOf(
  title: string,
  contentText: string,
): { value: number; rationale: string } {
  // Se busca en el título y en el arranque del contenido, donde vive la portada de un
  // documento oficial. No se recorre el texto completo: una mención incidental de
  // "borrador" en la página 40 no describe el estatus del documento.
  const haystack = `${title}\n${contentText.slice(0, 400)}`.toLowerCase();

  let matched: string | null = null;
  let value = 0.6; // neutro: ausencia de señal no es señal negativa

  for (const [marker, markerValue] of Object.entries(AUTHORITY_MARKERS)) {
    if (new RegExp(`\\b${marker}\\b`, 'i').test(haystack)) {
      // Ante marcadores contradictorios gana el MÁS CONSERVADOR: un "borrador firmado"
      // sigue siendo un borrador — estar firmado no le confiere la autoridad de un
      // documento vigente. En autoridad, la señal más baja manda.
      if (matched === null || markerValue < value) {
        matched = marker;
        value = markerValue;
      }
    }
  }

  return {
    value,
    rationale: matched
      ? `Marcador de autoridad detectado: "${matched}"`
      : 'Sin marcador de autoridad explícito (valor neutro)',
  };
}

export function computeInitialConfidence(
  input: ConfidenceInput,
  weights: ConfidenceWeights = DEFAULT_CONFIDENCE_WEIGHTS,
): ConfidenceResult {
  const sourceTrust = input.sourceType
    ? DEFAULT_SOURCE_TRUST[input.sourceType]
    : // Ítem sin conector (creado manualmente, procedencia nula — §3.5): se trata con la
      // misma confianza base que una carga manual, que es lo que conceptualmente es.
      DEFAULT_SOURCE_TRUST.FILE_UPLOAD;

  const completeness = completenessOf(input.contentText);
  const authority = authorityOf(input.title, input.contentText);

  // Una clasificación ambigua penaliza levemente (§8.1). Si no hubo clasificación, se
  // asume certeza media en vez de cero: no haber podido clasificar no convierte el
  // contenido en poco fiable, solo lo deja sin esa evidencia a favor.
  const certainty = input.classificationCertainty ?? 0.5;

  const factors: ConfidenceFactor[] = [
    {
      name: 'sourceTrust',
      value: sourceTrust,
      weight: weights.sourceTrust,
      rationale: `Confianza base del conector ${input.sourceType ?? 'FILE_UPLOAD (sin conector)'}`,
    },
    {
      name: 'classificationCertainty',
      value: certainty,
      weight: weights.classificationCertainty,
      rationale:
        input.classificationCertainty === null
          ? 'Sin clasificación disponible (valor neutro)'
          : `Certeza reportada por la clasificación: ${certainty.toFixed(2)}`,
    },
    {
      name: 'contentCompleteness',
      value: completeness.value,
      weight: weights.contentCompleteness,
      rationale: completeness.rationale,
    },
    {
      name: 'authoritySignal',
      value: authority.value,
      weight: weights.authoritySignal,
      rationale: authority.rationale,
    },
  ];

  const score = factors.reduce((acc, f) => acc + f.value * f.weight, 0);

  return { score: Number(score.toFixed(4)), factors };
}
