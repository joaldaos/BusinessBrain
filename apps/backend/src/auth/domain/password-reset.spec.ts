import {
  PASSWORD_RESET_LIFETIME_MS,
  generateResetToken,
  hashResetToken,
  passwordResetEmail,
  resetLinkFor,
} from './password-reset';

describe('recuperación de contraseña (dominio)', () => {
  describe('el testigo', () => {
    it('CRÍTICO: no se repite', () => {
      const testigos = new Set(
        Array.from({ length: 200 }, () => generateResetToken()),
      );

      expect(testigos.size).toBe(200);
    });

    it('CRÍTICO: el hash depende del secreto', () => {
      // Es lo que hace que filtrar la tabla no baste para entrar en ninguna cuenta: sin el
      // secreto no se puede recalcular el hash de un testigo inventado.
      const token = 'un-testigo';

      expect(hashResetToken(token, 'secreto-a')).not.toBe(
        hashResetToken(token, 'secreto-b'),
      );
    });

    it('el mismo testigo y el mismo secreto dan el mismo hash', () => {
      // Sin esto no se podría buscar la fila.
      expect(hashResetToken('abc', 'secreto')).toBe(
        hashResetToken('abc', 'secreto'),
      );
    });

    it('el hash no contiene el testigo', () => {
      expect(hashResetToken('abc', 'secreto')).not.toContain('abc');
    });

    it('caduca en una hora', () => {
      expect(PASSWORD_RESET_LIFETIME_MS).toBe(3_600_000);
    });
  });

  describe('el enlace', () => {
    it('apunta a la pantalla de la interfaz con el testigo en la consulta', () => {
      expect(resetLinkFor('https://app.empresa.com', 'abc123')).toBe(
        'https://app.empresa.com/restablecer?token=abc123',
      );
    });

    it('no se rompe si la URL configurada trae barra final', () => {
      expect(resetLinkFor('https://app.empresa.com/', 'abc123')).toBe(
        'https://app.empresa.com/restablecer?token=abc123',
      );
    });
  });

  describe('el correo', () => {
    const correo = passwordResetEmail({
      to: 'ana@panaderia.es',
      name: 'Ana',
      link: 'https://app.empresa.com/restablecer?token=abc123',
    });

    it('lleva el enlace y va a quien lo pidió', () => {
      expect(correo.to).toBe('ana@panaderia.es');
      expect(correo.body).toContain(
        'https://app.empresa.com/restablecer?token=abc123',
      );
    });

    it('dice que caduca y que solo vale una vez', () => {
      expect(correo.body).toMatch(/caduca/i);
      expect(correo.body).toMatch(/una vez/i);
    });

    it('CRÍTICO: avisa a quien NO lo pidió', () => {
      // Es la única señal que recibe alguien cuya cuenta están intentando tomar.
      expect(correo.body).toMatch(/si no has sido t/i);
    });

    it('está escrito para una persona, no para un sistema', () => {
      // Se mira la PROSA, no el enlace: la URL lleva `token=` por dentro y eso es correcto —
      // nadie lee una URL. Lo que no puede haber es jerga en el texto que sí se lee.
      const prosa = correo.body.replace(/https?:\/\/\S+/g, '');

      expect(prosa).not.toMatch(/token|hash|userId|null|undefined/i);
      expect(correo.subject).toBe('Recupera tu acceso a BusinessBrain');
    });
  });
});
