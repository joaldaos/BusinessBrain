import {
  TOTP_STEP_SECONDS,
  decodeBase32,
  encodeBase32,
  formatSecretForManualEntry,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  totp,
  verifyTotp,
} from './totp';

/**
 * TOTP contra el estándar, no contra sí mismo.
 *
 * La mayoría de estas pruebas comparan con los VECTORES PUBLICADOS del RFC 4226 y el RFC 6238.
 * Es lo que hace defendible implementar esto a mano: no se comprueba que la función sea
 * coherente consigo misma —eso pasaría igual si estuviera mal— sino que produce exactamente los
 * dígitos que produce cualquier otra implementación del mundo. Si estas pruebas pasan, Google
 * Authenticator funciona con nosotros.
 */
describe('códigos de un solo uso (TOTP / HOTP)', () => {
  // RFC 4226, Apéndice D: la semilla es la cadena ASCII "12345678901234567890".
  const SEMILLA_RFC = Buffer.from('12345678901234567890', 'ascii');
  const SEMILLA_RFC_BASE32 = encodeBase32(SEMILLA_RFC);

  describe('vectores publicados del RFC 4226 (HOTP)', () => {
    // Apéndice D, columna "HOTP".
    const VECTORES = [
      [0, '755224'],
      [1, '287082'],
      [2, '359152'],
      [3, '969429'],
      [4, '338314'],
      [5, '254676'],
      [6, '287922'],
      [7, '162583'],
      [8, '399871'],
      [9, '520489'],
    ] as const;

    it.each(VECTORES)('contador %i → %s', (contador, esperado) => {
      expect(hotp(SEMILLA_RFC, contador)).toBe(esperado);
    });
  });

  describe('vectores publicados del RFC 6238 (TOTP con SHA-1)', () => {
    // Apéndice B. El RFC tabula ocho dígitos; nosotros usamos seis, que son los seis últimos:
    // el truncamiento decimal es `binario % 10^dígitos`, así que seis dígitos es el mismo
    // número módulo un millón.
    const VECTORES = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ] as const;

    it.each(VECTORES)('t=%i → %s', (segundos, ochoDigitos) => {
      const seisDigitos = ochoDigitos.slice(-6);

      expect(totp(SEMILLA_RFC_BASE32, new Date(segundos * 1000))).toBe(
        seisDigitos,
      );
    });
  });

  describe('base32', () => {
    // RFC 4648 §10.
    it.each([
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ])('codifica %p como %p (vectores del RFC 4648)', (texto, esperado) => {
      expect(encodeBase32(Buffer.from(texto, 'ascii'))).toBe(esperado);
    });

    it('descodifica lo que codifica', () => {
      const original = Buffer.from('un secreto cualquiera de 20 by', 'ascii');

      expect(decodeBase32(encodeBase32(original))).toEqual(original);
    });

    it('tolera lo que teclea una persona: minúsculas, espacios y relleno', () => {
      // Quien copia el secreto de la pantalla lo escribe con los espacios que ve.
      const conEspacios = formatSecretForManualEntry(SEMILLA_RFC_BASE32);

      expect(decodeBase32(conEspacios.toLowerCase())).toEqual(SEMILLA_RFC);
      expect(decodeBase32(`${SEMILLA_RFC_BASE32}==`)).toEqual(SEMILLA_RFC);
    });

    it('rechaza lo que no es base32', () => {
      expect(() => decodeBase32('esto-no-vale!')).toThrow();
    });
  });

  describe('verificación', () => {
    const AHORA = new Date('2026-08-27T10:00:00.000Z');
    const SECRETO = generateTotpSecret();

    it('acepta el código del momento', () => {
      expect(verifyTotp(SECRETO, totp(SECRETO, AHORA), AHORA)).toBe(true);
    });

    it('acepta un reloj desviado hasta treinta segundos, a cada lado', () => {
      // Un móvil con el reloj unos segundos desviado es lo NORMAL. Sin este margen, esa
      // persona no podría entrar nunca y no tendría forma de saber por qué.
      const antes = new Date(AHORA.getTime() - TOTP_STEP_SECONDS * 1000);
      const despues = new Date(AHORA.getTime() + TOTP_STEP_SECONDS * 1000);

      expect(verifyTotp(SECRETO, totp(SECRETO, antes), AHORA)).toBe(true);
      expect(verifyTotp(SECRETO, totp(SECRETO, despues), AHORA)).toBe(true);
    });

    it('CRÍTICO: rechaza un código de hace dos minutos', () => {
      const viejo = totp(SECRETO, new Date(AHORA.getTime() - 120_000));

      expect(verifyTotp(SECRETO, viejo, AHORA)).toBe(false);
    });

    it('CRÍTICO: el código de un secreto no vale para otro', () => {
      const otroSecreto = generateTotpSecret();

      expect(verifyTotp(otroSecreto, totp(SECRETO, AHORA), AHORA)).toBe(false);
    });

    it('rechaza cualquier cosa que no sean seis dígitos', () => {
      for (const basura of [
        '',
        '12345',
        '1234567',
        'abcdef',
        '12 34 56',
        '000000 ',
      ]) {
        expect(verifyTotp(SECRETO, basura, AHORA)).toBe(false);
      }
      // Con el espacio al final sí, porque se recorta: es lo que pega un navegador.
      expect(verifyTotp(SECRETO, ` ${totp(SECRETO, AHORA)} `, AHORA)).toBe(
        true,
      );
    });

    it('CRÍTICO: un secreto ilegible deniega en vez de reventar', () => {
      // Si un secreto se guardara mal, la alternativa a devolver `false` sería una excepción
      // que alguien podría capturar arriba y confundir con "no pasó nada malo".
      expect(verifyTotp('esto-no-es-base32', '000000')).toBe(false);
      expect(verifyTotp('', '000000')).toBe(false);
    });
  });

  describe('el secreto que se genera', () => {
    it('son 160 bits, como recomienda el RFC 4226', () => {
      expect(decodeBase32(generateTotpSecret())).toHaveLength(20);
    });

    it('no se repite', () => {
      const secretos = new Set(
        Array.from({ length: 50 }, () => generateTotpSecret()),
      );

      expect(secretos.size).toBe(50);
    });
  });

  describe('la URL que se convierte en QR', () => {
    it('lleva emisor y cuenta para que se distinga en la aplicación', () => {
      const url = otpauthUrl({ secret: 'ABCD', account: 'ana@empresa.es' });

      expect(url).toContain('otpauth://totp/BusinessBrain%3Aana%40empresa.es');
      expect(url).toContain('secret=ABCD');
      expect(url).toContain('issuer=BusinessBrain');
      // Declarados explícitamente: una aplicación que asumiera otros mostraría códigos que no
      // funcionan, y el usuario no sabría de quién es la culpa.
      expect(url).toContain('algorithm=SHA1');
      expect(url).toContain('digits=6');
      expect(url).toContain('period=30');
    });
  });
});
