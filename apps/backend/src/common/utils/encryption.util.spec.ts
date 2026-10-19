import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.util';
import { forOrganization, forUser } from './encryption-scope';

/**
 * El cifrado de secretos, y el aislamiento que da derivar la clave por ámbito.
 *
 * Antes una sola clave maestra descifraba los secretos de TODOS los clientes. Ahora cada
 * ámbito tiene la suya, derivada: confundir empresas deja de ser un descuido posible,
 * porque la clave de otra ni siquiera existe en ese contexto.
 *
 * Y lo ya cifrado tiene que seguir leyéndose. Si eso fallara, nadie podría entrar con MFA ni
 * sincronizar una integración ya conectada.
 */
describe('EncryptionService', () => {
  const servicio = () =>
    new EncryptionService({
      get: () => randomBytes(32).toString('base64'),
    } as never);

  const conClave = (clave: string) =>
    new EncryptionService({ get: () => clave } as never);

  describe('ida y vuelta', () => {
    it('devuelve exactamente lo que se cifró', () => {
      const s = servicio();
      const org = forOrganization('org-1');

      expect(s.decryptFor(org, s.encryptFor(org, 'un-token-secreto'))).toBe(
        'un-token-secreto',
      );
    });

    it('aguanta acentos, eñes y emoji', () => {
      const s = servicio();
      const org = forOrganization('org-1');
      const texto = 'contraseña con ñ, acentos áéí y 🍞';

      expect(s.decryptFor(org, s.encryptFor(org, texto))).toBe(texto);
    });

    it('dos cifrados del mismo secreto salen distintos', () => {
      const s = servicio();
      const org = forOrganization('org-1');

      // Si salieran iguales, ver dos columnas idénticas revelaría que guardan lo mismo.
      expect(s.encryptFor(org, 'igual')).not.toBe(s.encryptFor(org, 'igual'));
    });
  });

  describe('aislamiento entre ámbitos', () => {
    /** La garantía que justifica todo este cambio. */
    it('una organización NO puede descifrar el secreto de otra', () => {
      const s = servicio();
      const cifrado = s.encryptFor(forOrganization('org-a'), 'de la empresa A');

      expect(() => s.decryptFor(forOrganization('org-b'), cifrado)).toThrow();
    });

    it('un usuario NO puede descifrar el secreto de otro', () => {
      const s = servicio();
      const cifrado = s.encryptFor(forUser('user-a'), 'secreto TOTP de A');

      expect(() => s.decryptFor(forUser('user-b'), cifrado)).toThrow();
    });

    /**
     * El tipo de ámbito entra en la derivación: sin él, una organización y un usuario que
     * compartieran identificador derivarían la misma clave.
     */
    it('un usuario y una organización con el MISMO identificador no comparten clave', () => {
      const s = servicio();
      const cifrado = s.encryptFor(
        forOrganization('mismo-id'),
        'de la empresa',
      );

      expect(() => s.decryptFor(forUser('mismo-id'), cifrado)).toThrow();
    });

    it('dos instalaciones con claves maestras distintas no se leen entre sí', () => {
      const clave = randomBytes(32).toString('base64');
      const otra = randomBytes(32).toString('base64');
      const cifrado = conClave(clave).encryptFor(forOrganization('o'), 'x');

      expect(() =>
        conClave(otra).decryptFor(forOrganization('o'), cifrado),
      ).toThrow();
    });
  });

  describe('compatibilidad con lo ya cifrado', () => {
    /**
     * Si esto fallara, al desplegar nadie podría entrar con MFA ni sincronizar una
     * integración conectada antes del cambio.
     */
    it('lee un secreto en el formato ANTIGUO desde cualquier ámbito', () => {
      const s = servicio();
      const heredado = s.encrypt('escrito antes del cambio');

      expect(s.decryptFor(forOrganization('org-1'), heredado)).toBe(
        'escrito antes del cambio',
      );
      expect(s.decryptFor(forUser('user-9'), heredado)).toBe(
        'escrito antes del cambio',
      );
    });

    it('sabe distinguir un formato del otro, para poder reescribirlo', () => {
      const s = servicio();

      expect(s.isLegacyFormat(s.encrypt('viejo'))).toBe(true);
      expect(
        s.isLegacyFormat(s.encryptFor(forOrganization('o'), 'nuevo')),
      ).toBe(false);
    });

    /** Un v2 leído por la vía sin ámbito es un error de programación: debe decirlo. */
    it('rechaza con un mensaje claro descifrar un v2 sin ámbito', () => {
      const s = servicio();
      const cifrado = s.encryptFor(forOrganization('o'), 'x');

      expect(() => s.decrypt(cifrado)).toThrow(/ámbito/i);
    });
  });

  describe('integridad', () => {
    it('rechaza un secreto manipulado en vez de devolver basura', () => {
      const s = servicio();
      const org = forOrganization('org-1');
      const [v, iv, tag, ct] = s.encryptFor(org, 'intacto').split(':');
      const manipulado = [
        v,
        iv,
        tag,
        Buffer.from('otra cosa').toString('base64'),
      ].join(':');

      // AES-GCM autentica: un ciphertext tocado no descifra, no descifra "casi bien".
      expect(() => s.decryptFor(org, manipulado)).toThrow();
    });

    it.each([
      ['', 'vacío'],
      ['no-tiene-formato', 'sin separadores'],
      ['a:b', 'incompleto'],
    ])('rechaza un payload %s (%s)', (payload) => {
      expect(() =>
        servicio().decryptFor(forOrganization('o'), payload),
      ).toThrow();
    });
  });

  describe('clave maestra', () => {
    it('no arranca si no son exactamente 32 bytes', () => {
      expect(() => conClave(randomBytes(16).toString('base64'))).toThrow(
        /32 bytes/,
      );
    });
  });
});
