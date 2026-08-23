import { Logger } from '@nestjs/common';
import { SmtpMailerAdapter } from '../../src/mail/infrastructure/smtp-mailer.adapter';
import { passwordResetEmail } from '../../src/auth/domain/password-reset';
import {
  abrirBuzonDePruebas,
  urlConClaveIncorrecta,
  type BuzonDePruebas,
} from '../buzon-smtp';

/**
 * El adaptador de correo contra un servidor SMTP DE VERDAD.
 *
 * ## Qué se verifica aquí que ningún doble verificaría
 *
 * Que el mensaje sale por el protocolo: autenticado, con remitente y destinatario, y con el
 * enlace INTACTO después de la codificación del cuerpo. Ese último punto es el que rompe el
 * correo en la vida real — un texto con acentos viaja codificado y una URL larga se parte en
 * varias líneas. Un doble del transporte lo habría dado por bueno.
 *
 * ## Y qué se verifica sobre los secretos
 *
 * Que la contraseña del buzón no aparece en el mensaje ni en el error cuando el envío falla.
 * Los errores de SMTP citan la URL de conexión entera, con la clave dentro, y ese error acaba
 * en un registro o en un canal de alertas.
 */
describe('Envío de correo por SMTP (integración)', () => {
  const PUERTO = 2526;
  let buzon: BuzonDePruebas;

  beforeAll(async () => {
    buzon = await abrirBuzonDePruebas(PUERTO);
  });

  afterAll(async () => {
    await buzon.cerrar();
  });

  beforeEach(() => {
    buzon.recibidos.length = 0;
    buzon.autenticaciones.length = 0;
  });

  const REMITENTE = 'BusinessBrain <no-reply@businessbrain.test>';
  const ENLACE =
    'https://app.empresa.com/restablecer?token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const mandarRecuperacion = (to = 'ana@panaderia.test') =>
    new SmtpMailerAdapter(buzon.url, REMITENTE).send(
      passwordResetEmail({ to, name: 'Ana', link: ENLACE }),
    );

  it('el mensaje llega al buzón', async () => {
    await mandarRecuperacion();

    expect(buzon.recibidos).toHaveLength(1);
    expect(buzon.recibidos[0].to).toEqual(['ana@panaderia.test']);
    expect(buzon.recibidos[0].from).toBe('no-reply@businessbrain.test');
  });

  it('se autentica antes de mandar', async () => {
    await mandarRecuperacion();

    expect(buzon.autenticaciones).toHaveLength(1);
    expect(buzon.autenticaciones[0].user).toBe('buzon-de-pruebas');
  });

  it('CRÍTICO: el enlace llega ENTERO y utilizable', async () => {
    // Es lo que rompe el correo de recuperación en la vida real: la codificación del cuerpo
    // parte una URL larga en varias líneas y el cliente recibe media.
    await mandarRecuperacion();

    expect(buzon.recibidos[0].body).toContain(ENLACE);
  });

  it('el asunto y el texto llegan legibles, con sus acentos', async () => {
    await mandarRecuperacion();

    expect(buzon.recibidos[0].subject).toBe(
      'Recupera tu acceso a BusinessBrain',
    );
    expect(buzon.recibidos[0].body).toContain('Hola Ana:');
    // El aviso a quien NO pidió la recuperación es la única señal que recibe alguien cuya
    // cuenta están intentando tomar. Si la codificación se lo comiera, no serviría de nada.
    expect(buzon.recibidos[0].body).toMatch(/si no has sido tú/i);
  });

  it('CRÍTICO: la contraseña del buzón NO viaja en el mensaje', async () => {
    await mandarRecuperacion();

    expect(buzon.recibidos[0].raw).not.toContain('clave-del-buzon-de-pruebas');
  });

  it('CRÍTICO: si el envío falla, el error NO lleva la contraseña dentro', async () => {
    // Los errores de SMTP citan la URL de conexión entera. Ese texto acaba en un registro o
    // en un canal de alertas, y ahí una contraseña es una contraseña filtrada.
    const conClaveMala = new SmtpMailerAdapter(
      urlConClaveIncorrecta(PUERTO),
      REMITENTE,
    );

    await expect(
      conClaveMala.send(
        passwordResetEmail({
          to: 'ana@panaderia.test',
          name: 'Ana',
          link: ENLACE,
        }),
      ),
    ).rejects.toThrow(/No se pudo enviar el correo/);

    const error = await conClaveMala
      .send(
        passwordResetEmail({
          to: 'ana@panaderia.test',
          name: 'Ana',
          link: ENLACE,
        }),
      )
      .catch((problema: Error) => problema.message);

    // Lo que importa es que la clave no esté. Que además haya `***` depende de si el error
    // concreto citaba la URL: exigirlo sería exigir una redacción que a veces no hace falta,
    // y el día que el proveedor cambie el texto del error la prueba fallaría sin motivo.
    expect(error).not.toContain('clave-equivocada');
  });

  it('CRÍTICO: el registro del servidor no lleva el enlace ni la credencial', async () => {
    // Un enlace de recuperación en un fichero de log es una contraseña en un fichero de log:
    // cualquiera con acceso a la operación podría entrar en la cuenta de un cliente. Y
    // `nodemailer` trae su propio registro, que vuelca la conversación SMTP entera — está
    // apagado a propósito, y esto es lo que lo comprueba.
    const escrito: string[] = [];
    const espia = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((mensaje: unknown) => {
        escrito.push(String(mensaje));
      });

    try {
      await mandarRecuperacion();
    } finally {
      espia.mockRestore();
    }

    const registro = escrito.join('\n');

    // Sí se deja constancia de QUÉ salió y A QUIÉN: sin eso, un fallo de entrega sería
    // imposible de investigar.
    expect(registro).toContain('password-reset');
    expect(registro).toContain('ana@panaderia.test');

    // Y no se deja constancia de nada más.
    expect(registro).not.toContain('token=');
    expect(registro).not.toContain('clave-del-buzon-de-pruebas');
    expect(registro).not.toContain('Hola Ana');
  });

  it('un servidor que no responde falla con un mensaje limpio, no con un cuelgue', async () => {
    // Puerto donde no escucha nadie: es lo que ocurre cuando el proveedor de correo se cae.
    const aNingunSitio = new SmtpMailerAdapter(
      'smtp://alguien:secretisimo@127.0.0.1:2599',
      REMITENTE,
    );

    const error = await aNingunSitio
      .send(
        passwordResetEmail({
          to: 'ana@panaderia.test',
          name: 'Ana',
          link: ENLACE,
        }),
      )
      .catch((problema: Error) => problema.message);

    expect(error).toMatch(/No se pudo enviar el correo/);
    expect(error).not.toContain('secretisimo');
  });
});
