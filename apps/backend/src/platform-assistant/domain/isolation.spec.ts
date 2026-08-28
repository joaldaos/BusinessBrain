import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PlatformAccessScope } from '@businessbrain/database';
import {
  ASSISTANT_TOOLS,
  TOOL_LIST,
  resolveTool,
  sanitizeInput,
} from './tools';
import { buildSystemPrompt } from './system-prompt';

/**
 * Que el asistente NO PUEDA, no que no deba.
 *
 * ## Por qué estas pruebas leen ficheros
 *
 * Porque la garantía que sostiene esta fase no es de comportamiento, es de existencia: el
 * asistente no lee los documentos de una empresa porque **no hay código que los lea**. Una
 * prueba de comportamiento diría "en este caso no los leyó"; estas dicen "no hay forma".
 *
 * Es lo único que aguanta un modelo manipulado. Un prompt hostil puede convencer a un modelo
 * de que pida `execute_sql`; no puede hacer que exista.
 */

const MODULO = join(__dirname, '..');

function ficherosDelAsistente(): Array<{ ruta: string; contenido: string }> {
  const encontrados: Array<{ ruta: string; contenido: string }> = [];

  const recorrer = (directorio: string) => {
    for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
      const ruta = join(directorio, entrada.name);
      if (entrada.isDirectory()) {
        recorrer(ruta);
      } else if (
        entrada.name.endsWith('.ts') &&
        !entrada.name.endsWith('.spec.ts')
      ) {
        encontrados.push({
          ruta: entrada.name,
          contenido: readFileSync(ruta, 'utf8'),
        });
      }
    }
  };

  recorrer(MODULO);
  return encontrados;
}

/** El código, sin comentarios: explicar por qué no se usa Prisma exige escribir "Prisma". */
function codigoDe(contenido: string): string {
  return contenido.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('lo que el asistente no puede alcanzar', () => {
  it('CRÍTICO: no conoce Prisma ni la base de datos', () => {
    const culpables = ficherosDelAsistente()
      .filter(({ contenido }) =>
        /\bPrismaService\b|\bPrismaClient\b|prisma\./.test(codigoDe(contenido)),
      )
      .map(({ ruta }) => ruta);

    expect(culpables).toEqual([]);
  });

  it('CRÍTICO: no puede ejecutar SQL', () => {
    const culpables = ficherosDelAsistente()
      .filter(({ contenido }) =>
        /\$queryRaw|\$executeRaw|\bSELECT\s|\bINSERT\s|\bDELETE\s+FROM\b/i.test(
          codigoDe(contenido),
        ),
      )
      .map(({ ruta }) => ruta);

    expect(culpables).toEqual([]);
  });

  it('CRÍTICO: no puede salir a la red por su cuenta', () => {
    // El único camino hacia fuera es el proveedor de modelo, que resuelve `ProviderRegistry` y
    // apunta a donde diga el perfil de plataforma. Ni `fetch`, ni cliente HTTP, ni URLs.
    const culpables = ficherosDelAsistente()
      .filter(({ contenido }) =>
        /\bfetch\(|HttpClientPort|axios|https?:\/\//.test(codigoDe(contenido)),
      )
      .map(({ ruta }) => ruta);

    expect(culpables).toEqual([]);
  });

  it('CRÍTICO: no lee el entorno ni el sistema de ficheros', () => {
    const culpables = ficherosDelAsistente()
      .filter(({ contenido }) =>
        /process\.env|readFileSync|writeFileSync|node:fs/.test(
          codigoDe(contenido),
        ),
      )
      .map(({ ruta }) => ruta);

    expect(culpables).toEqual([]);
  });

  it('CRÍTICO: no nombra ningún secreto', () => {
    const prohibidos = [
      'passwordHash',
      'mfaSecretEnc',
      'totpSecret',
      'recoveryCode',
      'tokenHash',
      'codeHash',
      'configEnc',
      'apiKeyEnc',
      'EncryptionService',
    ];

    const encontrados: Array<[string, string]> = [];
    for (const { ruta, contenido } of ficherosDelAsistente()) {
      const codigo = codigoDe(contenido);
      for (const prohibido of prohibidos) {
        if (new RegExp(`\\b${prohibido}\\b`).test(codigo)) {
          encontrados.push([ruta, prohibido]);
        }
      }
    }

    expect(encontrados).toEqual([]);
  });

  it('CRÍTICO: no puede leer el contenido de ninguna empresa', () => {
    /**
     * La decisión más importante del catálogo.
     *
     * `CONTENT` existe como alcance, con su aprobación del propietario y su ruta en el panel.
     * El asistente no la alcanza: leer lo que una empresa escribió es un acto que hace una
     * persona, dejando su nombre en la traza documento a documento. Detrás de una pregunta en
     * lenguaje natural, "¿qué le pasa a este cliente?" se convertiría en una lectura de sus
     * contratos.
     */
    const alcances: string[] = TOOL_LIST.flatMap((tool) =>
      tool.permission.kind === 'GRANT' ? [tool.permission.scope] : [],
    );

    // Los alcances que el asistente puede alcanzar son EXACTAMENTE estos dos.
    expect([...new Set(alcances)].sort()).toEqual([
      PlatformAccessScope.DIAGNOSTICS,
      PlatformAccessScope.METADATA,
    ]);
    expect(alcances).not.toContain(PlatformAccessScope.CONTENT);

    // Y ninguna consulta del ejecutor pide documentos ni su texto.
    const culpables = ficherosDelAsistente()
      .filter(({ contenido }) =>
        /\bdocuments?\b|contentText|knowledgeItem/i.test(codigoDe(contenido)),
      )
      .map(({ ruta }) => ruta);

    expect(culpables).toEqual([]);
  });

  it('CRÍTICO: ninguna herramienta escribe', () => {
    // Ni una sola menciona un verbo de escritura. El asistente no ejecuta acciones
    // administrativas porque no existe la que las ejecutaría.
    const escrituras =
      /\b(create|update|delete|revoke|approve|ban|unban|changePlan|removeBy|setBanned|request)\s*\(/;

    const culpables = ficherosDelAsistente()
      .filter(({ contenido }) => escrituras.test(codigoDe(contenido)))
      .map(({ ruta }) => ruta);

    expect(culpables).toEqual([]);
  });
});

describe('el catálogo cerrado', () => {
  it('son exactamente estas seis', () => {
    // Lista literal, a propósito: añadir una herramienta obliga a tocar esta prueba, y tocarla
    // obliga a mirar si de verdad debe existir. Un `expect` que se adaptara solo no protegería
    // de nada.
    expect(TOOL_LIST.map((tool) => tool.name).sort()).toEqual([
      'list_organizations',
      'my_access',
      'organization_diagnostics',
      'organization_metadata',
      'platform_audit',
      'platform_overview',
    ]);
  });

  it('CRÍTICO: lo que no está en el catálogo no se resuelve', () => {
    for (const inventada of [
      'execute_sql',
      'read_documents',
      'organization_content',
      'http_get',
      'change_plan',
      'approve_access',
      'PLATFORM_OVERVIEW',
      '',
      null,
      undefined,
      42,
      { name: 'platform_overview' },
    ]) {
      expect(resolveTool(inventada)).toBeNull();
    }
  });

  it('las dos que tocan datos de una empresa exigen su alcance, y son distintos', () => {
    expect(ASSISTANT_TOOLS.ORGANIZATION_METADATA.permission).toEqual({
      kind: 'GRANT',
      scope: PlatformAccessScope.METADATA,
    });
    expect(ASSISTANT_TOOLS.ORGANIZATION_DIAGNOSTICS.permission).toEqual({
      kind: 'GRANT',
      scope: PlatformAccessScope.DIAGNOSTICS,
    });
  });

  it('CRÍTICO: "mis accesos" no acepta un identificador de persona', () => {
    // Es lo que impide que el modelo pida los accesos de otro administrador: no hay parámetro
    // donde escribir ese identificador. El ejecutor lo toma del token.
    expect(ASSISTANT_TOOLS.MY_ACCESS.parameters).toEqual([]);

    const colado = sanitizeInput(ASSISTANT_TOOLS.MY_ACCESS, {
      adminId: 'otro-administrador',
      userId: 'otro',
      requestedById: 'otro',
    });
    expect(colado).toEqual({});
  });

  it('CRÍTICO: los parámetros van por lista blanca', () => {
    const limpio = sanitizeInput(ASSISTANT_TOOLS.ORGANIZATION_METADATA, {
      organizationId: 'org-1',
      // Todo lo demás se descarta: un parámetro inventado que casualmente coincidiera con un
      // campo de una consulta cambiaría lo que devuelve.
      scope: 'CONTENT',
      adminId: 'otro',
      includeContent: true,
      limit: 99999,
    });

    expect(limpio).toEqual({ organizationId: 'org-1' });
  });

  it('descarta valores absurdos sin romperse', () => {
    for (const basura of [null, undefined, 'texto', 42, []]) {
      expect(sanitizeInput(ASSISTANT_TOOLS.LIST_ORGANIZATIONS, basura)).toEqual(
        {},
      );
    }
  });
});

describe('la instrucción del sistema', () => {
  it('describe el catálogo REAL, no una lista escrita a mano', () => {
    const prompt = buildSystemPrompt({ locale: 'es', adminName: 'Ana' });

    for (const tool of TOOL_LIST) {
      expect(prompt).toContain(tool.name);
    }
  });

  it('dice en qué idioma responder', () => {
    expect(buildSystemPrompt({ locale: 'en', adminName: 'Ana' })).toContain(
      'en',
    );
  });

  it('CRÍTICO: si esta instrucción desapareciera, el sistema seguiría siendo seguro', () => {
    /**
     * No se puede comprobar en una prueba que un texto no protege. Lo que sí se puede es
     * comprobar que el texto NO es el único sitio donde vive una garantía: el catálogo es
     * cerrado, `resolveTool` falla cerrado, los parámetros van por lista blanca y ninguna
     * herramienta escribe — y todo eso está probado arriba, sin mirar el prompt.
     *
     * Esta prueba deja constancia de la relación: el prompt es orientación para que el
     * asistente sea útil, no una barrera.
     */
    const prompt = buildSystemPrompt({ locale: 'es', adminName: 'Ana' });

    // Aunque el prompt prometa cosas, el catálogo manda.
    expect(resolveTool('read_documents')).toBeNull();
    expect(prompt.length).toBeGreaterThan(0);
  });
});
