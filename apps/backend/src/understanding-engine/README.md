# Understanding Engine (Fase 3)

Especificación: [`docs/UNDERSTANDING_ENGINE_DESIGN.md`](../../../../docs/UNDERSTANDING_ENGINE_DESIGN.md) — 🧊 arquitectura congelada v1.0.

Convierte el conocimiento que produce el Knowledge Engine en **comprensión derivada y
justificada**: patrones, anomalías, riesgos y oportunidades, cada uno con su evidencia, su
traza de razonamiento y su confianza propia.

No es un generador de respuestas. Produce `Insight`; qué se hace con ellos es
responsabilidad de otras superficies, y cualquier acción pasa siempre por el Principio de
Evolución Asistida (§11).

## Frontera con el Knowledge Engine

Este módulo consume el Knowledge Engine **exclusivamente a través de sus contratos
declarados** (`KNOWLEDGE_ENGINE_DESIGN.md` §13 y §13.1). Nunca accede a `KnowledgeChunk` ni
al almacén vectorial por su cuenta.

La división es estricta y no debe difuminarse:

- El **Knowledge Engine** entrega **hechos**: qué decayó, qué conflicto sigue abierto, qué
  fuente está desconectada, qué versión tiene una evidencia.
- El **Understanding Engine** produce **toda interpretación** de esos hechos. Qué cambio
  invalida qué razonamiento depende del razonamiento, no del documento: es epistemología, y
  si el Knowledge Engine emitiera ese juicio necesitaría conocer los `Insight`, invirtiendo
  la dependencia sobre un documento congelado.

## Estado de las subfases

| Subfase | Estado | Contenido |
|---|---|---|
| 3.1 | ✅ | `AnalysisRun` + `Insight` con identidad de sujeto, estrategia simbólica sobre señales, idempotencia bajo concurrencia |
| 3.2 | ⬜ | `BusinessObjective` y el gate de Riesgo/Oportunidad |
| 3.3 | ⬜ | Razonamiento generativo con traza obligatoria |
| 3.4 | ⬜ | Confianza compuesta viva y frescura derivada |
| 3.5 | ⬜ | Curación humana y puente a `Recommendation` |
| 3.6 | ⬜ | `RetrieveInsights`, sin consumidores conectados |

## Invariantes que ya sostiene el código

- **Identidad de sujeto** (§3.4): describe el *asunto*, nunca el momento ni la evidencia
  concreta. Es lo que permite que dos ejecuciones sucesivas no dupliquen el mismo hallazgo.
  Ante duda, una estrategia acuña una identidad nueva; **jamás** fusiona por aproximación —
  fusionar por error produce una supersesión falsa, separar por error solo duplicados.
- **Idempotencia bajo concurrencia** (§12): índice único parcial sobre
  `(organizationId, subjectIdentity)` limitado a `ACTIVE`, definido por **exclusión** de los
  estados terminales para fallar del lado seguro ante un estado futuro sin clasificar.
  Varios `AnalysisRun` simultáneos son legítimos y **no se serializan**.
- **`InsightStatus` contiene solo estatus epistémico** (§5). No existe `OBSOLETE`: la
  frescura es una proyección derivada en lectura, nunca un estado persistido.
- **El tipo nunca forma parte de la identidad de sujeto** (§8): un mismo asunto pasa de
  `ANOMALY` a `RISK` cuando aparece un `BusinessObjective` confirmado que lo hace relevante.

## Prerrequisitos bloqueantes de subfases futuras

- **Subfase 3.5** — el esquema de `Recommendation` no preserva el contrato del dominio: le
  faltan los campos estructurados del Principio de Evolución Asistida, el
  `EffectiveCollectionScope` y la referencia al `Insight` de origen. Es una única migración,
  propiedad del `RecommendationsModule`, y debe resolverse antes de tocar
  `EscalateInsightToRecommendation`.

## Pendiente de entorno

- **Validación end-to-end contra OpenAI.** El proveedor de embeddings oficial es
  `text-embedding-3-small` (1536 dimensiones, fijadas en el esquema desde la Fase 1). La
  integración está implementada y probada con dobles, y la persistencia y búsqueda
  vectoriales están verificadas contra pgvector real — pero **la llamada real al proveedor
  no se ha ejecutado nunca** porque no hay `OPENAI_API_KEY` en el entorno ni ningún
  `LlmProfile` con clave. No bloquea el desarrollo; queda como verificación pendiente en
  cuanto la credencial esté disponible.
