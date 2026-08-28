import { PlatformAccessScope } from '@businessbrain/database';

/**
 * Lo que el asistente PUEDE hacer. Todo lo demás no existe.
 *
 * ## La regla que sostiene esta fase entera
 *
 * **La seguridad no está en el prompt.** Un modelo puede equivocarse, y puede ser manipulado
 * por lo que le llegue dentro de una pregunta o dentro de un dato. Si lo único que le impide
 * leer los documentos de una empresa fuera una instrucción escrita en su sistema, bastaría con
 * escribir una instrucción más convincente.
 *
 * Aquí lo que le impide leerlos es que **no hay herramienta que los lea**. No es que se le
 * deniegue: es que no existe el código. La respuesta a "muéstrame los documentos de esta
 * empresa" no depende de que el modelo obedezca, depende de que no haya nada que ejecutar.
 *
 * ## Por eso NO hay herramienta de contenido
 *
 * Es la decisión más importante del catálogo y conviene decirla en voz alta. `CONTENT` existe
 * como alcance, tiene su aprobación del propietario y su ruta en el panel — y el asistente no
 * la alcanza. Leer lo que una empresa escribió es un acto que hace una persona, mirando,
 * dejando su nombre en la traza documento a documento. Ponerlo detrás de una pregunta en
 * lenguaje natural convertiría "¿qué le pasa a este cliente?" en una lectura de sus contratos.
 *
 * ## Y por qué cada herramienta declara su alcance aquí
 *
 * Porque así la pregunta "¿qué permisos necesita esto?" se responde leyendo una tabla, no
 * siguiendo llamadas por tres ficheros. Quien añada una herramienta tiene que escribir su
 * alcance en la misma línea en que la declara — y una prueba comprueba que el ejecutor exige
 * exactamente el que dice el catálogo.
 */

/** Qué hace falta para ejecutar una herramienta. */
export type ToolPermission =
  /** Nada más allá de ser administrador: son datos de la propia plataforma. */
  | { kind: 'PLATFORM' }
  /** Una concesión vigente de ESE alcance, a nombre de quien pregunta. */
  | { kind: 'GRANT'; scope: PlatformAccessScope };

export interface ToolDefinition {
  name: string;
  /** Qué responde. Va al modelo y a la pantalla: se lee igual en los dos sitios. */
  purpose: string;
  /** Los parámetros que acepta. Cualquier otro se descarta antes de ejecutar. */
  parameters: readonly string[];
  permission: ToolPermission;
}

export const ASSISTANT_TOOLS = {
  /** Los números del producto entero. De aquí no se deduce nada de ningún cliente. */
  PLATFORM_OVERVIEW: {
    name: 'platform_overview',
    purpose:
      'Cuántas empresas y personas hay en BusinessBrain, cuántas cuentas están bloqueadas y cómo se reparten las empresas por plan.',
    parameters: [],
    permission: { kind: 'PLATFORM' },
  },

  /** La cartera de clientes: identidad, plan, tamaño. Nada de dentro de ninguna. */
  LIST_ORGANIZATIONS: {
    name: 'list_organizations',
    purpose:
      'La lista de empresas cliente con su plan, cuánta gente tienen y cuántos documentos manejan. No dice nada de lo que contienen esos documentos.',
    parameters: ['page'],
    permission: { kind: 'PLATFORM' },
  },

  /** Dentro de UNA empresa, en metadatos. Exige concesión. */
  ORGANIZATION_METADATA: {
    name: 'organization_metadata',
    purpose:
      'De una empresa concreta: cuántos documentos y colecciones tiene, qué fuentes ha conectado y en qué estado están. Necesita un acceso concedido a los datos generales de esa empresa.',
    parameters: ['organizationId'],
    permission: { kind: 'GRANT', scope: PlatformAccessScope.METADATA },
  },

  /** Por qué algo le falla a UNA empresa. Exige concesión, y otra distinta. */
  ORGANIZATION_DIAGNOSTICS: {
    name: 'organization_diagnostics',
    purpose:
      'De una empresa concreta: qué sincronizaciones han fallado y con qué error técnico. Necesita un acceso concedido al diagnóstico de esa empresa, que es distinto del de datos generales.',
    parameters: ['organizationId'],
    permission: { kind: 'GRANT', scope: PlatformAccessScope.DIAGNOSTICS },
  },

  /** Los accesos de quien pregunta. Nunca los de otro. */
  MY_ACCESS: {
    name: 'my_access',
    purpose:
      'Qué accesos tiene abiertos ahora mismo quien pregunta, sobre qué empresas, con qué alcance y hasta cuándo. Solo los suyos.',
    parameters: [],
    permission: { kind: 'PLATFORM' },
  },

  /** La traza administrativa. Sale de la lista cerrada de la Fase 2. */
  PLATFORM_AUDIT: {
    name: 'platform_audit',
    purpose:
      'Qué se ha hecho desde la administración de BusinessBrain: quién, qué, sobre qué empresa y cuándo. No incluye la actividad de las empresas, que es suya.',
    parameters: ['page', 'code', 'organizationId'],
    permission: { kind: 'PLATFORM' },
  },
} as const satisfies Record<string, ToolDefinition>;

export type AssistantTool =
  (typeof ASSISTANT_TOOLS)[keyof typeof ASSISTANT_TOOLS];

export const TOOL_LIST: readonly AssistantTool[] =
  Object.values(ASSISTANT_TOOLS);

/**
 * Resuelve un nombre pedido por el modelo contra el catálogo.
 *
 * Devuelve `null` para cualquier cosa que no esté. No lanza y no se aproxima: pedir
 * `organization_content`, `read_documents` o `execute_sql` da exactamente lo mismo que pedir
 * una cadena vacía — nada.
 */
export function resolveTool(name: unknown): AssistantTool | null {
  if (typeof name !== 'string') return null;
  return TOOL_LIST.find((tool) => tool.name === name) ?? null;
}

/**
 * Se queda con los parámetros que la herramienta declara y descarta el resto.
 *
 * Lista blanca, no lista negra. El modelo compone este objeto y puede meter cualquier clave;
 * si se pasara tal cual a la capa de aplicación, un parámetro inventado que casualmente
 * coincidiera con un campo de una consulta cambiaría lo que devuelve. Aquí lo que no está
 * declarado no llega.
 */
export function sanitizeInput(
  tool: AssistantTool,
  input: unknown,
): Record<string, string> {
  if (typeof input !== 'object' || input === null) return {};

  const dado = input as Record<string, unknown>;
  const limpio: Record<string, string> = {};

  for (const parametro of tool.parameters) {
    const valor = dado[parametro];
    if (typeof valor === 'string' && valor.length > 0 && valor.length <= 200) {
      limpio[parametro] = valor;
    } else if (typeof valor === 'number' && Number.isFinite(valor)) {
      limpio[parametro] = String(valor);
    }
  }

  return limpio;
}

/**
 * Motivos por los que una herramienta no llegó a ejecutarse.
 *
 * Códigos estables, no frases: la interfaz los traduce. Es lo que permite que el panel
 * funcione en castellano y en inglés sin que el asistente sepa nada de idiomas.
 */
export const TOOL_OUTCOMES = {
  /** El modelo pidió algo que no existe en el catálogo. */
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  /** Existe, pero hace falta una concesión que quien pregunta no tiene. */
  NEEDS_GRANT: 'NEEDS_GRANT',
  /** Falta un parámetro obligatorio. */
  MISSING_PARAMETER: 'MISSING_PARAMETER',
  /** Se ejecutó. */
  OK: 'OK',
} as const;

export type ToolOutcome = (typeof TOOL_OUTCOMES)[keyof typeof TOOL_OUTCOMES];
