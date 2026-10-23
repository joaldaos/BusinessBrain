import { ForbiddenException } from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { MembershipPermissionsService } from '../../src/common/security/membership-permissions.service';
import {
  permission,
  type Permission,
} from '../../src/common/security/permissions';
import type { PrismaService } from '../../src/prisma/prisma.service';
import {
  auditService,
  createMember,
  createTestOrg,
  destroyTestOrg,
  prisma,
  type TestOrg,
} from './fixtures';

/**
 * Permisos granulares, contra Postgres.
 *
 * Lo que se defiende aquí es la diferencia entre «no se ha tocado» y «se le ha quitado
 * todo» —que en la base son cero filas en los dos casos y en el dominio son `null` y `[]`—,
 * y que el rol siga siendo el techo por mucho que alguien escriba filas de más.
 */
describe('Permisos granulares (integración)', () => {
  const db = prisma as unknown as PrismaService;
  let org: TestOrg;
  let servicio: MembershipPermissionsService;
  let miembroId: string;
  let membresiaId: string;

  beforeEach(async () => {
    org = await createTestOrg('permisos-int');
    servicio = new MembershipPermissionsService(db, auditService(db));

    // `createMember` devuelve el identificador, no un objeto. Buscar por `undefined` habría
    // encontrado la membresía del PROPIETARIO, y la prueba habría comprobado otra cosa.
    miembroId = await createMember(org, MembershipRole.MEMBER);

    const membresia = await prisma.membership.findFirstOrThrow({
      where: { userId: miembroId, organizationId: org.orgId },
      select: { id: true },
    });
    membresiaId = membresia.id;
  });

  afterEach(async () => {
    await destroyTestOrg(org);
  });

  const puede = (
    module: Parameters<typeof permission>[0],
    action: Parameters<typeof permission>[1],
  ) =>
    servicio.can(
      {
        userId: miembroId,
        organizationId: org.orgId,
        role: MembershipRole.MEMBER,
        membershipId: membresiaId,
      },
      module,
      action,
    );

  describe('sin tocar nada, todo sigue igual', () => {
    it('un MEMBER recién creado puede lo que podía antes', async () => {
      expect(await puede('KNOWLEDGE', 'READ')).toBe(true);
      expect(await puede('KNOWLEDGE', 'WRITE')).toBe(true);
      expect(await puede('RECOMMENDATIONS', 'APPROVE')).toBe(true);
      expect(await puede('SETTINGS', 'WRITE')).toBe(false);
    });

    it('y se ve que nadie se los ha ajustado', async () => {
      const efectivos = await servicio.effectiveFor(membresiaId);

      expect(efectivos.customised).toBe(false);
      expect(efectivos.role).toBe(MembershipRole.MEMBER);
    });
  });

  describe('ajustarlos', () => {
    const fijar = (permissions: Permission[]) =>
      servicio.set({
        membershipId: membresiaId,
        organizationId: org.orgId,
        grantedById: org.userId,
        permissions,
      });

    it('deja exactamente lo que se fijó', async () => {
      await fijar([permission('KNOWLEDGE', 'READ')]);

      expect(await puede('KNOWLEDGE', 'READ')).toBe(true);
      expect(await puede('KNOWLEDGE', 'WRITE')).toBe(false);
      expect(await puede('REPORTS', 'READ')).toBe(false);
    });

    /**
     * La diferencia que más fácil sería equivocar: cero filas por no haberlos tocado, frente
     * a cero filas por habérselos quitado todos. Son lo mismo en la base y lo contrario en
     * el producto.
     */
    it('dejarlo SIN NINGUNO no es lo mismo que no haberlo tocado', async () => {
      await fijar([]);

      expect(await puede('KNOWLEDGE', 'READ')).toBe(false);
      const efectivos = await servicio.effectiveFor(membresiaId);
      expect(efectivos.customised).toBe(true);
      expect(efectivos.effective).toEqual([]);
    });

    it('volver al rol lo devuelve a como estaba', async () => {
      await fijar([]);
      await servicio.resetToRole({
        membershipId: membresiaId,
        organizationId: org.orgId,
        actorId: org.userId,
      });

      expect(await puede('KNOWLEDGE', 'READ')).toBe(true);
      expect((await servicio.effectiveFor(membresiaId)).customised).toBe(false);
    });

    it('reemplaza en vez de sumar: por eso se puede quitar', async () => {
      await fijar([
        permission('KNOWLEDGE', 'READ'),
        permission('REPORTS', 'READ'),
      ]);
      await fijar([permission('KNOWLEDGE', 'READ')]);

      expect(await puede('REPORTS', 'READ')).toBe(false);
      const filas = await prisma.membershipPermission.count({
        where: { membershipId: membresiaId },
      });
      expect(filas).toBe(1);
    });

    it('queda constancia de quién lo concedió', async () => {
      await fijar([permission('KNOWLEDGE', 'READ')]);

      const fila = await prisma.membershipPermission.findFirstOrThrow({
        where: { membershipId: membresiaId },
      });
      expect(fila.grantedById).toBe(org.userId);

      const traza = await prisma.auditLog.findFirst({
        where: {
          organizationId: org.orgId,
          action: 'membership.permissions_set',
        },
      });
      expect(traza).not.toBeNull();
      expect(traza?.actorId).toBe(org.userId);
    });
  });

  describe('el rol es el techo, y la base no lo puede romper', () => {
    it('rechaza conceder algo que el rol no permite', async () => {
      await expect(
        servicio.set({
          membershipId: membresiaId,
          organizationId: org.orgId,
          grantedById: org.userId,
          permissions: [permission('SETTINGS', 'WRITE')],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza un permiso que no existe en el catálogo', async () => {
      await expect(
        servicio.set({
          membershipId: membresiaId,
          organizationId: org.orgId,
          grantedById: org.userId,
          permissions: ['FACTURACION:READ' as Permission],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    /**
     * Si alguien escribe filas directamente en la base —una migración mal hecha, un script—
     * el techo tiene que seguir mandando. La comprobación no puede vivir solo en la escritura.
     */
    it('una fila escrita a mano por encima del rol no concede nada', async () => {
      await prisma.membershipPermission.create({
        data: {
          membershipId: membresiaId,
          permission: permission('SETTINGS', 'WRITE'),
          grantedById: org.userId,
        },
      });

      expect(await puede('SETTINGS', 'WRITE')).toBe(false);
      // Y tampoco aparece en lo que se le enseña a quien administra.
      const efectivos = await servicio.effectiveFor(membresiaId);
      expect(efectivos.effective).not.toContain(
        permission('SETTINGS', 'WRITE'),
      );
    });

    it('un permiso retirado del catálogo deja de contar, pero no rompe', async () => {
      // El escenario real: a esta persona SÍ se le ajustaron los permisos, y entre sus
      // filas sobrevive una de un módulo que el producto ya retiró.
      await servicio.set({
        membershipId: membresiaId,
        organizationId: org.orgId,
        grantedById: org.userId,
        permissions: [permission('KNOWLEDGE', 'READ')],
      });
      await prisma.membershipPermission.create({
        data: {
          membershipId: membresiaId,
          permission: 'MODULO_RETIRADO:READ',
          grantedById: org.userId,
        },
      });

      // No revienta al leerlo, y lo retirado no concede nada.
      const efectivos = await servicio.effectiveFor(membresiaId);
      expect(efectivos.customised).toBe(true);
      expect(efectivos.effective).toEqual([permission('KNOWLEDGE', 'READ')]);
      expect(await puede('KNOWLEDGE', 'READ')).toBe(true);
    });

    /**
     * Y el caso inverso, que es el que el modelo de la marca resuelve: una fila escrita a
     * mano SIN marcar la membresía no convierte a nadie en "ajustado". Sigue valiendo su
     * rol, que es lo que nadie decidió cambiar.
     */
    it('una fila suelta sin marcar la membresía no ajusta nada', async () => {
      await prisma.membershipPermission.create({
        data: {
          membershipId: membresiaId,
          permission: permission('KNOWLEDGE', 'READ'),
          grantedById: org.userId,
        },
      });

      const efectivos = await servicio.effectiveFor(membresiaId);
      expect(efectivos.customised).toBe(false);
      expect(await puede('KNOWLEDGE', 'WRITE')).toBe(true);
    });
  });

  describe('al propietario no se le recorta', () => {
    it('no se le pueden fijar permisos', async () => {
      const suya = await prisma.membership.findFirstOrThrow({
        where: { userId: org.userId, organizationId: org.orgId },
        select: { id: true },
      });

      await expect(
        servicio.set({
          membershipId: suya.id,
          organizationId: org.orgId,
          grantedById: org.userId,
          permissions: [permission('KNOWLEDGE', 'READ')],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('aislamiento', () => {
    it('no se pueden fijar los permisos de alguien de otra empresa', async () => {
      const otra = await createTestOrg('permisos-vecina');

      await expect(
        servicio.set({
          membershipId: membresiaId,
          organizationId: otra.orgId,
          grantedById: otra.userId,
          permissions: [permission('KNOWLEDGE', 'READ')],
        }),
      ).rejects.toThrow(/no encontrada/i);

      await destroyTestOrg(otra);
    });

    it('dar de baja a alguien se lleva sus permisos', async () => {
      await servicio.set({
        membershipId: membresiaId,
        organizationId: org.orgId,
        grantedById: org.userId,
        permissions: [permission('KNOWLEDGE', 'READ')],
      });

      await prisma.membership.delete({ where: { id: membresiaId } });

      expect(
        await prisma.membershipPermission.count({
          where: { membershipId: membresiaId },
        }),
      ).toBe(0);
    });
  });

  describe('perfiles', () => {
    it('aplicar uno escribe sus permisos y se puede ajustar después', async () => {
      await servicio.applyPreset({
        membershipId: membresiaId,
        organizationId: org.orgId,
        grantedById: org.userId,
        preset: 'ATENCION_CLIENTE',
      });

      expect(await puede('ASSISTANT', 'WRITE')).toBe(true);
      // Atención al cliente no ve los informes.
      expect(await puede('REPORTS', 'READ')).toBe(false);

      await servicio.set({
        membershipId: membresiaId,
        organizationId: org.orgId,
        grantedById: org.userId,
        permissions: [permission('ASSISTANT', 'READ')],
      });
      expect(await puede('ASSISTANT', 'WRITE')).toBe(false);
    });
  });
});
