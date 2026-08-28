import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlatformRole } from '@businessbrain/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
} from '../../audit/domain/audit-actions';
import { PAGE_SIZE, normalizePage, paginate } from '../domain/pagination';

/**
 * Las personas, desde la administración del producto.
 *
 * ## Por qué LEER aquí deja rastro, a diferencia del resto de listados
 *
 * Los demás listados de plataforma son agregados nuestros. Este son nombres y correos de
 * empleados de empresas clientes: datos personales de terceros. Que mirarlos no cambie nada no
 * quita que haya que poder responder quién los miró y cuándo.
 *
 * La traza guarda cuántos se leyeron y en qué página, nunca quiénes. Una auditoría que copiara
 * los correos sería un segundo almacén de los mismos datos personales, y el problema que
 * intenta controlar acabaría duplicado dentro de ella.
 *
 * ## Lo que NUNCA sale de aquí
 *
 * La selección es explícita en las dos consultas. `passwordHash`, `mfaSecretEnc` y todo lo
 * demás que vive en `User` no se selecciona: no es que se filtre después, es que no se trae.
 * Del segundo factor sale un booleano —hace falta para responder "no puedo entrar"— y jamás el
 * secreto.
 */
@Injectable()
export class PlatformUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(params: { page?: number; actorId: string }) {
    const page = normalizePage(params.page);
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        select: DIRECTORY_FIELDS,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      this.prisma.user.count(),
    ]);

    await this.audit.record({
      organizationId: null,
      actorId: params.actorId,
      action: AUDIT_ACTIONS.PLATFORM_USERS_LISTED,
      targetType: AUDIT_TARGET_TYPES.USER,
      metadata: { page, returned: items.length },
    });

    return paginate(items.map(present), total, page);
  }

  /**
   * Una persona concreta.
   *
   * Existe para el caso que motiva todo este listado: "no puedo entrar con esta cuenta". Para
   * responderlo hace falta saber si está bloqueada, si tiene segundo factor y a qué empresas
   * pertenece — y nada más que eso.
   *
   * También se audita. Abrir la ficha de una persona es una lectura de sus datos personales
   * igual que el listado, y más dirigida: quien la abre sabe exactamente a quién está mirando.
   */
  async detail(params: { userId: string; actorId: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: {
        ...DIRECTORY_FIELDS,
        memberships: {
          select: {
            role: true,
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    await this.audit.record({
      organizationId: null,
      actorId: params.actorId,
      action: AUDIT_ACTIONS.PLATFORM_USERS_LISTED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: user.id,
      metadata: { page: 1, returned: 1 },
    });

    // `memberships` se saca de en medio ANTES de presentar. Sin esto, el objeto crudo de
    // Prisma viajaba también en la respuesta junto a la forma que sí se diseñó: dos versiones
    // de lo mismo, una de ellas sin decidir. Lo cazó una prueba, no una revisión.
    const { memberships, ...cuenta } = user;

    return {
      ...present(cuenta),
      organizations: memberships.map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        role: membership.role,
      })),
    };
  }

  /**
   * Bloquear o desbloquear una cuenta.
   *
   * ## Por qué son dos llamadas y no un interruptor
   *
   * Antes era `toggle`: quien llamaba no decía QUÉ estado quería, sino "cambia el que haya".
   * Para una acción sensible eso está mal por dos motivos. Uno, que la interfaz puede pedir un
   * bloqueo y provocar un desbloqueo si el estado cambió entre que pintó la pantalla y que
   * alguien pulsó. Y dos, que dos llamadas seguidas —un doble clic, un reintento de red— se
   * anulan entre sí y dejan la cuenta como estaba, con dos entradas de auditoría contradictorias.
   *
   * Declarando el estado destino, repetir la llamada es inofensivo y la traza dice lo que
   * ocurrió de verdad.
   *
   * ## Y no se puede bloquear a quien administra la plataforma
   *
   * Ni a otro administrador ni a uno mismo. Bloquearse a uno mismo deja el producto sin nadie
   * que pueda desbloquearlo —hace falta ser administrador para llamar aquí, y una cuenta
   * bloqueada no autentica—, y bloquear al otro administrador permite que quien comprometa una
   * cuenta de plataforma deje fuera a quien podría pararle.
   */
  async setBanned(params: {
    userId: string;
    banned: boolean;
    actorId: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, status: true, platformRole: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.platformRole === PlatformRole.SUPERADMIN) {
      throw new BadRequestException(
        'No se puede bloquear una cuenta de administración de BusinessBrain.',
      );
    }

    const target = params.banned ? 'BANNED' : 'ACTIVE';
    if (user.status === target) {
      return { id: user.id, status: user.status, changed: false };
    }

    const updated = await this.prisma.user.update({
      where: { id: params.userId },
      data: { status: target },
      select: { id: true, status: true },
    });

    // Bloquear no necesita revocar sesiones a mano: `JwtStrategy` comprueba el estado de la
    // cuenta en CADA petición y el refresco también, así que el cierre es inmediato. Si eso
    // cambiara, esto tendría que revocarlas explícitamente — y hay una prueba que lo vigila.
    await this.audit.record({
      organizationId: null,
      actorId: params.actorId,
      action: params.banned
        ? AUDIT_ACTIONS.USER_BANNED
        : AUDIT_ACTIONS.USER_UNBANNED,
      targetType: AUDIT_TARGET_TYPES.USER,
      targetId: user.id,
      metadata: { previousStatus: user.status, newStatus: target },
    });

    return { id: updated.id, status: updated.status, changed: true };
  }
}

/**
 * Lo que se ve de una persona. Un solo sitio para el listado y para la ficha.
 *
 * `mfaEnabledAt` entra para poder derivar el booleano; nunca sale tal cual. El secreto, el
 * hash de la contraseña y los códigos de recuperación no aparecen porque no se seleccionan.
 */
const DIRECTORY_FIELDS = {
  id: true,
  email: true,
  name: true,
  platformRole: true,
  status: true,
  createdAt: true,
  lastActiveAt: true,
  mfaEnabledAt: true,
} as const;

function present(user: {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  status: string;
  createdAt: Date;
  lastActiveAt: Date | null;
  mfaEnabledAt: Date | null;
}) {
  const { mfaEnabledAt, ...rest } = user;

  return {
    ...rest,
    // Un booleano, no la fecha ni el secreto: para atender "no puedo entrar" basta con saber
    // si le van a pedir un código.
    mfaEnabled: mfaEnabledAt !== null,
  };
}
