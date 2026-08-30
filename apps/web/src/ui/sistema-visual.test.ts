import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * El sistema visual, defendido por una prueba y no por la buena memoria de nadie.
 *
 * ## Por qué esto existe
 *
 * Hasta la Fase 8 había dos sistemas visuales conviviendo. Se unificaron, pero nada impedía
 * volver a empezar: la próxima pantalla que escriba `text-gray-500` porque "es solo un gris"
 * abre otra vez la puerta, y el segundo sistema no nace de una decisión sino de veinte
 * descuidos que nadie revisó juntos.
 *
 * Esto es la puerta. Si una pantalla de cliente coge un color de la paleta de Tailwind o un
 * tamaño de texto suelto, la prueba falla y dice exactamente dónde.
 *
 * ## Y por qué el contraste también está aquí
 *
 * Porque se puede romper sin darse cuenta al aclarar un gris "para que quede más elegante".
 * Los números salen de la fórmula de WCAG 2.1, no de mirarlos en pantalla: `--color-faint`
 * llevaba desde el principio en 2.64:1 y a simple vista parecía correcto.
 */

/** `src/`, resuelto de forma que funcione igual en Windows y en Linux. */
const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

/** Dónde vive el producto de cliente: lo que ve la PYME que paga. */
const AREAS_CLIENTE = ['pages', 'components'];

function ficherosDe(carpeta: string): string[] {
  const base = join(RAIZ, carpeta);
  const salida: string[] = [];

  const recorrer = (ruta: string) => {
    for (const entrada of readdirSync(ruta)) {
      const completa = join(ruta, entrada);
      if (statSync(completa).isDirectory()) {
        recorrer(completa);
        continue;
      }
      // Las pruebas quedan fuera: pueden nombrar una clase prohibida para comprobarla.
      if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
        salida.push(completa);
      }
    }
  };

  recorrer(base);
  return salida;
}

/**
 * La paleta de Tailwind entera.
 *
 * No se listan "los grises que se colaron": se prohíbe la familia completa. Prohibir solo lo
 * que ya apareció una vez deja pasar lo siguiente, que sera `text-slate-500` o `bg-zinc-100`.
 */
const COLOR_SUELTO =
  /(?:text|bg|border|ring|divide|from|to|via|placeholder|decoration|outline|fill|stroke|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b|\bbg-white\b|\bbg-black\b/g;

/** Los tamaños de Tailwind y los arbitrarios: la escala es la de `index.css`, y son seis. */
const TAMANO_SUELTO =
  /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b|\btext-\[[^\]]+\]/g;

describe('el sistema visual es uno solo', () => {
  it('ninguna pantalla de cliente usa colores de la paleta de Tailwind', () => {
    const infracciones: string[] = [];

    for (const area of AREAS_CLIENTE) {
      for (const fichero of ficherosDe(area)) {
        const contenido = readFileSync(fichero, 'utf8');
        for (const linea of contenido.split('\n').entries()) {
          const [indice, texto] = linea;
          for (const encontrado of texto.match(COLOR_SUELTO) ?? []) {
            infracciones.push(
              `${fichero.slice(RAIZ.length)}:${indice + 1} → ${encontrado}`,
            );
          }
        }
      }
    }

    expect(
      infracciones,
      'Usa los tokens del sistema (text-ink, text-muted, bg-surface, border-line, ' +
        'text-danger…). Están definidos en src/index.css.',
    ).toEqual([]);
  });

  it('ninguna pantalla de cliente inventa un tamaño de texto', () => {
    const infracciones: string[] = [];

    for (const area of AREAS_CLIENTE) {
      for (const fichero of ficherosDe(area)) {
        const contenido = readFileSync(fichero, 'utf8');
        for (const [indice, texto] of contenido.split('\n').entries()) {
          for (const encontrado of texto.match(TAMANO_SUELTO) ?? []) {
            infracciones.push(
              `${fichero.slice(RAIZ.length)}:${indice + 1} → ${encontrado}`,
            );
          }
        }
      }
    }

    expect(
      infracciones,
      'La escala son seis clases: t-display, t-title, t-lead, t-body, t-small, t-fine ' +
        '(y t-micro para rótulos). Están en src/index.css.',
    ).toEqual([]);
  });
});

// ── Contraste ────────────────────────────────────────────────────────────────

function canal(valor: number): number {
  const s = valor / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminancia(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * canal((n >> 16) & 255) +
    0.7152 * canal((n >> 8) & 255) +
    0.0722 * canal(n & 255)
  );
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Los valores reales de `@theme`, leídos del CSS: si alguien los cambia, esto se entera. */
function tokens(): Record<string, string> {
  const css = readFileSync(join(RAIZ, 'index.css'), 'utf8');
  const encontrados: Record<string, string> = {};
  for (const [, nombre, valor] of css.matchAll(
    /--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi,
  )) {
    encontrados[nombre] = valor;
  }
  return encontrados;
}

describe('el contraste cumple WCAG AA', () => {
  const T = tokens();
  const FONDOS = ['surface', 'canvas', 'sunken'] as const;

  it.each(['ink', 'ink-soft', 'muted', 'faint'])(
    'text-%s se lee sobre cualquier fondo del producto',
    (tinta) => {
      for (const fondo of FONDOS) {
        expect(
          contraste(T[tinta], T[fondo]),
          `text-${tinta} sobre bg-${fondo}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each([
    ['accent', 'surface'],
    ['accent', 'canvas'],
    ['accent', 'accent-soft'],
    ['positive', 'positive-soft'],
    ['attention', 'attention-soft'],
    ['danger', 'danger-soft'],
    ['danger', 'surface'],
  ])('text-%s sobre bg-%s se lee', (tinta, fondo) => {
    expect(contraste(T[tinta], T[fondo])).toBeGreaterThanOrEqual(4.5);
  });

  it('el texto de la acción principal se lee sobre su fondo', () => {
    expect(contraste('#ffffff', T.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('el borde de un campo lo identifica como campo (WCAG 1.4.11)', () => {
    // 3:1, que es lo que la norma pide para el contorno de un control. Es lo ÚNICO que dice
    // dónde hay que escribir: un campo blanco sobre tarjeta blanca no tiene nada más.
    for (const fondo of FONDOS) {
      expect(
        contraste(T['field-line'], T[fondo]),
        `border-field-line sobre bg-${fondo}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
