import { validateEnv } from './env.validation';

/**
 * El arranque como última línea de defensa.
 *
 * Una variable de entorno que falta no avisa: no hay pantalla roja, no hay excepción, la
 * aplicación levanta y parece sana. Por eso lo que decide seguridad tiene que impedir el
 * arranque, no degradarse en silencio.
 */
describe('validación del entorno', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost:5432/bb',
    JWT_ACCESS_SECRET: 'un-secreto-suficientemente-largo',
    JWT_REFRESH_SECRET: 'otro-secreto-suficientemente-largo',
    ENCRYPTION_KEY: 'a'.repeat(44),
  };

  it('CRÍTICO: producción sin FRONTEND_URL no arranca', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(
      /FRONTEND_URL/,
    );
  });

  it('producción con FRONTEND_URL arranca', () => {
    const env = validateEnv({
      ...base,
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://app.empresa.com',
    });

    expect(env.FRONTEND_URL).toBe('https://app.empresa.com');
  });

  it('desarrollo sin FRONTEND_URL sigue siendo cómodo', () => {
    // En local la política de origen cruzado acepta cualquier bucle local, así que exigirla
    // aquí solo añadiría fricción sin cerrar nada.
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'development' }),
    ).not.toThrow();
  });

  it('una FRONTEND_URL que no es una URL se rechaza al arrancar', () => {
    // `app.empresa.com` sin esquema no es un origen y no coincidiría nunca con la cabecera
    // `Origin` del navegador: la interfaz dejaría de funcionar en producción y no en local.
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        FRONTEND_URL: 'app.empresa.com',
      }),
    ).toThrow(/FRONTEND_URL/);
  });

  it('el mensaje de error dice QUÉ falta, no solo que algo falla', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL/,
    );
  });
});
