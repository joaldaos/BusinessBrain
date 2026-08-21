import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Proponer nunca ejecuta" como garantía ESTRUCTURAL, no como promesa.
 *
 * El resto de pruebas comprueban el comportamiento: que aceptar solo cambia el estado y deja
 * traza. Esta comprueba algo distinto y más duradero — que **no existe el camino de código**.
 * Un módulo que no importa agentes, herramientas, automatizaciones ni un cliente HTTP no puede
 * ejecutar una acción externa aunque alguien lo intentara: tendría que añadir la dependencia
 * primero, y entonces esta prueba falla y obliga a justificarlo.
 *
 * Es la diferencia entre una regla que hay que recordar y una que el código impide romper.
 */

const MODULE_DIR = join(__dirname);

/** Lo que daría capacidad de ejecutar algo fuera de BusinessBrain. */
const FORBIDDEN_IMPORTS = [
  // Herramientas de agente: el único mecanismo del sistema que ejecuta acciones.
  'agents/',
  'AgentToolLoop',
  'ExecuteAgentTool',
  // Automatizaciones: ejecutan acciones sin nadie delante.
  'automations/',
  // Integraciones externas: Google, correo, terceros.
  'integrations/',
  // Cualquier salida a la red por su cuenta.
  'http-client.port',
  'FetchHttpClient',
];

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

describe('el módulo de recomendaciones no puede ejecutar nada', () => {
  const files = sourceFiles(MODULE_DIR);

  it('hay código que revisar (la prueba no pasa por estar vacía)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_IMPORTS)(
    'CRÍTICO: nada del módulo importa "%s"',
    (forbidden) => {
      const offenders = files.filter((file) => {
        const source = readFileSync(file, 'utf8');
        // Solo las líneas de importación: mencionarlo en un comentario explicando por qué NO
        // se importa es exactamente lo que queremos que siga siendo posible.
        return source
          .split('\n')
          .filter((line) => line.trimStart().startsWith('import'))
          .some((line) => line.includes(forbidden));
      });

      expect(offenders).toEqual([]);
    },
  );

  it('CRÍTICO: no existe una ruta para CREAR una recomendación', () => {
    // Una `Recommendation` solo nace del análisis o de escalar una conclusión curada. Un
    // endpoint de creación sería un generador paralelo de propuestas sin trazabilidad hasta la
    // comprensión que las sostiene.
    const controller = readFileSync(
      join(MODULE_DIR, 'api', 'recommendations.controller.ts'),
      'utf8',
    );

    // `@Post()` a secas es la ruta de creación; las que sí existen llevan camino.
    expect(controller).not.toMatch(/@Post\(\)\s/);
    expect(controller).toMatch(/@Post\(':recommendationId\/accept'\)/);
    expect(controller).toMatch(/@Post\(':recommendationId\/dismiss'\)/);
  });

  it('CRÍTICO: los únicos estados posibles son pendiente y decidida', () => {
    // No existe "ejecutada", y no debe existir: el sistema no ejecuta nada por su cuenta. Si
    // algún día apareciera un estado nuevo, esta prueba obliga a justificarlo.
    const service = readFileSync(
      join(MODULE_DIR, 'application', 'recommendations.service.ts'),
      'utf8',
    );
    const estados = [
      ...new Set(
        [...service.matchAll(/RecommendationStatus\.([A-Z_]+)/g)].map(
          (match) => match[1],
        ),
      ),
    ].sort();

    expect(estados).toEqual(['ACCEPTED', 'DISMISSED', 'NEW']);
  });
});
