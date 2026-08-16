import {
  inspectResolvedAddresses,
  inspectUrl,
  isPrivateAddress,
} from './url-safety';

/**
 * Un conector web convierte al servidor en un cliente HTTP que va donde le digan. Estas
 * pruebas son la frontera entre "puedo escribir una URL" y "tengo las credenciales de tu
 * infraestructura", así que se escriben desde el lado del atacante.
 */
describe('inspectUrl', () => {
  it('admite http y https', () => {
    expect(inspectUrl('https://ejemplo.com/politica').allowed).toBe(true);
    expect(inspectUrl('http://ejemplo.com').allowed).toBe(true);
  });

  describe('esquemas que permitirían leer del propio servidor', () => {
    it.each([
      'file:///etc/passwd',
      'gopher://ejemplo.com',
      'ftp://ejemplo.com/x',
      'data:text/html,<script>',
    ])('RECHAZA %s', (url) => {
      expect(inspectUrl(url)).toMatchObject({
        allowed: false,
        reason: 'UNSUPPORTED_SCHEME',
      });
    });
  });

  it('RECHAZA credenciales incrustadas en la dirección', () => {
    // Acabarían cifradas en la configuración de la fuente sin que nadie lo decidiera, y
    // viajarían en cada sincronización posterior.
    expect(inspectUrl('https://usuario:clave@ejemplo.com')).toMatchObject({
      allowed: false,
      reason: 'CREDENTIALS_IN_URL',
    });
  });

  it.each(['no es una url', '', 'http://'])('RECHAZA %s', (url) => {
    expect(inspectUrl(url).allowed).toBe(false);
  });
});

describe('isPrivateAddress', () => {
  it('CRÍTICO: el servicio de metadatos de las nubes', () => {
    // El caso clásico: entrega credenciales de la máquina en texto plano, y volverían
    // indexadas como un documento más.
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
  });

  describe('nada que no sea internet público', () => {
    it.each([
      ['bucle local', '127.0.0.1'],
      ['bucle local, otra forma', '127.1.2.3'],
      ['privada clase A', '10.0.0.5'],
      ['privada clase B', '172.16.0.1'],
      ['privada clase B, extremo', '172.31.255.255'],
      ['privada clase C', '192.168.1.1'],
      ['CGNAT', '100.64.0.1'],
      ['enlace local', '169.254.1.1'],
      ['esta red', '0.0.0.0'],
      ['multicast', '224.0.0.1'],
      ['IPv6 bucle local', '::1'],
      ['IPv6 única local', 'fd00::1'],
      ['IPv6 enlace local', 'fe80::1'],
      ['IPv6 con corchetes', '[::1]'],
    ])('%s', (_caso, ip) => {
      expect(isPrivateAddress(ip)).toBe(true);
    });
  });

  it('CRÍTICO: una IPv4 disfrazada de IPv6 no se cuela', () => {
    // `::ffff:127.0.0.1` es exactamente `127.0.0.1` con otro disfraz.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
  });

  it('lo que no se entiende NO se visita', () => {
    expect(isPrivateAddress('basura')).toBe(true);
    expect(isPrivateAddress('999.999.999.999')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });

  it('admite direcciones públicas de verdad', () => {
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false); // justo fuera del rango privado
    expect(isPrivateAddress('2606:2800:220:1::')).toBe(false);
  });
});

describe('inspectResolvedAddresses', () => {
  it('admite un destino público', () => {
    expect(inspectResolvedAddresses(['93.184.216.34']).allowed).toBe(true);
  });

  it('CRÍTICO: basta UNA dirección privada para rechazar', () => {
    // Un nombre que resuelve a la vez a una pública y a una interna es el patrón de una
    // evasión, no una casualidad.
    expect(
      inspectResolvedAddresses(['93.184.216.34', '10.0.0.5']),
    ).toMatchObject({ allowed: false, reason: 'PRIVATE_ADDRESS' });
  });

  it('sin destino no se visita nada', () => {
    expect(inspectResolvedAddresses([]).allowed).toBe(false);
  });
});
