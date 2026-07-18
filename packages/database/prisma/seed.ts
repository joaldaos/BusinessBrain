import { PrismaClient, PlatformRole, MembershipRole, PlanTier } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Equivalente a server/store/seed.js de Drop: usuario superadmin de plataforma
// + una organización de demostración, para poder probar el flujo multi-tenant
// desde el primer arranque.
async function main() {
  const superadminEmail = process.env.SEED_SUPERADMIN_EMAIL || 'superadmin@businessbrain.dev';
  const superadminPassword = process.env.SEED_SUPERADMIN_PASSWORD || 'ChangeMe123!';

  const superadmin = await prisma.user.upsert({
    where: { email: superadminEmail },
    update: {},
    create: {
      email: superadminEmail,
      passwordHash: await bcrypt.hash(superadminPassword, 10),
      name: 'BusinessBrain Superadmin',
      platformRole: PlatformRole.SUPERADMIN,
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
    where: { userId_organizationId: { userId: superadmin.id, organizationId: demoOrg.id } },
    update: {},
    create: {
      userId: superadmin.id,
      organizationId: demoOrg.id,
      role: MembershipRole.OWNER,
    },
  });

  console.log(`Seed OK — superadmin: ${superadminEmail} / org: ${demoOrg.slug}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
