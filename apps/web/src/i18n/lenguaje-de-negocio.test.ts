import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * BusinessBrain habla como un asesor, no como su propio código fuente.
 *
 * ## Por qué esto es una prueba y no una convención
 *
 * Porque ya pasó. Durante seis fases se coló en pantallas de cliente «indexado»,
 * «sincronizar», «confianza 0.57», «1 nuevo(s), 0 actualizado(s)» y «Evidencia (3)»: ninguna
 * de esas palabras significa nada para quien lleva una panadería, y todas entraron una a una,
 * en cambios pequeños que por separado parecían inofensivos.
 *
 * Una convención no lo impide. La siguiente persona que añada un texto —o yo mismo dentro de
 * dos fases— escribirá lo primero que se le ocurra, y lo primero que se le ocurre a quien
 * está mirando el modelo de datos es el nombre del campo.
 *
 * ## Qué se revisa exactamente
 *
 * Los VALORES del catálogo de cliente. No el código, que es para nosotros y donde estas
 * palabras son las correctas; no los comentarios, por lo mismo; y no las claves, que son
 * identificadores.
 *
 * ## Y qué queda fuera a propósito
 *
 * Todo lo que empieza por `platform.`: el panel de operación lo usa quien administra el
 * producto, y ahí «sincronización», «diagnóstico» o «concesión» son las palabras exactas.
 * Empobrecerlas para proteger a un público que no lo usa sería peor.
 */

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Vocabulario que delata al software por debajo.
 *
 * Se prohíbe la palabra entera para que "escaneo" no salte por "cano" y "identificador" no
 * salte por "id". Lo que se busca es a alguien escribiendo el nombre de un campo, de una
 * tabla o de un mecanismo interno donde debería ir una frase.
 */
const INTERNO = new RegExp(
  '\\b(' +
    [
      // Almacenamiento y transporte
      'prisma',
      'sql',
      'base de datos',
      'database',
      'schema',
      'endpoint',
      'payload',
      'json',
      'https?',
      'backend',
      'servidor',
      // Identificadores y credenciales
      'uuid',
      'cuid',
      'membership',
      'membresía',
      'token',
      // Motor de conocimiento
      'embedding',
      'embeddings',
      'chunk',
      'chunks',
      'vector',
      'vectores',
      'indexar',
      'indexado',
      'indexada',
      'indexados',
      'indexadas',
      'rag',
      // Umbrales y puntuaciones
      'umbral',
      'umbrales',
      'threshold',
      'score',
      'flag',
      'raw',
    ].join('|') +
    ')\\b',
  'i',
);

/** `'clave': 'valor',` en una línea, que es como está escrito el catálogo. */
const ENTRADA = /^\s*'([a-zA-Z0-9.]+)':\s*(?:'(.*)',?)?\s*$/;
const VALOR_SUELTO = /^\s*'(.*)',\s*$/;

/**
 * Los valores del catálogo que ve un cliente, con su número de línea.
 *
 * El catálogo escribe los textos largos en la línea siguiente a su clave, así que se recorre
 * llevando la última clave vista: es lo que permite saber si un valor pertenece a `platform.`
 * sin volver a analizar el fichero entero.
 */
function textosDeCliente(idioma: 'es' | 'en'): { linea: number; texto: string }[] {
  const fichero = join(RAIZ, 'i18n', 'catalog', `${idioma}.ts`);
  const lineas = readFileSync(fichero, 'utf8').split(/\r?\n/);
  const salida: { linea: number; texto: string }[] = [];
  let deCliente = true;

  for (const [indice, linea] of lineas.entries()) {
    const entrada = ENTRADA.exec(linea);
    if (entrada) {
      deCliente = !entrada[1].startsWith('platform.');
      if (deCliente && entrada[2]) {
        salida.push({ linea: indice + 1, texto: entrada[2] });
      }
      continue;
    }

    const suelto = VALOR_SUELTO.exec(linea);
    if (suelto && deCliente) {
      salida.push({ linea: indice + 1, texto: suelto[1] });
    }
  }

  return salida;
}

describe('el catálogo de cliente no habla como el código', () => {
  it.each(['es', 'en'] as const)(
    'ningún texto de %s enseña vocabulario interno',
    (idioma) => {
      const infracciones = textosDeCliente(idioma)
        .map(({ linea, texto }) => {
          // Una dirección de ejemplo NO es vocabulario interno: es lo que la persona va a
          // escribir en ese campo, y sin el `https://` delante no serviría de ejemplo.
          if (/^https?:\/\/\S+$/.test(texto)) return null;

          const encontrado = INTERNO.exec(texto);
          return encontrado
            ? `${idioma}.ts:${linea} → «${encontrado[0]}» en: ${texto.slice(0, 80)}`
            : null;
        })
        .filter((x): x is string => x !== null);

      expect(
        infracciones,
        'Escríbelo como se lo contarías a quien lleva una panadería. Si el concepto es ' +
          'inevitablemente técnico, va en el detalle ampliado, no en el texto principal.',
      ).toEqual([]);
    },
  );

  it('el catálogo de cliente dice lo mismo en los dos idiomas', () => {
    // No compara traducciones: comprueba que ninguno se queda con textos que el otro no
    // tiene. Es la garantía que evita que una pantalla nueva llegue solo en castellano.
    const claves = (idioma: 'es' | 'en') => {
      const fichero = join(RAIZ, 'i18n', 'catalog', `${idioma}.ts`);
      return new Set(
        [...readFileSync(fichero, 'utf8').matchAll(/^\s*'([a-zA-Z0-9.]+)':/gm)].map(
          (m) => m[1],
        ),
      );
    };

    const es = claves('es');
    const en = claves('en');
    expect([...es].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !es.has(k))).toEqual([]);
  });
});
