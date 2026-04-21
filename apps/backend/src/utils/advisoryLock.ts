import { Prisma, PrismaClient } from '@prisma/client';

type DbClient = Prisma.TransactionClient | PrismaClient;

export const acquireTransactionAdvisoryLock = async (tx: DbClient, key: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
};
