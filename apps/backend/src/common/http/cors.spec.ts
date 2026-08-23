import { allowedOriginsFor, corsDecisionFor } from './cors';

describe('política de origen cruzado', () => {
  const produccion = {
    isProduction: true,
    frontendUrl: 'https://app.empresa.com',
  };

  describe('producción', () => {
    it('el origen configurado recibe permiso y credenciales', () => {
      expect(
        corsDecisionFor({
          ...produccion,
          requestOrigin: 'https://app.empresa.com',
        }),
      ).toEqual({ origin: 'https://app.empresa.com', credentials: true });
    });

    it('CRÍTICO: a otro origen no se le responde NADA, ni siquiera credenciales', () => {
      // No basta con omitir `Allow-Origin`: mientras `Allow-Credentials` salga igual, la
      // garantía depende de que el navegador exija las dos. Aquí no sale ninguna.
      expect(
        corsDecisionFor({ ...produccion, requestOrigin: 'https://atacante.io' }),
      ).toEqual({ origin: false, credentials: false });
    });

    it('CRÍTICO: sin origen configurado se deniega todo, no se abre todo', () => {
      // Es la regresión que motivó el cambio: `?? true` convertía la falta de configuración
      // en "acepta a cualquiera".
      expect(allowedOriginsFor({ isProduction: true })).toEqual([]);
      expect(
        corsDecisionFor({
          isProduction: true,
          requestOrigin: 'https://app.empresa.com',
        }),
      ).toEqual({ origin: false, credentials: false });
    });

    it('CRÍTICO: un dominio que solo empieza igual no cuela', () => {
      expect(
        corsDecisionFor({
          ...produccion,
          requestOrigin: 'https://app.empresa.com.atacante.io',
        }).origin,
      ).toBe(false);
    });

    it('CRÍTICO: el bucle local no vale en producción', () => {
      expect(
        corsDecisionFor({ ...produccion, requestOrigin: 'http://localhost:5173' })
          .origin,
      ).toBe(false);
    });

    it('la barra final de la variable no rompe el despliegue', () => {
      // La cabecera `Origin` nunca la lleva. Copiar la URL del navegador sí.
      expect(
        corsDecisionFor({
          isProduction: true,
          frontendUrl: 'https://app.empresa.com/',
          requestOrigin: 'https://app.empresa.com',
        }).origin,
      ).toBe('https://app.empresa.com');
    });

    it('sin cabecera Origin no se responde nada de origen cruzado', () => {
      expect(corsDecisionFor(produccion)).toEqual({
        origin: false,
        credentials: false,
      });
    });
  });

  describe('desarrollo', () => {
    it('acepta cualquier puerto de bucle local', () => {
      const decidir = (requestOrigin: string) =>
        corsDecisionFor({ isProduction: false, requestOrigin }).origin;

      expect(decidir('http://localhost:5173')).toBe('http://localhost:5173');
      expect(decidir('http://127.0.0.1:4173')).toBe('http://127.0.0.1:4173');
      // La comodidad de desarrollo no puede alcanzar a un dominio público.
      expect(decidir('https://atacante.io')).toBe(false);
      expect(decidir('http://localhost.atacante.io')).toBe(false);
    });
  });
});
