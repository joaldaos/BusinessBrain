import { PrismaClient, PlatformRole, MembershipRole, PlanTier } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Dos cuentas que NO son la misma, y esa es toda la gracia.
 *
 * ## Por qué el administrador ya no es dueño de la organización demo
 *
 * Lo era: este seed le creaba una membresía `OWNER` en la empresa de demostración. Era cómodo
 * —una sola cuenta para probarlo todo— y era exactamente la confusión que la arquitectura de
 * plataforma existe para impedir. Si ese seed llegara a ejecutarse en un entorno real, el
 * administrador de BusinessBrain tendría acceso a los datos de un cliente **por la puerta
 * normal**, sin que ninguna acción quedara registrada como administrativa.
 *
 * Y no era solo un riesgo teórico: era el patrón que el proyecto se enseñaba a sí mismo cada
 * vez que alguien levantaba el entorno.
 *
 * Ahora hay dos cuentas separadas:
 *
 * - **Administración de plataforma**: sin ninguna membresía. Puede entrar en `/plataforma`,
 *   y la API de cliente le responde 403 igual que a un desconocido.
 * - **Dueña de la empresa demo**: una cuenta de cliente normal, para probar el producto.
 *
 * Cambiar de sombrero exige cambiar de cuenta. Es incómodo a propósito.
 */
/**
 * La contraseña de una cuenta sembrada.
 *
 * ## Por qué ya no hay ninguna escrita aquí
 *
 * Había una escrita, la misma para las dos cuentas. Como valor por defecto de un entorno de
 * desarrollo parecía inofensivo y no lo es: queda en el repositorio, viaja en cada copia,
 * sobrevive a cualquier despliegue descuidado, y basta con que este seed se ejecute una vez
 * contra algo alcanzable para que exista una cuenta de administración de plataforma con una
 * contraseña publicada en Git.
 *
 * Ahora: si el entorno la trae, se usa. Si no, se genera una al azar y se enseña UNA vez por
 * pantalla. No se escribe en ningún fichero, no vuelve a poder consultarse, y quien la
 * necesite después la cambia por el camino normal del producto.
 *
 * **Ojo con las bases que ya existen.** Quitarlo de aquí no cambia lo que ya está sembrado:
 * una base creada con la versión anterior conserva aquella contraseña hasta que alguien la
 * cambie. Volver a sembrar con `SEED_*_PASSWORD` la sustituye.
 */
function resolverContrasena(delEntorno: string | undefined): string {
  if (delEntorno && delEntorno.trim()) return delEntorno;

  // 18 bytes en base64url: entropía de sobra y se puede copiar de una terminal sin
  // confundir caracteres. El sufijo garantiza que cumple la política de contraseñas.
  return `${randomBytes(18).toString('base64url')}Aa1!`;
}

async function main() {
  const superadminEmail =
    process.env.SEED_SUPERADMIN_EMAIL || 'plataforma@businessbrain.dev';
  const demoOwnerEmail =
    process.env.SEED_DEMO_OWNER_EMAIL || 'demo@businessbrain.dev';

  const superadminPassword = resolverContrasena(
    process.env.SEED_SUPERADMIN_PASSWORD,
  );
  const demoOwnerPassword = resolverContrasena(
    process.env.SEED_DEMO_OWNER_PASSWORD,
  );

  /*
   * Si la cuenta ya existe, la contraseña NO se toca a menos que el entorno traiga una.
   *
   * Sin esto, volver a sembrar imprimía una contraseña recién generada que nunca llegaba a
   * aplicarse —`update: {}`— y quien la copiara no podría entrar. Ahora se dice la verdad:
   * o se ha creado la cuenta con esta contraseña, o ya existía y sigue con la suya.
   *
   * Poner `SEED_SUPERADMIN_PASSWORD` sí la cambia: eso es un acto deliberado de quien opera.
   */
  const superadminExistia = Boolean(
    await prisma.user.findUnique({
      where: { email: superadminEmail },
      select: { id: true },
    }),
  );
  const superadmin = await prisma.user.upsert({
    where: { email: superadminEmail },
    update: process.env.SEED_SUPERADMIN_PASSWORD
      ? { passwordHash: await bcrypt.hash(superadminPassword, 10) }
      : {},
    create: {
      email: superadminEmail,
      passwordHash: await bcrypt.hash(superadminPassword, 10),
      name: 'Administración de BusinessBrain',
      platformRole: PlatformRole.SUPERADMIN,
    },
  });

  // Sin membresías, ni siquiera si este seed se ejecuta sobre una base que ya las tenía de
  // una versión anterior. Es la invariante, no una preferencia.
  const retiradas = await prisma.membership.deleteMany({
    where: { userId: superadmin.id },
  });

  const demoOwnerExistia = Boolean(
    await prisma.user.findUnique({
      where: { email: demoOwnerEmail },
      select: { id: true },
    }),
  );
  const demoOwner = await prisma.user.upsert({
    where: { email: demoOwnerEmail },
    update: process.env.SEED_DEMO_OWNER_PASSWORD
      ? { passwordHash: await bcrypt.hash(demoOwnerPassword, 10) }
      : {},
    create: {
      email: demoOwnerEmail,
      passwordHash: await bcrypt.hash(demoOwnerPassword, 10),
      name: 'Dueña de la empresa demo',
      platformRole: PlatformRole.USER,
    },
  });

  const demoOrg = await prisma.organization.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'BusinessBrain Demo',
      slug: 'demo',
      planTier: PlanTier.FREE,
    },
  });

  await prisma.membership.upsert({
    where: {
      userId_organizationId: {
        userId: demoOwner.id,
        organizationId: demoOrg.id,
      },
    },
    update: {},
    create: {
      userId: demoOwner.id,
      organizationId: demoOrg.id,
      role: MembershipRole.OWNER,
    },
  });

  /**
   * Qué ha pasado con cada contraseña, dicho sin ambigüedad.
   *
   * Las tres respuestas posibles son distintas y confundirlas deja a alguien copiando una
   * contraseña que no funciona: la trajo el entorno, se acaba de generar, o la cuenta ya
   * existía y sigue con la suya.
   */
  const contarContrasena = (
    delEntorno: string | undefined,
    generada: string,
    existia: boolean,
    variable: string,
  ): string => {
    if (delEntorno) return `    contraseña: la de ${variable}`;
    if (existia) {
      return (
        '    contraseña: la cuenta ya existía y NO se ha tocado.\n' +
        `      Para cambiarla: vuelve a sembrar con ${variable}=…, o usa\n` +
        '      «¿Has olvidado tu contraseña?» en la pantalla de entrada.'
      );
    }
    return `    contraseña (SOLO se enseña ahora, no se guarda): ${generada}`;
  };

  console.log(
    `Seed OK\n` +
      `  plataforma (sin empresa): ${superadminEmail}\n` +
      contarContrasena(
        process.env.SEED_SUPERADMIN_PASSWORD,
        superadminPassword,
        superadminExistia,
        'SEED_SUPERADMIN_PASSWORD',
      ) +
      `\n    → tiene que activar la verificación en dos pasos antes de administrar nada:\n` +
      `      entra en /platform/account y actívala. Sin ella, todo /platform responde 403.\n` +
      `  cliente demo (${demoOrg.slug}): ${demoOwnerEmail}\n` +
      contarContrasena(
        process.env.SEED_DEMO_OWNER_PASSWORD,
        demoOwnerPassword,
        demoOwnerExistia,
        'SEED_DEMO_OWNER_PASSWORD',
      ) +
      (retiradas.count > 0
        ? `\n  se retiraron ${retiradas.count} membresía(s) heredadas de la cuenta de plataforma`
        : ''),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
