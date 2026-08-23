import { redactCredentials } from './smtp-mailer.adapter';

/**
 * Quitar la contraseña del buzón de un mensaje de error.
 *
 * Los errores de SMTP citan la URL de conexión entera, y ese texto acaba en un registro del
 * servidor o en un canal de alertas. Este es el único punto del sistema que tiene esa URL en
 * la mano, así que es el único que puede limpiarla.
 */
describe('redacción de credenciales SMTP', () => {
  it('CRÍTICO: quita usuario y contraseña de una URL de conexión', () => {
    expect(
      redactCredentials(
        'connect ECONNREFUSED smtps://ana:secretisimo@correo.com:465',
      ),
    ).toBe('connect ECONNREFUSED smtps://***@correo.com:465');
  });

  it('funciona con contraseñas con símbolos, que es lo normal', () => {
    const limpio = redactCredentials(
      'error en smtp://usuario:p4s$w0rd-raro@servidor:587',
    );

    expect(limpio).not.toContain('p4s$w0rd-raro');
    expect(limpio).toContain('@servidor:587');
  });

  it('quita todas las apariciones, no solo la primera', () => {
    const limpio = redactCredentials(
      'smtp://a:b@uno.com y luego smtp://c:d@dos.com',
    );

    expect(limpio).not.toMatch(/:b@|:d@/);
    expect(limpio).toBe('smtp://***@uno.com y luego smtp://***@dos.com');
  });

  it('no toca un mensaje que no lleva credenciales', () => {
    // La mayoría de los errores no las llevan; redactar de más haría ilegible el mensaje.
    expect(
      redactCredentials('Invalid login: 535 Credenciales incorrectas'),
    ).toBe('Invalid login: 535 Credenciales incorrectas');
  });

  it('no confunde una dirección de correo con una credencial', () => {
    expect(redactCredentials('no se pudo entregar a ana@panaderia.es')).toBe(
      'no se pudo entregar a ana@panaderia.es',
    );
  });
});
