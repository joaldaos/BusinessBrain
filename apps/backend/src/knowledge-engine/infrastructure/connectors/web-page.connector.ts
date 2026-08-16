import { lookup } from 'node:dns/promises';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  ConnectorPort,
  ExtractedContent,
} from '../../domain/ports/connector.port';
import {
  extractFromHtml,
  isTextualContentType,
} from '../../domain/html-extraction';
import { inspectResolvedAddresses, inspectUrl } from '../../domain/url-safety';

/** Config que una `KnowledgeSource` de tipo web declara. Se cifra en reposo como el resto. */
export interface WebPageConnectorConfig {
  url: string;
}

export interface WebPageConnectorInput {
  config?: Record<string, unknown>;
}

/** Cotas duras. Una página no puede agotar la memoria ni colgar la ingesta indefinidamente. */
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
/** Sin un mínimo de texto no hay nada que comprender, y sí basura que indexar. */
const MIN_TEXT_LENGTH = 80;

/**
 * Conector de página web — primera integración externa, sin OAuth.
 *
 * Es el primer conector que **TRAE** contenido en lugar de recibirlo: nadie sube nada, el
 * servidor va a buscarlo. Esa diferencia es la que introduce `acquisition: 'PULL'` en el
 * puerto, y es también la que trae el riesgo: un servidor que va donde le digan es un cliente
 * HTTP al servicio de quien escriba la URL.
 *
 * ## Cómo se contiene ese riesgo
 *
 * 1. La forma de la URL se valida antes de tocar la red (`inspectUrl`).
 * 2. El nombre se resuelve y se decide sobre la **IP**, no sobre el dominio: comprobar el
 *    nombre no sirve porque un atacante controla su propio DNS.
 * 3. Las redirecciones se siguen a mano, comprobando **cada salto**. Delegar en el `redirect:
 *    'follow'` de `fetch` haría que la segunda petición no pasara por ningún control, que es
 *    justo por donde se cuela un ataque de este tipo.
 * 4. Cotas de tamaño, tiempo y número de saltos.
 * 5. Solo tipos de contenido textuales, y fail-closed ante uno no declarado.
 *
 * ## Idempotencia
 *
 * Este conector no la implementa: la garantiza la tubería que ya existe. El mismo contenido
 * produce el mismo `contentHash` y la deduplicación de nivel 1 lo reconoce como duplicado
 * exacto; si la página cambió, la similitud estructural de nivel 2 crea una versión nueva con
 * su arista `UPDATES`. Sincronizar dos veces no duplica nada.
 */
@Injectable()
export class WebPageConnector implements ConnectorPort {
  private readonly logger = new Logger(WebPageConnector.name);

  readonly key = 'web_page_v1';
  readonly acquisition = 'PULL' as const;

  async extract(input: WebPageConnectorInput): Promise<ExtractedContent[]> {
    const url = this.readUrl(input);
    const { response, finalUrl } = await this.fetchSafely(url);

    const contentType = response.headers.get('content-type');
    if (!isTextualContentType(contentType)) {
      throw new BadRequestException(
        `Esa dirección no devuelve texto (${contentType ?? 'sin tipo declarado'}). ` +
          `Por ahora solo se pueden leer páginas y documentos de texto`,
      );
    }

    const html = await this.readBounded(response);
    const page = extractFromHtml(html);

    if (page.text.length < MIN_TEXT_LENGTH) {
      throw new BadRequestException(
        'La página no tiene texto suficiente para aportar conocimiento. Puede que su ' +
          'contenido se cargue con JavaScript, que esta integración todavía no ejecuta',
      );
    }

    const rawContent = Buffer.from(page.text, 'utf8');

    return [
      {
        title: page.title ?? finalUrl,
        mimeType: 'text/plain',
        sizeBytes: rawContent.byteLength,
        // La dirección FINAL, después de las redirecciones: es de donde salió el contenido
        // realmente, y es lo que hay que poder citar.
        sourceUrl: finalUrl,
        rawContent,
      },
    ];
  }

  private readUrl(input: WebPageConnectorInput): string {
    const url = input?.config?.url;
    if (typeof url !== 'string' || url.trim().length === 0) {
      throw new BadRequestException(
        'Esta fuente no tiene ninguna dirección web configurada',
      );
    }

    const decision = inspectUrl(url.trim());
    if (!decision.allowed) {
      throw new BadRequestException(decision.explanation);
    }

    return url.trim();
  }

  /**
   * Pide la URL siguiendo las redirecciones A MANO, comprobando cada salto.
   *
   * `fetch` con `redirect: 'follow'` seguiría a donde le dijera el servidor sin volver a
   * comprobar nada: bastaría con que una dirección pública respondiera 302 hacia
   * `169.254.169.254` para saltarse todo el control.
   */
  private async fetchSafely(
    startUrl: string,
  ): Promise<{ response: Response; finalUrl: string }> {
    let current = startUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      await this.assertPublicDestination(current);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(current, {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            // Identificarse es lo correcto: un sitio que no quiera ser leído debe poder
            // reconocernos y bloquearnos.
            'User-Agent': 'BusinessBrain/1.0 (+lector de conocimiento)',
            Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
          },
        });
      } catch (error) {
        const message =
          (error as Error).name === 'AbortError'
            ? `La página tardó más de ${TIMEOUT_MS / 1000} segundos en responder`
            : `No se pudo acceder a la dirección: ${(error as Error).message}`;
        throw new BadRequestException(message);
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new BadRequestException(
            'La dirección redirige a ninguna parte',
          );
        }
        current = new URL(location, current).toString();

        const decision = inspectUrl(current);
        if (!decision.allowed) {
          throw new BadRequestException(
            `La dirección redirige a un destino no permitido: ${decision.explanation}`,
          );
        }
        continue;
      }

      if (!response.ok) {
        throw new BadRequestException(
          `La página respondió ${response.status}. Comprueba que la dirección es pública ` +
            `y accesible`,
        );
      }

      return { response, finalUrl: current };
    }

    throw new BadRequestException(
      `La dirección encadena más de ${MAX_REDIRECTS} redirecciones`,
    );
  }

  /**
   * Resuelve el nombre y decide sobre las IP, nunca sobre el dominio.
   *
   * `ALLOW_LOOPBACK_FETCH` existe solo para poder verificar el flujo contra un servidor de
   * pruebas local. Está condicionada a NO estar en producción **además** de la variable: una
   * variable mal puesta en un despliegue real no puede abrir la red interna, que es
   * exactamente el fallo que esta clase entera existe para impedir.
   */
  private async assertPublicDestination(url: string): Promise<void> {
    if (
      process.env.ALLOW_LOOPBACK_FETCH === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      this.logger.warn(
        'Comprobacion de destino DESACTIVADA por ALLOW_LOOPBACK_FETCH. Solo para pruebas.',
      );
      return;
    }

    const { hostname } = new URL(url);

    let addresses: string[];
    try {
      const resolved = await lookup(hostname, { all: true });
      addresses = resolved.map((entry) => entry.address);
    } catch {
      throw new BadRequestException(
        `No se pudo resolver "${hostname}". Comprueba que la dirección existe`,
      );
    }

    const decision = inspectResolvedAddresses(addresses);
    if (!decision.allowed) {
      // Se registra porque un intento de alcanzar la red interna no es un error de usuario
      // corriente: es una señal que alguien debería poder ver después.
      this.logger.warn(
        `Destino rechazado por apuntar a la red interna: ${hostname} → ` +
          `${addresses.join(', ')}`,
      );
      throw new BadRequestException(decision.explanation);
    }
  }

  /**
   * Lee el cuerpo con un tope real.
   *
   * Fiarse de `Content-Length` no basta: un servidor puede mentir o no declararlo. Se cuenta lo
   * que llega de verdad y se corta.
   */
  private async readBounded(response: Response): Promise<string> {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) {
      throw new BadRequestException(
        `La página pesa más de ${MAX_BYTES / 1024 / 1024} MB`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) return '';

    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new BadRequestException(
          `La página pesa más de ${MAX_BYTES / 1024 / 1024} MB`,
        );
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks).toString('utf8');
  }
}
