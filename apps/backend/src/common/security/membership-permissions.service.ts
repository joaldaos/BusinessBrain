import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipRole } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import {
  can,
  defaultPermissionsFor,
  isKnownPermission,
  PERMISSION_PRESETS,
  type Permission,
  type PermissionAction,
  type PermissionModule,
  type PermissionPreset,
} from './permissions';

export interface EffectivePermissions {
  role: MembershipRole;
  /** Lo que puede de verdad: su concesión, o la de su rol si no tiene ninguna. */
  effective: Permission[];
  /** `true` si alguien se los ha ajustado a mano. */
  customised: boolean;
}

/**
 * Quién puede qué, resuelto contra la base.
 *
 * La REGLA vive en `permissions.ts` y es una función pura; esto solo lee las concesiones y
 * la aplica. Esa separación es deliberada: la regla que decide si alguien ve la facturación
 * de su empresa tiene que poder comprobarse sin base de datos delante.
 */
@Injectable()
export class MembershipPermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Las concesiones de una persona, o `null` si no tiene ninguna.
   *
   * `null` y `[]` NO son lo mismo y por eso se distinguen hasta el final: sin concesiones se
   * aplica el valor por defecto de su rol; con una lista vacía, no puede nada. Devolver `[]`
   * en ambos casos convertiría «no se ha tocado» en «se le ha quitado todo».
   */
  private async grantedFor(membershipId: string): Promise<Permission[] | null> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      select: {
        permissionsCustomised: true,
        permissions: { select: { permission: true } },
      },
    });

    /*
     * Lo decide la MARCA, no el número de filas.
     *
     * Contar filas haría que «se le quitó todo» —cero filas— se leyera igual que «nunca se
     * tocó» —también cero filas—, y entonces quitarle los permisos a alguien se los
     * devolvería íntegros. Son estados opuestos y necesitan representaciones distintas.
     */
    if (!membership?.permissionsCustomised) return null;

    // Un permiso que ya no existe en el catálogo no concede nada. Pasa cuando se retira un
    // módulo: las filas viejas sobreviven y deben dejar de contar, no romper.
    return membership.permissions
      .map((f) => f.permission)
      .filter(isKnownPermission);
  }

  /** ¿Puede esta persona hacer esto en esta empresa? */
  async can(
    params: {
      userId: string;
      organizationId: string;
      role: MembershipRole;
      membershipId: string;
    },
    module: PermissionModule,
    action: PermissionAction,
  ): Promise<boolean> {
    const granted = await this.grantedFor(params.membershipId);
    return can({ role: params.role, granted }, module, action);
  }

  /** Lo que puede de verdad, para enseñárselo a quien administra. */
  async effectiveFor(membershipId: string): Promise<EffectivePermissions> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Membresía no encontrada');

    const granted = await this.grantedFor(membershipId);
    const techo = defaultPermissionsFor(membership.role);

    return {
      role: membership.role,
      // Nunca por encima del techo del rol, ni siquiera si la base trae filas de más.
      effective: (granted ?? techo).filter((p) => techo.includes(p)),
      customised: granted !== null,
    };
  }

  /**
   * Fija los permisos de una persona. Reemplaza, no suma.
   *
   * Reemplazar y no acumular es lo que permite QUITAR: si cada llamada añadiera, no habría
   * forma de reducir a alguien sin una operación aparte, y «ajustar permisos» acabaría
   * siendo siempre ampliarlos.
   */
  async set(params: {
    membershipId: string;
    organizationId: string;
    grantedById: string;
    permissions: Permission[];
  }): Promise<EffectivePermissions> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: params.membershipId, organizationId: params.organizationId },
      select: { id: true, role: true, userId: true },
    });
    if (!membership) throw new NotFoundException('Membresía no encontrada');

    /*
     * Al propietario no se le recorta.
     *
     * No es una comodidad: una empresa cuyo único propietario se quedara sin la capacidad de
     * gestionar permisos no tendría forma de recuperarla desde dentro.
     */
    if (membership.role === MembershipRole.OWNER) {
      throw new ForbiddenException(
        'Los permisos del propietario no se pueden limitar',
      );
    }

    const desconocidos = params.permissions.filter(
      (p) => !isKnownPermission(p),
    );
    if (desconocidos.length > 0) {
      throw new ForbiddenException(
        `Permisos que no existen: ${desconocidos.join(', ')}`,
      );
    }

    // El rol es el techo. Se rechaza en vez de recortar en silencio: quien administra tiene
    // que enterarse de que lo que pidió no se puede dar con ese rol.
    const techo = defaultPermissionsFor(membership.role);
    const imposibles = params.permissions.filter((p) => !techo.includes(p));
    if (imposibles.length > 0) {
      throw new ForbiddenException(
        `El rol ${membership.role} no permite: ${imposibles.join(', ')}. ` +
          `Para concederlos hay que cambiar su rol.`,
      );
    }

    const unicos = [...new Set(params.permissions)];

    // Las tres cosas en UNA transacción: si la marca se escribiera aparte y fallara, la
    // persona se quedaría con las filas nuevas y sin que contaran —o al revés, marcada como
    // ajustada y sin ninguna—, que es la peor forma de equivocarse con un permiso.
    await this.prisma.$transaction([
      this.prisma.membershipPermission.deleteMany({
        where: { membershipId: membership.id },
      }),
      this.prisma.membershipPermission.createMany({
        data: unicos.map((permission) => ({
          membershipId: membership.id,
          permission,
          grantedById: params.grantedById,
        })),
      }),
      this.prisma.membership.update({
        where: { id: membership.id },
        data: { permissionsCustomised: true },
      }),
    ]);

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.grantedById,
      action: AUDIT_ACTIONS.MEMBERSHIP_PERMISSIONS_SET,
      targetType: AUDIT_TARGET_TYPES.MEMBERSHIP,
      targetId: membership.id,
      metadata: { permissions: unicos, role: membership.role },
    });

    return this.effectiveFor(membership.id);
  }

  /**
   * Devuelve a alguien al comportamiento de su rol.
   *
   * Es una operación distinta de «fijar una lista vacía», y tiene que serlo: una lista vacía
   * deja a la persona sin poder nada, y volver al rol la deja como estaba. Que se parezcan
   * tanto es justo el motivo de separarlas.
   */
  async resetToRole(params: {
    membershipId: string;
    organizationId: string;
    actorId: string;
  }): Promise<EffectivePermissions> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: params.membershipId, organizationId: params.organizationId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Membresía no encontrada');

    // Borrar las filas Y quitar la marca. Sin lo segundo, la persona se quedaría marcada
    // como ajustada y sin ningún permiso: no volvería a su rol, se quedaría sin nada.
    await this.prisma.$transaction([
      this.prisma.membershipPermission.deleteMany({
        where: { membershipId: membership.id },
      }),
      this.prisma.membership.update({
        where: { id: membership.id },
        data: { permissionsCustomised: false },
      }),
    ]);

    await this.audit.record({
      organizationId: params.organizationId,
      actorId: params.actorId,
      action: AUDIT_ACTIONS.MEMBERSHIP_PERMISSIONS_RESET,
      targetType: AUDIT_TARGET_TYPES.MEMBERSHIP,
      targetId: membership.id,
      metadata: {},
    });

    return this.effectiveFor(membership.id);
  }

  /** Aplica un perfil. Es un punto de partida: después se puede ajustar uno a uno. */
  async applyPreset(params: {
    membershipId: string;
    organizationId: string;
    grantedById: string;
    preset: PermissionPreset;
  }): Promise<EffectivePermissions> {
    return this.set({
      membershipId: params.membershipId,
      organizationId: params.organizationId,
      grantedById: params.grantedById,
      permissions: [...PERMISSION_PRESETS[params.preset]],
    });
  }
}
