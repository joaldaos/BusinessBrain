import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * El código de seis dígitos que cambia cada treinta segundos — RFC 6238 (TOTP) sobre RFC 4226
 * (HOTP).
 *
 * ## Por qué está escrito aquí y no traído de una librería
 *
 * Normalmente escribir criptografía a mano es la peor decisión posible, y esta es la excepción
 * concreta que hay: **el RFC publica vectores de prueba**. Esto no es "confío en que mi HMAC
 * esté bien", es una función determinista cuyas salidas están tabuladas en un estándar y que
 * `totp.spec.ts` comprueba contra esa tabla. Si un dígito estuviera mal, ninguna aplicación
 * autenticadora del mundo funcionaría con nosotros y la prueba lo diría antes.
 *
 * A cambio: no hay una dependencia más en el arranque de autenticación, que es exactamente
 * donde menos ganas dan las dependencias.
 *
 * ## SHA-1, y no es un descuido
 *
 * TOTP con SHA-1 es lo que implementan Google Authenticator, Authy, 1Password, Microsoft
 * Authenticator y el gestor de contraseñas de cualquier móvil. El estándar admite SHA-256, y
 * elegirlo dejaría a una PYME con una aplicación que muestra códigos que no funcionan. La
 * debilidad conocida de SHA-1 es la colisión, que aquí no aplica: esto es un HMAC sobre un
 * contador, y lo que protege es un secreto de 160 bits durante treinta segundos.
 *
 * ## La ventana de tolerancia
 *
 * Se aceptan el paso actual, el anterior y el siguiente: hasta noventa segundos. Sin margen,
 * un móvil con el reloj unos segundos desviado —lo normal— no podría entrar nunca, y el
 * usuario no tendría forma de saber por qué. Con margen, quien roba un código tiene minuto y
 * medio en lugar de treinta segundos para usarlo; a cambio de que el producto funcione.
 */

/** Cada cuánto cambia el código. Treinta segundos: lo que asumen todas las aplicaciones. */
export const TOTP_STEP_SECONDS = 30;
/** Dígitos del código. Seis: igual. */
export const TOTP_DIGITS = 6;
/** Pasos de tolerancia a cada lado. Ver arriba. */
export const TOTP_WINDOW = 1;

/** Longitud del secreto: 20 bytes = 160 bits, lo que recomienda el RFC 4226 §4. */
const SECRET_BYTES = 20;

// ── Base32, porque es el alfabeto que hablan las aplicaciones ────────────────
//
// El secreto viaja al móvil dentro de una URL `otpauth://` y se teclea a mano cuando la cámara
// falla. Base64 no vale: distingue mayúsculas de minúsculas y usa `+` y `/`, que en una URL hay
// que escapar y a mano se equivocan. Base32 (RFC 4648) es mayúsculas y dígitos sin `0`, `1`,
// `8` ni `9` — no hay forma de confundir una O con un cero.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Descodifica base32.
 *
 * Tolerante con lo que escribe una persona: acepta minúsculas, espacios y el relleno `=` que
 * algunas aplicaciones añaden. Un secreto rechazado por llevar un espacio sería un fallo
 * incomprensible para quien lo ha copiado de la pantalla.
 */
export function decodeBase32(encoded: string): Buffer {
  const clean = encoded.toUpperCase().replace(/[\s=]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) {
      throw new Error('El secreto no está en base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** Un secreto nuevo, ya en el alfabeto que entiende la aplicación autenticadora. */
export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(SECRET_BYTES));
}

/**
 * El código para un contador concreto — HOTP, RFC 4226 §5.3.
 *
 * El "truncamiento dinámico" del final no es adorno: el último medio byte del HMAC elige desde
 * qué posición se leen los cuatro bytes que se convierten en número. Coger siempre los cuatro
 * primeros dejaría el código dependiendo de una parte fija del HMAC.
 */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  // El contador es de 64 bits. `writeUInt32BE` en las dos mitades evita `BigInt` y sirve hasta
  // el año 2106, que es suficiente margen.
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/** El código válido AHORA para este secreto. */
export function totp(secretBase32: string, at: Date = new Date()): string {
  return hotp(decodeBase32(secretBase32), counterFor(at));
}

function counterFor(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/**
 * ¿Es este el código?
 *
 * Compara en tiempo constante contra cada paso de la ventana. Una comparación normal se detiene
 * en el primer dígito distinto, y con seis dígitos y millones de intentos esa diferencia de
 * tiempo es medible.
 *
 * Fail-closed ante cualquier entrada rara: lo que no sean exactamente seis dígitos no se
 * compara siquiera. Un secreto mal guardado tampoco deja pasar a nadie — si descodificarlo
 * falla, la respuesta es `false`, nunca una excepción que alguien pudiera capturar y
 * confundir con un permiso.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  at: Date = new Date(),
): boolean {
  const candidate = code.trim();
  if (!/^\d{6}$/.test(candidate)) return false;

  let secret: Buffer;
  try {
    secret = decodeBase32(secretBase32);
  } catch {
    return false;
  }
  if (secret.length === 0) return false;

  const counter = counterFor(at);
  let matched = false;

  // Se recorre la ventana ENTERA aunque ya haya coincidencia: salir antes haría que el tiempo
  // de respuesta delatara en qué paso estaba el código.
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift += 1) {
    if (equalsInConstantTime(hotp(secret, counter + drift), candidate)) {
      matched = true;
    }
  }

  return matched;
}

function equalsInConstantTime(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(actual, 'utf8'),
  );
}

/**
 * La URL que se convierte en código QR — formato `otpauth://`, de facto desde Google
 * Authenticator.
 *
 * El `label` lleva emisor y cuenta (`BusinessBrain:ana@empresa.es`) porque es lo que la persona
 * ve en la lista de su aplicación. Quien tiene tres cuentas de tres productos necesita
 * distinguirlas, y "Cuenta 2" no distingue nada.
 */
export function otpauthUrl(params: {
  secret: string;
  account: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? 'BusinessBrain';
  const label = encodeURIComponent(`${issuer}:${params.account}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });

  return `otpauth://totp/${label}?${query.toString()}`;
}

/**
 * El secreto tal y como se enseña para teclearlo a mano.
 *
 * En grupos de cuatro. Treinta y dos caracteres seguidos se teclean mal; en ocho grupos de
 * cuatro se sigue con la vista. Los espacios los quita `decodeBase32`.
 */
export function formatSecretForManualEntry(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}
