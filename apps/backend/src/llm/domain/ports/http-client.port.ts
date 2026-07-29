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

  /**
   * Igual que `postJson` pero para respuestas `text/event-stream`: devuelve el payload
   * de cada evento SSE (lo que sigue a `data: `) a medida que llega, sin esperar al final.
   *
   * Emite el payload en crudo, sin interpretarlo: cada proveedor tiene su propio formato
   * de evento y es él quien sabe leerlo. Este puerto solo resuelve el transporte.
   */
  postSse(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): AsyncIterable<string>;
}
