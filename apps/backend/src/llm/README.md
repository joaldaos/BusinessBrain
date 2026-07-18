# LlmModule

## Responsabilidad
Capa de abstracción de proveedores de IA (LLM conversacional + embeddings). Ningún otro módulo debe conocer Anthropic/OpenAI/Gemini/Mistral/Ollama directamente — todos pasan por `ProviderRegistry`. Sin esta capa, BusinessBrain quedaría acoplado a un proveedor concreto, justo lo que la revisión de arquitectura pidió evitar explícitamente.

## Dependencias
`PrismaService` (lectura de `LlmProfile`), `@nestjs/config` (API keys de plataforma como fallback), `fetch` global de Node (sin librería HTTP externa).

## Flujo de funcionamiento
1. Un consumidor futuro (`ConversationsModule`, `AgentsModule`) llama a `ProviderRegistry.resolveForOrganization(organizationId)`.
2. `ProviderRegistry` busca el `LlmProfile` por defecto de esa organización; si no existe, cae al `LlmProfile` de plataforma (`organizationId: null`, `isDefault: true`).
3. Según `profile.provider` (`ANTHROPIC` | `OPENAI` | `GEMINI` | `MISTRAL` | `OLLAMA`), `ProviderRegistry` devuelve la implementación de `LlmProviderPort` correspondiente.
4. El consumidor llama a `provider.complete(request, profile.modelName, apiKey?)` sin saber qué proveedor hay detrás — `LlmCompletionRequest`/`LlmCompletionResult` son el contrato común.
5. Cada provider (`AnthropicProvider`, `OpenAiProvider`) traduce ese contrato común al formato específico de su API mediante `HttpClientPort` (inyectado, no `fetch` embebido) y normaliza la respuesta de vuelta al contrato común.

## Endpoints
Ninguno. `LlmModule` no tiene controller — es un módulo interno consumido programáticamente por otros módulos (ver docs/BUSINESSBRAIN_MIGRATION_PLAN.md §5, fila `LlmModule`).

## Decisiones de diseño
- **`HttpClientPort` inyectado en vez de `fetch` embebido en cada provider**: permite testear ambos proveedores con un doble de prueba, sin API keys reales ni red — así se pudo "demostrar que la arquitectura soporta múltiples proveedores SaaS reales" (instrucción explícita) sin depender de credenciales de terceros en CI.
- **`EmbeddingProviderPort` separado de `LlmProviderPort`**: Anthropic no ofrece una API de embeddings pública; forzar un método `embed()` en su provider habría significado lanzar "no implementado" en tiempo de ejecución en vez de dejar que el tipo lo exprese en tiempo de compilación.
- **Segundo proveedor real elegido: OpenAI, no Ollama** — decisión explícita para validar la abstracción contra un segundo proveedor SaaS de pago, no solo contra un modelo local. Ollama sigue siendo la opción recomendada para desarrollo local sin coste, y su implementación es una ampliación de bajo esfuerzo (mismo puerto, misma forma).
- **`GEMINI`, `MISTRAL`, `OLLAMA` existen en el enum `LlmProviderName` (schema, ya aprobado) sin implementación todavía.** Es intencional: el modelo de datos ya soporta 5 proveedores; el código soporta 2. Añadir un tercero es crear un nuevo `XxxProvider implements LlmProviderPort` y registrarlo en `ProviderRegistry` — no requiere tocar `ConversationsModule`, `AgentsModule` ni el schema.
- **Sin llamadas reales a las APIs en los tests de esta fase.** No hay `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` reales disponibles en este entorno; los tests verifican el contrato (mismo shape de entrada/salida, mismo comportamiento de `ProviderRegistry` ante un cambio de configuración) con un `HttpClientPort` de prueba. Una llamada real de humo queda pendiente para cuando haya claves de API disponibles (ver ampliaciones).

## Ampliaciones futuras
- Implementar `GeminiProvider`, `MistralProvider`, `OllamaProvider` (mismo puerto).
- Smoke test opcional contra APIs reales, gateado por la presencia de las env vars correspondientes (se saltaría automáticamente si no están configuradas).
- Reintentos/backoff y timeouts configurables en `HttpClientPort` — hoy es una única llamada sin reintento.
- Métrica de uso (tokens consumidos) hacia `UsageRecord` para límites de plan (ver `BillingModule`, fase 7 del roadmap).
