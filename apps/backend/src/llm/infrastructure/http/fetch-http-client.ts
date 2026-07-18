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
}
