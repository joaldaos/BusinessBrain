import { createHmac, randomBytes } from 'node:crypto';

/**
 * Los códigos de papel: la única salida cuando el móvil se ha perdido.
 *
 * ## Se enseñan una vez y no vuelven a existir
 *
 * De cada código guardamos su HMAC, nunca el código. No hay ninguna ruta que los devuelva, y no
 * podría haberla: no están. Quien los pierde no los recupera, los regenera — y regenerar
 * invalida los anteriores, que es lo correcto cuando no se sabe dónde acabaron los viejos.
 *
 * ## Por qué HMAC y no bcrypt, si son "contraseñas"
 *
 * No son contraseñas: son cadenas de 50 bits generadas por el sistema. bcrypt existe para
 * proteger secretos elegidos por personas —cortos, previsibles, atacables por diccionario— a
 * base de hacer cada intento caro. Aquí no hay diccionario que valga: probar un código al azar
 * es acertar entre mil billones.
 *
 * Y HMAC tiene una ventaja que bcrypt no puede dar: se puede BUSCAR por él. Con bcrypt habría
 * que traer los diez códigos del usuario y compararlos uno a uno, diez operaciones lentas por
 * intento — que es además un temporizador que delata cuántos códigos le quedan. Con HMAC es una
 * consulta indexada.
 *
 * Mismo secreto que los tokens de refresco y los de recuperación de contraseña: si algún día se
 * rota, caducan a la vez las sesiones, los enlaces pendientes y estos códigos. Es exactamente
 * lo que se querría al rotarlo.
 *
 * ## El formato
 *
 * Diez códigos de diez caracteres partidos por un guion (`k7m2p-x4rt9`). Se leen de un papel y
 * se teclean con prisa: el guion da un punto de referencia y el alfabeto no tiene ni `l` ni `1`
 * ni `0` ni `o`, que son los cuatro caracteres que se confunden al copiar a mano.
 */

/** Cuántos se entregan. Diez: suficientes para varios años de móviles perdidos. */
export const RECOVERY_CODE_COUNT = 10;

/** Sin `l`, `1`, `0`, `o`: los cuatro que se confunden al copiar de un papel. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const HALF_LENGTH = 5;

/**
 * Diez códigos nuevos, en claro.
 *
 * Es el ÚNICO momento en que existen legibles. Quien llame a esto tiene que entregarlos y
 * olvidarlos: no pueden ir a un registro, ni a la auditoría, ni volver por ninguna otra ruta.
 */
export function generateRecoveryCodes(
  count = RECOVERY_CODE_COUNT,
): readonly string[] {
  return Array.from({ length: count }, () => generateOne());
}

function generateOne(): string {
  const half = () => {
    // `randomBytes` y no `Math.random()`: esto es una credencial, y `Math.random()` es
    // predecible a partir de suficientes salidas.
    const bytes = randomBytes(HALF_LENGTH);
    return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join(
      '',
    );
  };

  return `${half()}-${half()}`;
}

/**
 * El código tal y como se guarda.
 *
 * Se normaliza antes: minúsculas y sin espacios. Alguien que teclea desde un papel escribe
 * mayúsculas la mitad de las veces, y rechazarle un código correcto por eso sería un fallo
 * incomprensible justo en el momento en que ya no tiene el móvil.
 */
export function hashRecoveryCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizeCode(code)).digest('hex');
}

export function normalizeCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, '');
}
