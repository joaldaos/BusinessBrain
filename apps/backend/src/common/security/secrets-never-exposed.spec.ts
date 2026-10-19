import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Ningún secreto puede salir del backend. Comprobado leyendo el código, no confiando.
 *
 * ## Por qué esta prueba se escribe sola
 *
 * La lista de columnas que guardan secretos **se saca del propio esquema**: toda columna
 * cuyo nombre acaba en `Enc` guarda algo cifrado. Añadir mañana un `webhookSecretEnc` lo
 * mete en esta prueba sin que nadie se acuerde de ampliarla.
 *
 * Es la misma idea que la prueba del aviso de privacidad: la diferencia entre una garantía
 * que alguien tiene que recordar y una que no se puede olvidar.
 *
 * ## Qué se permite, y por qué tan poco
 *
 * Un puñado de ficheros SÍ tiene que nombrar esas columnas: los que cifran y descifran. Están
 * declarados uno a uno. Todo lo demás —controladores, proyecciones, superficie de plataforma,
 * exportaciones— no puede mencionarlas siquiera.
 *
 * Si esta prueba falla, la respuesta NO es añadir el fichero a la lista: es dejar de leer el
 * secreto ahí.
 */

const SRC = join(__dirname, '..', '..');
const SCHEMA = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'database',
  'prisma',
  'schema.prisma',
);

/**
 * Los ficheros que legítimamente manejan secretos: los que los cifran, los descifran o los
 * custodian. Ninguno los DEVUELVE.
 */
const CUSTODIOS = [
  'common/utils/encryption.util.ts',
  'auth/application/mfa.service.ts',
  'integrations/application/integrations.service.ts',
  'knowledge-engine/application/knowledge-sources.service.ts',
  'knowledge-engine/application/ingest-from-source.use-case.ts',
  'llm/application/ai-configuration.service.ts',
  'llm/application/provider-registry.service.ts',
  'connectors/application/run-connector-sync.use-case.ts',
];

/**
 * El código, sin comentarios ni literales de texto.
 *
 * Se mira lo que el programa HACE, no lo que dice. Hay dos clases de mención inofensiva, y
 * las dos conviene fomentarlas en vez de castigarlas:
 *
 * - **Comentarios que explican la garantía**: «`configEnc` NO: lleva credenciales dentro».
 * - **Cadenas de texto**: un mensaje de arranque que nombra las columnas que protege la
 *   clave maestra, o una prueba que comprueba que la propiedad NO viene.
 *
 * Una fuga de verdad no cabe en ninguna de las dos: es `select: { secretEnc: true }` o
 * `fila.secretEnc`, y eso sigue vigilado. Marcar la prosa empujaría a borrarla para que la
 * prueba pase, que es el peor resultado posible.
 */
function code(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/**
 * Solo código de producción.
 *
 * Las pruebas que nombran una columna cifrada lo hacen para exigir que NO aparezca en una
 * respuesta: son aliadas de esta garantía, no infractoras. Y ninguna prueba sirve una
 * respuesta a nadie.
 */
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

/** Toda columna cifrada declarada en el esquema. Se lee del esquema, no de una lista. */
function secretColumns(): string[] {
  const schema = readFileSync(SCHEMA, 'utf8');
  const nombres = new Set<string>();
  for (const linea of schema.split('\n')) {
    const match = /^\s{2}(\w*Enc)\s+String/.exec(linea);
    if (match?.[1]) nombres.add(match[1]);
  }
  return [...nombres];
}

describe('los secretos no salen del backend', () => {
  const columnas = secretColumns();

  it('la prueba sabe qué columnas vigilar', () => {
    // Si el esquema cambia de convención y deja de haber columnas `*Enc`, esta prueba
    // dejaría de comprobar nada sin fallar. Esto lo impide.
    expect(columnas.length).toBeGreaterThanOrEqual(4);
    expect(columnas).toEqual(expect.arrayContaining(['secretEnc']));
  });

  it('CRÍTICO: solo los custodios declarados nombran una columna cifrada', () => {
    const patron = new RegExp(`\\b(${columnas.join('|')})\\b`);

    const infractores = sourceFiles(SRC)
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .filter((ruta) => !CUSTODIOS.includes(ruta))
      .filter((ruta) =>
        patron.test(code(readFileSync(join(SRC, ruta), 'utf8'))),
      );

    // Si esto falla, la solución NO es ampliar CUSTODIOS: es dejar de leer el secreto ahí.
    expect(infractores).toEqual([]);
  });

  it('no se declara como custodio un fichero que ya no existe', () => {
    const reales = new Set(
      sourceFiles(SRC).map((file) => relative(SRC, file).split(sep).join('/')),
    );
    const fantasmas = CUSTODIOS.filter((ruta) => !reales.has(ruta));

    // Un permiso que sobrevive al fichero que lo justificaba acaba cubriendo a otro.
    expect(fantasmas).toEqual([]);
  });

  /**
   * La superficie de plataforma puede diagnosticar una integración sin poder leer su
   * secreto. Es la decisión 6, y aquí queda comprobada en vez de prometida.
   */
  it('CRÍTICO: la superficie de plataforma no menciona ninguna columna cifrada', () => {
    const patron = new RegExp(`\\b(${columnas.join('|')})\\b`);

    const platform = sourceFiles(SRC)
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .filter((ruta) => ruta.startsWith('platform'))
      .filter((ruta) =>
        patron.test(code(readFileSync(join(SRC, ruta), 'utf8'))),
      );

    expect(platform).toEqual([]);
  });

  /**
   * El contenido de un trabajo de la cola se guarda EN CLARO y se lee al diagnosticar.
   * Meter ahí un token sería dejarlo escrito en una tabla que mira cualquiera con acceso a
   * la base.
   */
  it('CRÍTICO: la cola advierte de que su contenido no es sitio para secretos', () => {
    const puerto = readFileSync(
      join(SRC, 'jobs/domain/ports/job-queue.port.ts'),
      'utf8',
    );

    expect(puerto).toMatch(/nunca secretos/i);
  });
});
