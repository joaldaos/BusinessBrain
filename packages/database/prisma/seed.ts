import { PrismaClient, PlatformRole, MembershipRole, PlanTier } from '@prisma/client';
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
async function main() {
  const superadminEmail =
    process.env.SEED_SUPERADMIN_EMAIL || 'plataforma@businessbrain.dev';
  const superadminPassword =
    process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe123!';
  const demoOwnerEmail =
    process.env.SEED_DEMO_OWNER_EMAIL || 'demo@businessbrain.dev';
  const demoOwnerPassword =
    process.env.SEED_DEMO_OWNER_PASSWORD || 'ChangeMe123!';

  const superadmin = await prisma.user.upsert({
    where: { email: superadminEmail },
    update: {},
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

  const demoOwner = await prisma.user.upsert({
    where: { email: demoOwnerEmail },
    update: {},
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

  console.log(
    `Seed OK\n` +
      `  plataforma (sin empresa): ${superadminEmail}\n` +
      `  cliente demo (${demoOrg.slug}): ${demoOwnerEmail}` +
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
