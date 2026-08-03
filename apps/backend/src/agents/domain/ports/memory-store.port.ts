/** Token de inyección: `MemoryStorePort` es una interfaz y Nest necesita un token concreto. */
export const MEMORY_STORE_PORT = Symbol('MemoryStorePort');

/**
 * Almacén de memoria del agente — BUSINESSBRAIN_MIGRATION_PLAN.md §7.4, `MemoryStorePort`.
 *
 * La memoria es **privada de cada usuario**. Las conversaciones ya están aisladas por
 * organización y usuario desde la Fase 4; una memoria compartida entre usuarios del mismo
 * tenant rompería ese aislamiento por la puerta de atrás — lo que el agente aprendiera de la
 * conversación de una persona afloraría en la de otra.
 *
 * Por eso el alcance viaja COMPLETO en cada operación y ninguno de sus tres campos es
 * opcional. No es una comodidad: un parámetro opcional aquí es una consulta sin filtrar
 * esperando a ocurrir.
 */
export interface MemoryScope {
  organizationId: string;
  agentId: string;
  userId: string;
}

export interface MemoryEntry {
  key: string;
  value: unknown;
  conversationId: string | null;
  updatedAt: Date;
}

export interface MemoryStorePort {
  /** Las más recientes primero: si hay que recortar, se conserva lo más actual. */
  recall(scope: MemoryScope, limit: number): Promise<MemoryEntry[]>;

  /**
   * Recordar dos veces la misma clave actualiza el hecho, no lo duplica: dos verdades
   * simultáneas sobre lo mismo no tendrían criterio de desempate.
   */
  remember(
    scope: MemoryScope,
    entry: { key: string; value: unknown; conversationId?: string },
  ): Promise<void>;

  forget(scope: MemoryScope, key: string): Promise<void>;
}
