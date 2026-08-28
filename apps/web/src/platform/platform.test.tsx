import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { es } from '../i18n/catalog/es';
import { en } from '../i18n/catalog/en';
import { PLATFORM_AUDIT_ACTIONS } from '../../../backend/src/audit/domain/platform-actions';

/**
 * Garantías ESTRUCTURALES del panel de operación.
 *
 * ## Qué prueba esto que no puede probar un recorrido de navegador
 *
 * Un recorrido comprueba lo que ocurre con los datos que se le pusieron delante. Esto
 * comprueba que **no existe el camino de código**: que ningún fichero del panel nombra un
 * campo secreto, que no hay ni un rótulo escrito a mano en un componente, y que ningún código
 * de auditoría puede llegar a producción sin traducir.
 *
 * Es la diferencia entre "en esta prueba no salió ningún secreto" y "no hay forma de que
 * salga". La primera se cumple por casualidad el día que los datos de prueba no lo tenían.
 */

const RAIZ = join(__dirname);

function ficherosDelPanel(): Array<{ nombre: string; contenido: string }> {
  return readdirSync(RAIZ)
    .filter((f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.endsWith('.test.tsx'))
    .map((nombre) => ({
      nombre,
      contenido: readFileSync(join(RAIZ, nombre), 'utf8'),
    }));
}

describe('el panel no puede pintar lo que no debe', () => {
  /**
   * Los nombres de campo que jamás deben aparecer en el código del panel.
   *
   * No es una lista de cosas que "no se pintan": es una lista de cosas que **no se nombran**.
   * Un componente que escribe `user.passwordHash` no compila hoy —el tipo no lo tiene— pero
   * mañana alguien puede ampliar el tipo. Esta prueba falla antes.
   */
  const PROHIBIDOS = [
    'passwordHash',
    'password',
    'mfaSecret',
    'totpSecret',
    'recoveryCodes',
    'recoveryCode',
    'refreshToken',
    'accessToken',
    'csrfToken',
    'apiKey',
    'configEnc',
    'credential',
    'tokenHash',
    'codeHash',
  ];

  it.each(PROHIBIDOS)(
    'CRÍTICO: ningún fichero del panel nombra "%s"',
    (prohibido) => {
      const culpables = ficherosDelPanel()
        .filter(({ contenido }) => {
          // Se ignoran los comentarios: explicar POR QUÉ no se enseña una contraseña exige
          // escribir la palabra, y prohibirla en la prosa dejaría el código sin explicación.
          const sinComentarios = contenido
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          return new RegExp(`\\b${prohibido}\\b`, 'i').test(sinComentarios);
        })
        .map(({ nombre }) => nombre);

      expect(culpables).toEqual([]);
    },
  );

  it('CRÍTICO: `memberships` solo aparece como RECUENTO, nunca como lista', () => {
    /**
     * La distinción importa y por eso la prueba la hace explícita.
     *
     * `_count.memberships` es un número: cuánta gente tiene una empresa. Es señal operativa
     * legítima y sale así de la API.
     *
     * `memberships` como ARRAY es la fila cruda de Prisma —con su `organization` anidada y su
     * `role`— y en la Fase 5 se coló de verdad en una respuesta. Pintarla aquí significaría
     * que alguien la trajo de vuelta. La API devuelve `organizations`, ya presentado.
     */
    const culpables = ficherosDelPanel()
      .filter(({ contenido }) => {
        const sinComentarios = contenido
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '')
          // Se descuentan los usos legítimos: el acceso al recuento y su declaración de tipo.
          .replace(/_count\.memberships/g, '')
          .replace(/memberships:\s*number/g, '');
        return /\bmemberships\b/.test(sinComentarios);
      })
      .map(({ nombre }) => nombre);

    expect(culpables).toEqual([]);
  });

  it('CRÍTICO: el panel no habla con ninguna ruta de cliente', () => {
    // Toda llamada sale a `/platform/*`. Si una pantalla del panel llamara a una ruta de
    // tenant, el backend respondería 403 —el aislamiento no depende de esto— pero significaría
    // que alguien intentó cruzar la frontera, y eso hay que verlo aquí y no en un 403.
    const llamadas = ficherosDelPanel().flatMap(({ nombre, contenido }) =>
      [...contenido.matchAll(/api<[^>]*>\(\s*[`'"]([^`'"]+)/g)].map(
        (match) => [nombre, match[1]] as const,
      ),
    );

    expect(llamadas.length).toBeGreaterThan(0);
    expect(
      llamadas.filter(([, ruta]) => !ruta.startsWith('/platform')),
    ).toEqual([]);
  });

  it('CRÍTICO: ninguna llamada del panel manda la cabecera de organización', () => {
    // `withoutOrganization: true` en todas. Quien administra la plataforma no tiene
    // organización activa, y mandar una cabecera vacía o heredada sería pedirle a la API que
    // resuelva una empresa que no le corresponde.
    const sinMarcar = ficherosDelPanel().filter(({ contenido }) => {
      const llamadas = [...contenido.matchAll(/api<[^>]*>\([\s\S]*?\n\s*\)/g)];
      return llamadas.some(
        (match) => !match[0].includes('withoutOrganization: true'),
      );
    });

    expect(sinMarcar.map((f) => f.nombre)).toEqual([]);
  });
});

describe('el panel está entero en el catálogo de traducción', () => {
  it('CRÍTICO: ningún componente lleva texto escrito a mano', () => {
    /**
     * Se busca prosa dentro del JSX: texto entre `>` y `<` con al menos dos palabras y una
     * letra acentuada o una mayúscula inicial. Los rótulos legítimos salen de `t(...)`, que
     * es una expresión y no cae aquí.
     *
     * Un `if (locale === 'es')` también se busca explícitamente: es la otra forma de meter
     * idioma en un componente, y la que después obliga a duplicar la pantalla.
     */
    const sospechosos: Array<[string, string]> = [];

    for (const { nombre, contenido } of ficherosDelPanel()) {
      const sinComentarios = contenido
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      expect(sinComentarios).not.toMatch(/locale\s*===\s*['"]/);

      for (const match of sinComentarios.matchAll(/>\s*([^<>{}\n]{6,})\s*</g)) {
        const texto = match[1].trim();
        // Símbolos sueltos y separadores no son prosa.
        if (!/[a-zá-úñ]/i.test(texto)) continue;
        if (texto.split(/\s+/).length < 2) continue;
        // Ni las anotaciones de tipo, que también viven entre `>` y `<`: `Promise<T>`,
        // `(data: T) => ReactNode`. Se reconocen por llevar puntuación de código, que la
        // prosa de una interfaz no tiene.
        if (/[;:()=]|=>/.test(texto)) continue;
        sospechosos.push([nombre, texto]);
      }
    }

    expect(sospechosos).toEqual([]);
  });

  it('CRÍTICO: cada acción administrativa tiene rótulo en los dos idiomas', () => {
    // El catálogo de acciones lo devuelve la API desde su lista cerrada. Si el backend añade
    // una acción y nadie la traduce, el panel enseñaría `platform.user.something` a quien
    // opera. Esta prueba cruza las dos aplicaciones para que eso no llegue.
    const sinTraducir = PLATFORM_AUDIT_ACTIONS.filter((accion) => {
      const clave = `audit.action.${accion}` as keyof typeof es;
      return !es[clave] || !(en as Record<string, string>)[clave];
    });

    expect(sinTraducir).toEqual([]);
  });

  it('CRÍTICO: el inglés del panel no tiene huecos', () => {
    const claves = Object.keys(es).filter((clave) =>
      clave.startsWith('platform.'),
    );
    const faltan = claves.filter(
      (clave) => !(en as Record<string, string>)[clave],
    );

    expect(claves.length).toBeGreaterThan(50);
    expect(faltan).toEqual([]);
  });

  it('CRÍTICO: ningún rótulo del panel enseña vocabulario interno', () => {
    // Ni `SUPERADMIN`, ni `tenant`, ni `grant`, ni `scope`, ni el nombre de un enum. Quien
    // opera el producto no ha leído el esquema.
    const interno =
      /\b(SUPERADMIN|MEMBERSHIP|TENANT|GRANT|SCOPE|METADATA|DIAGNOSTICS|PlatformAccessGrant|platformRole|mfaEnabled)\b/;

    const culpables = Object.entries(es)
      .filter(([clave]) => clave.startsWith('platform.'))
      .filter(([, texto]) => interno.test(texto))
      .map(([clave]) => clave);

    expect(culpables).toEqual([]);
  });
});
