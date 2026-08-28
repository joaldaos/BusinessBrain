/**
 * Redacción de secretos y cálculo de cambios — subfase 6.2.
 *
 * Dominio puro: sin base de datos, sin red, determinista.
 *
 * ## Por qué la redacción no es opcional
 *
 * El registro de auditoría es el único sitio del sistema al que llega, por diseño, el
 * contenido de operaciones sensibles. Si un secreto entra aquí, entra en un almacén
 * pensado para conservarse mucho tiempo, leerse en investigaciones y a menudo exportarse.
 * Un `apiKeyEnc` filtrado a la auditoría es peor que uno filtrado a un log de aplicación:
 * los logs rotan, la auditoría no.
 *
 * Por eso la redacción es **por lista de exclusión sobre el NOMBRE de la clave**, no por
 * inspección del valor: reconocer secretos por su forma es un juego que se pierde siempre,
 * mientras que quien añada un campo llamado `apiKey` o `passwordHash` queda cubierto sin
 * hacer nada. Se aplica en profundidad, porque los secretos viajan anidados.
 */

/**
 * Palabras que, por sí solas, marcan una clave como secreta.
 *
 * Se comparan como PALABRAS, no por inclusión de subcadena. La diferencia importa: buscar
 * "token" dentro del nombre redactaría `tokensUsed` —consumo del modelo, metadato legítimo y
 * útil— y una auditoría que tacha datos inocuos se vuelve inservible tan rápido como una que
 * filtra secretos. `refreshToken` sí cae, porque una de sus palabras ES "token".
 */
const SECRET_WORDS = new Set([
  'password',
  'passphrase',
  'secret',
  'secrets',
  'token',
  'credential',
  'credentials',
  'authorization',
]);

/**
 * Palabras que convierten un "key" contiguo en secreto.
 *
 * `apiKey`, `privateKey` o `encryptionKey` son secretos; `strategyKey` y `contentKey` no lo
 * son. Sin esta lista habría que elegir entre redactar identificadores legítimos o dejar
 * pasar claves reales.
 */
const SECRET_KEY_QUALIFIERS = new Set([
  'api',
  'private',
  'encryption',
  'signing',
  'access',
  'secret',
]);

/**
 * Palabras que convierten un `code`/`codes` contiguo en secreto.
 *
 * `recoveryCode` y `backupCodes` son credenciales; `statusCode`, `errorCode` y `postalCode` no
 * lo son. Sin esta lista habría que elegir entre tachar códigos de error legítimos —que son
 * justo lo que se mira al investigar— o dejar pasar los códigos de papel de una cuenta.
 *
 * No es teórico: cuando se construyó la verificación en dos pasos, `recoveryCodes` NO estaba
 * cubierto por ninguna regla. `recovery` no es secreta y `codes` tampoco, así que una lista de
 * diez credenciales habría entrado entera y en claro en el almacén que menos rota del sistema.
 */
const SECRET_CODE_QUALIFIERS = new Set(['recovery', 'backup', 'totp', 'mfa']);

/** Formas compuestas que no se resuelven por palabras sueltas. */
const SECRET_JOINED_FRAGMENTS = ['configenc', 'keyenc', 'secretenc'] as const;

export const REDACTED = '[REDACTADO]';

/** Profundidad máxima: un objeto autorreferente no puede colgar el registro. */
const MAX_DEPTH = 6;
/** Tope de elementos por lista: la auditoría registra hechos, no vuelca datos. */
const MAX_ARRAY_ITEMS = 50;
/** Tope de longitud de un texto suelto. */
const MAX_STRING_LENGTH = 2000;

export function isSecretKey(key: string): boolean {
  const words = splitIntoWords(key);

  if (words.some((word) => SECRET_WORDS.has(word))) return true;

  // `api` + `key`, `encryption` + `key`… pero no `strategy` + `key`.
  for (const [index, word] of words.entries()) {
    if (word !== 'key' && word !== 'keys') continue;
    const qualifier = words[index - 1];
    if (qualifier && SECRET_KEY_QUALIFIERS.has(qualifier)) return true;
  }

  // `recovery` + `code`, `backup` + `codes`… pero no `status` + `code`.
  for (const [index, word] of words.entries()) {
    if (word !== 'code' && word !== 'codes') continue;
    const qualifier = words[index - 1];
    if (qualifier && SECRET_CODE_QUALIFIERS.has(qualifier)) return true;
  }

  const joined = words.join('');
  return SECRET_JOINED_FRAGMENTS.some((fragment) => joined.includes(fragment));
}

/** `apiKeyEnc` → [api, key, enc]; `ENCRYPTION_KEY` → [encryption, key]. */
function splitIntoWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0);
}

/**
 * Devuelve una copia segura de los metadatos: sin secretos, acotada en profundidad y tamaño.
 *
 * Nunca lanza. Un fallo al redactar no puede impedir que se registre el hecho auditado —
 * perder la traza sería peor que registrarla incompleta—, así que lo irreducible se
 * sustituye por una marca legible en vez de romper.
 */
export function redactAuditMetadata(value: unknown): unknown {
  return redact(value, 0);
}

function redact(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[PROFUNDIDAD_MÁXIMA]';

  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[TRUNCADO]`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redact(item, depth + 1));

    return value.length > MAX_ARRAY_ITEMS
      ? [...items, `…[${value.length - MAX_ARRAY_ITEMS} elementos más]`]
      : items;
  }

  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      // La clave manda: si el nombre huele a secreto, el valor no se mira siquiera.
      output[key] = isSecretKey(key) ? REDACTED : redact(nested, depth + 1);
    }
    return output;
  }

  // `symbol`, `function`, `bigint`: no deberían llegar a unos metadatos, y describirlos por
  // tipo es más útil que romper el registro.
  return `[${typeof value}]`;
}

export interface AuditChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Diferencia entre dos estados, registrando SOLO lo que cambió.
 *
 * Guardar el objeto entero antes y después haría crecer la auditoría sin aportar nada y
 * obligaría a quien la lee a comparar a ojo. Lo que responde a "qué cambió" es la
 * diferencia, no las dos fotos.
 *
 * Los valores pasan por la misma redacción: un cambio de campo secreto se registra como que
 * hubo cambio, nunca con el valor.
 */
export function diffForAudit(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditChanges {
  const source = before ?? {};
  const target = after ?? {};
  const keys = new Set([...Object.keys(source), ...Object.keys(target)]);

  const changes: AuditChanges = { before: {}, after: {} };

  for (const key of keys) {
    const previous = source[key];
    const next = target[key];
    // `undefined` en el estado nuevo significa "no se tocó", no "se puso a nulo": las
    // actualizaciones parciales llegan así y registrarlas como borrados sería mentir.
    if (next === undefined) continue;
    if (equivalent(previous, next)) continue;

    // Solo se registra el "antes" si la clave existía: en una creación no hay estado
    // previo, y anotarlo como nulo inventaría un borrado que nunca ocurrió.
    if (key in source) {
      changes.before[key] = isSecretKey(key) ? REDACTED : redact(previous, 0);
    }
    changes.after[key] = isSecretKey(key) ? REDACTED : redact(next, 0);
  }

  return changes;
}

/** ¿Ha cambiado algo? Evita registrar actualizaciones que no actualizan nada. */
export function hasChanges(changes: AuditChanges): boolean {
  return Object.keys(changes.after).length > 0;
}

function equivalent(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (a === null || b === null || a === undefined || b === undefined) {
    return false;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
