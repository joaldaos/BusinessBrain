import { externalEndpoint } from './external-endpoint';

const FALLBACK = 'https://api.proveedor-real.com/v1';

describe('externalEndpoint', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('sin variable, se usa el servicio real', () => {
    delete process.env.PRUEBA_ENDPOINT;
    expect(externalEndpoint(FALLBACK, 'PRUEBA_ENDPOINT')).toBe(FALLBACK);
  });

  it('fuera de producción, se puede redirigir', () => {
    process.env.NODE_ENV = 'test';
    process.env.PRUEBA_ENDPOINT = 'http://127.0.0.1:4599';
    expect(externalEndpoint(FALLBACK, 'PRUEBA_ENDPOINT')).toBe(
      'http://127.0.0.1:4599',
    );
  });

  it('CRÍTICO: en producción se IGNORA', () => {
    // Sin esta guarda, una variable mal puesta en un despliegue mandaría los tokens de los
    // clientes —o su conocimiento— a un servidor cualquiera, y todo seguiría pareciendo
    // normal.
    process.env.NODE_ENV = 'production';
    process.env.PRUEBA_ENDPOINT = 'http://servidor-del-atacante';
    expect(externalEndpoint(FALLBACK, 'PRUEBA_ENDPOINT')).toBe(FALLBACK);
  });

  it('una variable vacía no cuenta como redirección', () => {
    process.env.NODE_ENV = 'test';
    process.env.PRUEBA_ENDPOINT = '';
    expect(externalEndpoint(FALLBACK, 'PRUEBA_ENDPOINT')).toBe(FALLBACK);
  });
});
