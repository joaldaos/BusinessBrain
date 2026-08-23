import { SMTPServer } from 'smtp-server';

/**
 * Un buzón de correo de verdad, en local, para las pruebas.
 *
 * ## Por qué un servidor SMTP y no un doble del adaptador
 *
 * Porque lo que hay que verificar es justamente lo que un doble se saltaría: que el mensaje
 * sale por el protocolo, autenticado, con el remitente y el destinatario correctos, y que el
 * enlace sobrevive a la codificación del cuerpo. Un doble del transporte habría dejado sin
 * probar todo eso, que es exactamente donde falla el correo en la vida real.
 *
 * ## Y por qué no una cuenta de correo de nadie
 *
 * Una prueba que depende del buzón personal de alguien deja de pasar el día que esa persona
 * cambia la contraseña, y no se puede ejecutar en otra máquina. Esto arranca, recibe y se
 * apaga; no necesita red, ni credenciales reales, ni permiso de nadie.
 *
 * Exige autenticación a propósito: es lo que permite comprobar que el adaptador la manda.
 */

export interface CorreoRecibido {
  from: string;
  to: string[];
  /** El mensaje entero tal y como viajó, cabeceras incluidas. */
  raw: string;
  /** El cuerpo ya decodificado, que es donde vive el enlace. */
  body: string;
  subject: string;
}

export interface BuzonDePruebas {
  /** La URL de conexión que se le pasa al adaptador. */
  url: string;
  recibidos: CorreoRecibido[];
  /** Credenciales con las que se autenticó quien mandó. */
  autenticaciones: { user: string; pass: string }[];
  cerrar: () => Promise<void>;
}

const USUARIO = 'buzon-de-pruebas';
const CLAVE = 'clave-del-buzon-de-pruebas';

export async function abrirBuzonDePruebas(
  puerto: number,
): Promise<BuzonDePruebas> {
  const recibidos: CorreoRecibido[] = [];
  const autenticaciones: { user: string; pass: string }[] = [];

  const server = new SMTPServer({
    // Sin TLS: no hay certificados en una prueba local, y lo que se verifica aquí es el
    // mensaje, no el cifrado del transporte.
    secure: false,
    disabledCommands: ['STARTTLS'],
    authOptional: false,
    onAuth(auth, _session, callback) {
      autenticaciones.push({
        user: auth.username ?? '',
        pass: auth.password ?? '',
      });

      if (auth.username === USUARIO && auth.password === CLAVE) {
        callback(null, { user: USUARIO });
        return;
      }
      callback(new Error('Credenciales incorrectas'));
    },
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
      stream.on('end', () => {
        recibidos.push({
          from: session.envelope.mailFrom
            ? session.envelope.mailFrom.address
            : '',
          to: session.envelope.rcptTo.map((destino) => destino.address),
          raw,
          body: cuerpoDe(raw),
          subject: asuntoDe(raw),
        });
        callback();
      });
    },
  });

  await new Promise<void>((listo) => server.listen(puerto, '127.0.0.1', listo));

  return {
    url: `smtp://${USUARIO}:${CLAVE}@127.0.0.1:${puerto}`,
    recibidos,
    autenticaciones,
    cerrar: () => new Promise<void>((cerrado) => server.close(() => cerrado())),
  };
}

/** La URL de conexión con una clave que el buzón va a rechazar. */
export function urlConClaveIncorrecta(puerto: number): string {
  return `smtp://${USUARIO}:clave-equivocada@127.0.0.1:${puerto}`;
}

/**
 * El cuerpo del mensaje, decodificado.
 *
 * Importa de verdad: un texto con acentos viaja codificado, y una URL larga en
 * `quoted-printable` se parte en varias líneas con un `=` al final. Buscar el enlace en el
 * mensaje crudo encontraría media URL — que es como se descubre, en producción, que el enlace
 * que reciben los clientes está roto.
 */
function cuerpoDe(raw: string): string {
  const separacion = raw.indexOf('\r\n\r\n');
  if (separacion === -1) return raw;

  const cabeceras = raw.slice(0, separacion).toLowerCase();
  const cuerpo = raw.slice(separacion + 4);

  if (cabeceras.includes('content-transfer-encoding: base64')) {
    return Buffer.from(cuerpo.replace(/\r?\n/g, ''), 'base64').toString('utf8');
  }

  if (cabeceras.includes('content-transfer-encoding: quoted-printable')) {
    return (
      cuerpo
        // Corte suave de línea: no es contenido, es paginación.
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
          Buffer.from(hex, 'hex').toString('binary'),
        )
        // Los bytes recompuestos son UTF-8: sin esto, los acentos salen partidos.
        .replace(/[\s\S]*/, (texto) =>
          Buffer.from(texto, 'binary').toString('utf8'),
        )
    );
  }

  return cuerpo;
}

/** El asunto, deshaciendo la codificación que usan las cabeceras con acentos. */
function asuntoDe(raw: string): string {
  const encontrado = /^subject:\s*(.*)$/im.exec(raw);
  if (!encontrado) return '';

  const valor = encontrado[1].trim();
  const codificado = /=\?utf-8\?B\?(.*)\?=/i.exec(valor);
  return codificado
    ? Buffer.from(codificado[1], 'base64').toString('utf8')
    : valor;
}
