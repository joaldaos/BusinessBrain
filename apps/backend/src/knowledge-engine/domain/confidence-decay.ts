import { AgentArea } from '@businessbrain/database';

/**
 * Decaimiento temporal de la confianza — KNOWLEDGE_ENGINE_DESIGN.md §8.3.
 *
 * Todo `KnowledgeItem` sin recorroboración pierde confianza de forma gradual, con una
 * velocidad que depende de su clasificación: una política de RR. HH. envejece más lento
 * que una nota de reunión. El decaimiento NUNCA lleva la confianza a cero: existe un piso
 * por debajo del cual el ítem se excluye de recuperación por defecto (§8.5) pero no se
 * elimina ni se degrada más.
 *
 * Todos los valores de este módulo son configuración con valor por defecto de plataforma,
 * ajustables por organización — nunca constantes semánticas fijas (§8.3, hallazgo #10).
 */

/**
 * Vida media en días por área de negocio: cuántos días tarda la confianza en recorrer la
 * mitad de la distancia que la separa del piso mínimo. Un valor mayor = envejece más lento.
 */
export const DEFAULT_HALF_LIFE_DAYS: Readonly<Record<AgentArea, number>> = {
  // Normativa interna: cambia poco y su vigencia es larga.
  HR: 540,
  FINANCE: 365,
  OPERATIONS: 365,
  // Compromisos y relación con cliente: vigencia media.
  SALES: 180,
  SUPPORT: 180,
  // Contenido de campaña: envejece rápido.
  MARKETING: 120,
  // Sin área asignada: valor intermedio prudente.
  GENERAL: 270,
};

/** Vida media aplicada a un ítem sin clasificar. */
export const DEFAULT_UNCLASSIFIED_HALF_LIFE_DAYS = 270;

/**
 * Piso mínimo de plataforma (§8.5). Activo por defecto: por debajo de él un ítem queda
 * excluido de recuperación, pero conserva su contenido y su historial. El decaimiento
 * converge asintóticamente a este valor, nunca por debajo.
 */
export const DEFAULT_MINIMUM_CONFIDENCE_FLOOR = 0.2;

/**
 * Penalización adicional cuando la `KnowledgeSource` de origen está inactiva (§8.2): "la
 * confianza no se anula pero se marca con una señal de fuente inactiva, que el proceso de
 * decaimiento tiene en cuenta con MÁS SEVERIDAD". Multiplica la velocidad de envejecimiento.
 */
export const DEFAULT_INACTIVE_SOURCE_DECAY_MULTIPLIER = 2;

export interface DecaySettings {
  halfLifeDaysByArea: Record<AgentArea, number>;
  unclassifiedHalfLifeDays: number;
  minimumFloor: number;
  inactiveSourceMultiplier: number;
}

export const DEFAULT_DECAY_SETTINGS: DecaySettings = {
  halfLifeDaysByArea: DEFAULT_HALF_LIFE_DAYS,
  unclassifiedHalfLifeDays: DEFAULT_UNCLASSIFIED_HALF_LIFE_DAYS,
  minimumFloor: DEFAULT_MINIMUM_CONFIDENCE_FLOOR,
  inactiveSourceMultiplier: DEFAULT_INACTIVE_SOURCE_DECAY_MULTIPLIER,
};

interface OrganizationSettingsShape {
  knowledgeEngine?: {
    confidence?: {
      halfLifeDaysByArea?: Partial<Record<AgentArea, number>>;
      unclassifiedHalfLifeDays?: number;
      minimumFloor?: number;
      inactiveSourceMultiplier?: number;
    };
  };
}

/**
 * Resuelve la configuración de decaimiento de una organización sobre los valores por
 * defecto de plataforma. Un valor inválido se ignora y se usa el de plataforma: una
 * configuración corrupta nunca debe poder desactivar el piso de confianza.
 */
export function getDecaySettings(organizationSettings: unknown): DecaySettings {
  const configured = (
    organizationSettings as OrganizationSettingsShape | null | undefined
  )?.knowledgeEngine?.confidence;

  const halfLifeDaysByArea = { ...DEFAULT_HALF_LIFE_DAYS };
  for (const [area, days] of Object.entries(
    configured?.halfLifeDaysByArea ?? {},
  )) {
    if (typeof days === 'number' && days > 0 && area in halfLifeDaysByArea) {
      halfLifeDaysByArea[area as AgentArea] = days;
    }
  }

  const floor =
    typeof configured?.minimumFloor === 'number' &&
    configured.minimumFloor >= 0 &&
    configured.minimumFloor < 1
      ? configured.minimumFloor
      : DEFAULT_MINIMUM_CONFIDENCE_FLOOR;

  const unclassified =
    typeof configured?.unclassifiedHalfLifeDays === 'number' &&
    configured.unclassifiedHalfLifeDays > 0
      ? configured.unclassifiedHalfLifeDays
      : DEFAULT_UNCLASSIFIED_HALF_LIFE_DAYS;

  const multiplier =
    typeof configured?.inactiveSourceMultiplier === 'number' &&
    configured.inactiveSourceMultiplier >= 1
      ? configured.inactiveSourceMultiplier
      : DEFAULT_INACTIVE_SOURCE_DECAY_MULTIPLIER;

  return {
    halfLifeDaysByArea,
    unclassifiedHalfLifeDays: unclassified,
    minimumFloor: floor,
    inactiveSourceMultiplier: multiplier,
  };
}

export interface DecayInput {
  currentScore: number;
  /** Fecha del último cálculo de confianza. */
  computedAt: Date;
  now: Date;
  businessArea: AgentArea | null;
  /** La `KnowledgeSource` de origen está deshabilitada o en error prolongado (§8.2). */
  sourceInactive: boolean;
}

export interface DecayResult {
  score: number;
  halfLifeDays: number;
  elapsedDays: number;
  floor: number;
}

/**
 * Decaimiento exponencial hacia el piso mínimo. Se elige exponencial y no lineal porque el
 * conocimiento pierde vigencia rápido al principio y se estabiliza después, y porque
 * garantiza por construcción que nunca se cruza el piso (§8.3: "el decaimiento nunca lleva
 * la confianza a cero automáticamente").
 *
 * Función pura: no lee reloj ni base de datos. `now` se inyecta para que sea testeable y
 * para que un barrido reproduzca exactamente el mismo resultado ante la misma entrada.
 */
export function applyTemporalDecay(
  input: DecayInput,
  settings: DecaySettings = DEFAULT_DECAY_SETTINGS,
): DecayResult {
  const baseHalfLife = input.businessArea
    ? settings.halfLifeDaysByArea[input.businessArea]
    : settings.unclassifiedHalfLifeDays;

  // Una fuente inactiva envejece su conocimiento más deprisa (§8.2).
  const halfLifeDays = input.sourceInactive
    ? baseHalfLife / settings.inactiveSourceMultiplier
    : baseHalfLife;

  const elapsedMs = input.now.getTime() - input.computedAt.getTime();
  const elapsedDays = Math.max(0, elapsedMs / 86_400_000);

  const floor = settings.minimumFloor;
  // Si ya está en el piso o por debajo, no se degrada más.
  if (input.currentScore <= floor) {
    return { score: input.currentScore, halfLifeDays, elapsedDays, floor };
  }

  const decayFactor = Math.pow(0.5, elapsedDays / halfLifeDays);
  const score = floor + (input.currentScore - floor) * decayFactor;

  return {
    score: Number(score.toFixed(4)),
    halfLifeDays,
    elapsedDays: Number(elapsedDays.toFixed(2)),
    floor,
  };
}
