/**
 * El modelo de embeddings oficial de la plataforma.
 *
 * Vive en el dominio de IA y no junto a quien trocea documentos porque lo usan tres capas
 * distintas —vectorizar al ingerir, vectorizar la consulta al recuperar, y comprobar una clave
 * antes de guardarla— y tenerlo en una de ellas obligaba a las otras a importar de ahí. Eso
 * creaba un ciclo real: la configuración de IA tiraba del Knowledge Engine, que tira del
 * registro de proveedores, que es del módulo de IA.
 *
 * La dimensionalidad (1536) está fijada en el esquema desde la Fase 1: cambiar a un modelo de
 * otra dimensión NO es una reindexación, es una migración de esquema con su propio proceso
 * (KNOWLEDGE_ENGINE_DESIGN.md §12).
 */
export const OFFICIAL_EMBEDDING_MODEL = 'text-embedding-3-small';
export const OFFICIAL_EMBEDDING_VERSION = 'v1';
export const EMBEDDING_DIMENSIONS = 1536;
