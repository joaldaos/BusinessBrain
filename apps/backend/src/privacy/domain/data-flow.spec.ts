import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AI_PROVIDER_DATA_FLOWS, STORED_DATA } from './data-flow';

/**
 * El aviso de privacidad no puede quedarse corto sin que nadie se entere.
 *
 * Esta prueba recorre el código buscando TODA llamada al proveedor de IA y comprueba que cada
 * una está declarada en `data-flow.ts`. Añadir una llamada nueva —una función que resuma, que
 * traduzca, que clasifique— rompe esta prueba y obliga a decir en voz alta qué información
 * sale de la empresa.
 *
 * Es la diferencia entre un aviso que alguien se acuerda de actualizar y uno que no puede
 * quedarse desactualizado.
 */

const SRC = join(__dirname, '..', '..');

/** Las llamadas que sacan información fuera: completar, transmitir y vectorizar. */
const CALL_PATTERNS = [/\.complete\(/, /\.stream\(/, /\.embed\(/];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

/**
 * Ficheros que llaman al proveedor.
 *
 * Se excluyen los adaptadores del propio proveedor y el puerto: ahí es donde se DEFINE la
 * llamada, no donde se decide mandar información de una empresa.
 */
function filesCallingTheProvider(): string[] {
  return sourceFiles(SRC)
    .filter((file) => {
      const ruta = relative(SRC, file).split(sep).join('/');
      return (
        !ruta.startsWith('llm/infrastructure/') &&
        !ruta.startsWith('llm/domain/') &&
        !ruta.includes('provider-registry')
      );
    })
    .filter((file) => {
      const source = readFileSync(file, 'utf8');
      return CALL_PATTERNS.some((pattern) => pattern.test(source));
    })
    .map((file) => relative(SRC, file).split(sep).join('/'));
}

describe('lo que sale hacia el proveedor de IA está declarado', () => {
  const declarados = AI_PROVIDER_DATA_FLOWS.map((flow) => flow.callSite);
  const reales = filesCallingTheProvider();

  it('la prueba encuentra código que revisar', () => {
    expect(reales.length).toBeGreaterThan(0);
  });

  it('CRÍTICO: no hay ninguna llamada al proveedor sin declarar', () => {
    // Si esto falla, alguien añadió una salida de información de la empresa y el aviso de
    // privacidad se quedó corto. La solución NO es ampliar la exclusión: es declararla.
    const sinDeclarar = reales.filter((file) => !declarados.includes(file));

    expect(sinDeclarar).toEqual([]);
  });

  it('no se declara una salida que ya no existe', () => {
    // Un aviso que menciona algo que dejó de ocurrir también es un aviso falso.
    const sobran = declarados.filter((file) => !reales.includes(file));

    expect(sobran).toEqual([]);
  });

  it('cada salida dice QUÉ sale y QUÉ la provoca, sin jerga', () => {
    for (const flow of AI_PROVIDER_DATA_FLOWS) {
      expect(flow.what.length).toBeGreaterThan(20);
      expect(flow.trigger.length).toBeGreaterThan(10);
      expect(flow.what).not.toMatch(
        /embedding|prompt|token|chunk|use-case|endpoint/i,
      );
    }
  });

  it('lo que se guarda también está dicho para una persona', () => {
    expect(STORED_DATA.length).toBeGreaterThan(0);
    for (const item of STORED_DATA) {
      expect(item.detail).not.toMatch(/prisma|schema|json|nullable/i);
    }
  });
});
