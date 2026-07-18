// Único punto de entrada al cliente Prisma para todo el monorepo.
// Ningún app/paquete debe importar "@prisma/client" directamente:
// siempre a través de "@businessbrain/database", para poder centralizar
// aquí, en el futuro, cosas como middlewares de scoping por organización.
export { PrismaClient, Prisma } from '@prisma/client';
export * from '@prisma/client';
