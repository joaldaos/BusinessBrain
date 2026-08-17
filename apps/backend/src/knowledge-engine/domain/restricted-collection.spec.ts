import { evaluateRestrictedPerimeter } from './restricted-collection';

/**
 * El perímetro es lo que impide que conectar un buzón convierta el correo de una persona en
 * conocimiento de toda la empresa. Estas pruebas son la frontera.
 */
describe('evaluateRestrictedPerimeter', () => {
  const perimeter = (
    overrides: Partial<Parameters<typeof evaluateRestrictedPerimeter>[0]> = {},
  ) =>
    evaluateRestrictedPerimeter({
      collectionIds: ['col-1'],
      grantedUserCount: 1,
      organizationMemberCount: 5,
      ...overrides,
    });

  it('acepta una colección a la que solo accede parte de la organización', () => {
    expect(perimeter()).toEqual({ allowed: true });
  });

  it('acepta cero concesiones: nadie lo ve, que es el lado seguro', () => {
    expect(perimeter({ grantedUserCount: 0 }).allowed).toBe(true);
  });

  it('CRÍTICO: RECHAZA una colección abierta a TODA la organización', () => {
    // Es el escenario que motiva la regla: el correo de un administrador quedaría consultable
    // por cualquiera, citado en el chat y descargable en un PDF.
    expect(perimeter({ grantedUserCount: 5 })).toMatchObject({
      allowed: false,
      reason: 'OPEN_TO_WHOLE_ORGANIZATION',
    });
  });

  it('RECHAZA si hay más concesiones que miembros', () => {
    expect(perimeter({ grantedUserCount: 9 }).allowed).toBe(false);
  });

  it('en una organización de UNA persona no hay nada que restringir', () => {
    // La regla existe para que el buzón de una persona no se convierta en conocimiento de
    // OTRAS. Sin otras, rechazar no protegería a nadie y dejaría a la pyme más pequeña sin
    // poder conectar su correo.
    expect(
      perimeter({ organizationMemberCount: 1, grantedUserCount: 1 }).allowed,
    ).toBe(true);
  });

  it('RECHAZA sin colección: lo que entra no tendría perímetro', () => {
    expect(perimeter({ collectionIds: [] })).toMatchObject({
      allowed: false,
      reason: 'NO_COLLECTION',
    });
  });

  it('RECHAZA varias colecciones: el acceso sería la UNIÓN de todas', () => {
    expect(perimeter({ collectionIds: ['a', 'b'] })).toMatchObject({
      allowed: false,
      reason: 'MULTIPLE_COLLECTIONS',
    });
  });

  it('cada rechazo explica QUÉ hacer', () => {
    for (const decision of [
      perimeter({ collectionIds: [] }),
      perimeter({ collectionIds: ['a', 'b'] }),
      perimeter({ grantedUserCount: 5 }),
    ]) {
      expect(decision.explanation).toBeTruthy();
      expect(decision.explanation!.length).toBeGreaterThan(40);
    }
  });
});
