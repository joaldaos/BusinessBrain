/**
 * Qué URL puede pedir el sistema — defensa contra SSRF.
 *
 * ## Por qué esto es lo más delicado de un conector web
 *
 * Un conector web convierte al servidor en un cliente HTTP que va donde le digan. Sin control,
 * cualquiera con permiso para crear una fuente podría hacerle pedir `http://localhost:5432`,
 * la red interna del despliegue o —el caso clásico— `http://169.254.169.254/`, el servicio de
 * metadatos de las nubes, que entrega credenciales de la máquina en texto plano. El contenido
 * volvería como un `KnowledgeItem` perfectamente indexado y consultable.
 *
 * No es un riesgo teórico: es la forma habitual de escalar de "puedo escribir una URL" a
 * "tengo las credenciales de tu infraestructura".
 *
 * ## Se decide sobre la IP RESUELTA, no sobre el nombre
 *
 * Comprobar solo el nombre de dominio no sirve: `interno.ejemplo.com` puede resolver a
 * `10.0.0.5`, y un atacante controla su propio DNS. Por eso esta capa recibe las direcciones
 * ya resueltas y decide sobre ellas — y por eso hay que volver a comprobarlo en cada salto de
 * redirección, no solo en la primera petición.
 *
 * Dominio puro: sin red, sin DNS, determinista. Quien resuelve es la infraestructura.
 */

export type UrlRejectionReason =
  | 'INVALID_URL'
  | 'UNSUPPORTED_SCHEME'
  | 'PRIVATE_ADDRESS'
  | 'CREDENTIALS_IN_URL';

export interface UrlDecision {
  allowed: boolean;
  reason?: UrlRejectionReason;
  explanation?: string;
}

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Valida la FORMA de la URL, antes de tocar la red.
 *
 * Rechaza credenciales embebidas (`https://usuario:clave@…`) porque acabarían cifradas en la
 * configuración de la fuente sin que nadie lo hubiera decidido, y viajarían en cada
 * sincronización posterior.
 */
export function inspectUrl(raw: string): UrlDecision {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      allowed: false,
      reason: 'INVALID_URL',
      explanation: 'No es una dirección web válida',
    };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return {
      allowed: false,
      reason: 'UNSUPPORTED_SCHEME',
      explanation:
        'Solo se admiten direcciones http y https. Un esquema como file: o gopher: ' +
        'permitiría leer del propio servidor',
    };
  }

  if (url.username || url.password) {
    return {
      allowed: false,
      reason: 'CREDENTIALS_IN_URL',
      explanation:
        'La dirección no puede llevar usuario y contraseña incrustados: quedarían ' +
        'guardados en la configuración de la fuente sin que nadie lo haya decidido',
    };
  }

  return { allowed: true };
}

/**
 * ¿Es una dirección que el servidor no debe visitar?
 *
 * Cubre todo lo que no es internet público: bucle local, redes privadas, enlace local
 * —incluido el rango de metadatos de las nubes—, multicast y reservadas. En IPv6 se resuelven
 * además las direcciones mapeadas a IPv4, porque `::ffff:127.0.0.1` es exactamente
 * `127.0.0.1` con otro disfraz.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase();
  if (ip.length === 0) return true;

  // IPv6 con IPv4 embebida: se juzga por la IPv4 real.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) return isPrivateIpv4(mapped[1]);

  if (ip.includes(':')) return isPrivateIpv6(ip);
  return isPrivateIpv4(ip);
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    // Lo que no se entiende no se visita.
    return true;
  }

  const [a, b] = parts;

  return (
    a === 0 || // "esta" red
    a === 10 || // privada
    a === 127 || // bucle local
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // enlace local — incluye 169.254.169.254 (metadatos de nube)
    (a === 172 && b >= 16 && b <= 31) || // privada
    (a === 192 && b === 168) || // privada
    (a === 192 && b === 0) || // documentación/protocolo
    (a === 198 && (b === 18 || b === 19)) || // pruebas de rendimiento
    a >= 224 // multicast y reservadas
  );
}

function isPrivateIpv6(ip: string): boolean {
  const address = ip.replace(/^\[|\]$/g, '');

  return (
    address === '::' ||
    address === '::1' || // bucle local
    address.startsWith('fc') || // única local
    address.startsWith('fd') ||
    address.startsWith('fe80') || // enlace local
    address.startsWith('ff') // multicast
  );
}

/**
 * Decisión final sobre un destino ya resuelto.
 *
 * Basta con que UNA de las direcciones resueltas sea privada para rechazar: un nombre que
 * resuelve a la vez a una pública y a una interna es precisamente el patrón de un intento de
 * evasión, no una casualidad.
 */
export function inspectResolvedAddresses(addresses: string[]): UrlDecision {
  if (addresses.length === 0) {
    return {
      allowed: false,
      reason: 'PRIVATE_ADDRESS',
      explanation: 'La dirección no resuelve a ningún destino público',
    };
  }

  if (addresses.some(isPrivateAddress)) {
    return {
      allowed: false,
      reason: 'PRIVATE_ADDRESS',
      explanation:
        'Esa dirección apunta a la red interna del servidor. Solo se pueden leer ' +
        'páginas accesibles desde internet',
    };
  }

  return { allowed: true };
}
