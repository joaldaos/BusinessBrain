/**
 * Perímetro de acceso obligatorio para las fuentes que lo exigen — dominio puro.
 *
 * ## El problema que resuelve
 *
 * Conectar un buzón de correo no es como conectar una carpeta compartida. Una carpeta de Drive
 * ya es un artefacto colectivo; un buzón es de una persona. Si el conocimiento de ese buzón
 * aterrizara en una colección a la que tiene acceso toda la organización, **conectar Gmail
 * convertiría el correo de un administrador en conocimiento de empresa** —consultable por
 * cualquiera, citado en el chat y descargable en un PDF— sin que nadie lo hubiera decidido.
 *
 * Por eso ciertas fuentes exigen un perímetro RESTRINGIDO, y la exigencia es estructural: no
 * un aviso en la interfaz, sino una condición que se comprueba al crear la fuente **y en cada
 * sincronización**, porque las concesiones cambian después de crearla.
 *
 * ## Qué cuenta como restringido
 *
 * Que el conjunto de personas con acceso sea un subconjunto ESTRICTO de la organización. Si
 * todos los miembros tienen acceso, el perímetro no existe — da igual cómo se llame la
 * colección.
 *
 * Cero concesiones también es válido: nadie lo ve, que es el lado seguro. Quien crea una
 * colección recibe acceso a ella, así que en la práctica siempre hay al menos una.
 */

export type RestrictedPerimeterRejection =
  'NO_COLLECTION' | 'MULTIPLE_COLLECTIONS' | 'OPEN_TO_WHOLE_ORGANIZATION';

export interface PerimeterDecision {
  allowed: boolean;
  reason?: RestrictedPerimeterRejection;
  explanation?: string;
}

/**
 * Decide si el perímetro declarado es aceptable para una fuente que lo exige.
 *
 * @param collectionIds     Colecciones de destino de la fuente.
 * @param grantedUserCount  Personas con acceso a esa colección.
 * @param organizationMemberCount Miembros de la organización.
 */
export function evaluateRestrictedPerimeter(params: {
  collectionIds: string[];
  grantedUserCount: number;
  organizationMemberCount: number;
}): PerimeterDecision {
  if (params.collectionIds.length === 0) {
    return {
      allowed: false,
      reason: 'NO_COLLECTION',
      explanation:
        'Esta fuente exige una colección de acceso restringido. Sin colección, lo que ' +
        'entre no tendría perímetro y quedaría fuera del control de acceso',
    };
  }

  if (params.collectionIds.length > 1) {
    // Con varias colecciones el perímetro es la UNIÓN de sus accesos, que es lo contrario de
    // restringir. Se exige una sola, para que quede claro quién puede ver este correo.
    return {
      allowed: false,
      reason: 'MULTIPLE_COLLECTIONS',
      explanation:
        'Esta fuente debe ir a UNA sola colección restringida: con varias, el acceso es la ' +
        'suma de todas y el perímetro deja de estar acotado',
    };
  }

  // Subconjunto ESTRICTO, y solo cuando hay ALGUIEN de quien restringir.
  //
  // En una organización de una sola persona, "toda la organización" y "solo yo" son el mismo
  // conjunto: no hay exposición posible, y rechazar aquí no protegería a nadie — dejaría a la
  // pyme más pequeña sin poder conectar su correo. La regla existe para que el buzón de una
  // persona no se convierta en conocimiento de OTRAS.
  if (
    params.organizationMemberCount > 1 &&
    params.grantedUserCount >= params.organizationMemberCount
  ) {
    return {
      allowed: false,
      reason: 'OPEN_TO_WHOLE_ORGANIZATION',
      explanation:
        'Esa colección es accesible para toda la organización. Un buzón de correo debe ir ' +
        'a una colección restringida: elige una a la que solo tengan acceso las personas ' +
        'que deban leer ese correo',
    };
  }

  return { allowed: true };
}
