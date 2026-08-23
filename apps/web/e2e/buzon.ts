import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, rm } from 'node:fs/promises';

/**
 * El buzón de correo de las pruebas de navegador.
 *
 * El backend, arrancado con `MAIL_OUTBOX_PATH`, escribe aquí cada correo en vez de mandarlo.
 * Es la única forma de recorrer la recuperación de contraseña ENTERA sin que el testigo viaje
 * nunca en una respuesta HTTP: devolverlo "solo en pruebas" abriría en el código de producción
 * justo la puerta que ese flujo existe para cerrar.
 *
 * Vive en un fichero y no en memoria porque quien escribe es OTRO PROCESO: el backend
 * compilado que levanta Playwright.
 */
const aqui = dirname(fileURLToPath(import.meta.url));

export const OUTBOX_PATH = resolve(aqui, '..', '.correo-de-prueba.jsonl');

export interface CorreoDePrueba {
  to: string;
  subject: string;
  body: string;
  kind: string;
}

/**
 * Vacía el buzón.
 *
 * Sin esto el fichero crece con cada ejecución. Las direcciones son distintas en cada carrera,
 * así que no confundiría a nadie, pero un fichero que solo crece acaba siendo un fichero que
 * nadie mira.
 */
export async function limpiarBuzon(): Promise<void> {
  await rm(OUTBOX_PATH, { force: true });
}

/** Los correos mandados a una dirección, en orden. Vacío si todavía no hay fichero. */
export async function correosPara(email: string): Promise<CorreoDePrueba[]> {
  let contenido: string;
  try {
    contenido = await readFile(OUTBOX_PATH, 'utf8');
  } catch {
    return [];
  }

  return contenido
    .split('\n')
    .filter((linea) => linea.trim().length > 0)
    .map((linea) => JSON.parse(linea) as CorreoDePrueba)
    .filter((correo) => correo.to === email);
}
