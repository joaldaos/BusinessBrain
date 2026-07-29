import { Injectable } from '@nestjs/common';
import type { HttpClientPort } from '../../domain/ports/http-client.port';

/** Implementación real de HttpClientPort usando el fetch global de Node 18+. */
@Injectable()
export class FetchHttpClient implements HttpClientPort {
  async postJson<TResponse>(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): Promise<TResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Llamada HTTP a ${url} falló con status ${response.status}: ${errorBody}`,
      );
    }

    return response.json() as Promise<TResponse>;
  }

  /**
   * Un evento SSE puede llegar partido entre dos chunks de red, y un chunk puede traer
   * varios eventos. Se acumula en un búfer y solo se emite lo que ya está completo
   * (delimitado por línea en blanco), que es la única forma de no entregar JSON a medias.
   */
  async *postSse(
    url: string,
    body: unknown,
    headers: Record<string, string>,
  ): AsyncIterable<string> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `Llamada SSE a ${url} falló con status ${response.status}: ${errorBody}`,
      );
    }
    if (!response.body) {
      throw new Error(`La respuesta SSE de ${url} no trae cuerpo`);
    }

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });

      let separator = buffer.indexOf('\n\n');
      while (separator !== -1) {
        const event = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        const payload = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (payload) yield payload;

        separator = buffer.indexOf('\n\n');
      }
    }
  }
}
