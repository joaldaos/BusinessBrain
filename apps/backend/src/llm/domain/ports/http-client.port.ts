/** Token de inyección: HttpClientPort es una interfaz, Nest necesita un token concreto. */
export const HTTP_CLIENT_PORT = Symbol('HttpClientPort');

/**
 * Abstrae la llamada HTTP saliente que hacen los proveedores de LLM. Existe
 * únicamente para poder sustituirla por un doble de prueba en los tests
 * (AnthropicProvider/OpenAiProvider no llaman a `fetch` directamente) — así
 * se valida la abstracción de proveedores sin necesitar claves de API reales
 * ni red en CI.
 */
export interface HttpClientPort {
  postJson<TResponse>(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<TResponse>;
}
