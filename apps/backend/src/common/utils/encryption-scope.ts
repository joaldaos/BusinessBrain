/**
 * De quién es un secreto.
 *
 * ## Por qué hay dos ámbitos y no uno
 *
 * La decisión aprobada era derivar la clave de cifrado por organización. Al aplicarla
 * apareció un caso que no encaja: **el secreto de MFA es de un usuario, no de una empresa.**
 * Una persona puede pertenecer a varias organizaciones, y el administrador de plataforma no
 * pertenece a ninguna — no existe un `organizationId` con el que derivar su clave.
 *
 * Así que la misma técnica con distinto identificador. El resultado cumple lo que se pedía y
 * además cierra un hueco que había: un secreto de MFA tampoco puede descifrarse en el
 * contexto de otro usuario, cosa que hoy sí podría.
 */
export type EncryptionScope =
  { kind: 'organization'; id: string } | { kind: 'user'; id: string };

export const forOrganization = (id: string): EncryptionScope => ({
  kind: 'organization',
  id,
});

export const forUser = (id: string): EncryptionScope => ({ kind: 'user', id });

/**
 * La etiqueta que entra en la derivación.
 *
 * Lleva el tipo de ámbito y no solo el identificador: sin él, una organización y un usuario
 * que compartieran identificador —improbable, pero no imposible con cuid— derivarían la
 * misma clave, y el aislamiento dejaría de ser estructural para pasar a depender de la
 * suerte.
 */
export function scopeLabel(scope: EncryptionScope): string {
  return `${scope.kind}:${scope.id}`;
}
