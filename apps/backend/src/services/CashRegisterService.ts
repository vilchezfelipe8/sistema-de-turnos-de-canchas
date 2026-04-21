import { prisma } from '../prisma';
import { acquireTransactionAdvisoryLock } from '../utils/advisoryLock';

export class CashRegisterService {
  async create(clubId: number, input: { name: string; location?: string }) {
    return prisma.$transaction(async (tx) => {
      await acquireTransactionAdvisoryLock(tx, `cash-register:${clubId}:${input.name.trim().toLowerCase()}`);

      const existing = await tx.cashRegister.findFirst({
        where: { clubId, name: input.name }
      });

      if (existing) return existing;

      return tx.cashRegister.create({
        data: {
          clubId,
          name: input.name
        }
      });
    });
  }

  async list(clubId: number) {
    return prisma.cashRegister.findMany({
      where: { clubId },
      orderBy: { createdAt: 'desc' }
    });
  }
}
