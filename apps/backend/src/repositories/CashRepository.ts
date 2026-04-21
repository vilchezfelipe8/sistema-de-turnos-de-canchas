import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

type CashCreateInput = {
  clubId: number;
  cashShiftId: string;
  type: 'PAYMENT_IN' | 'REFUND' | 'WITHDRAW' | 'DEPOSIT';
  method: 'CASH' | 'TRANSFER' | 'CARD';
  amount: number;
  concept: string;
  paymentId?: string;
  createdByUserId?: number;
};

export class CashRepository {
  async create(data: CashCreateInput) {
    return prisma.cashMovement.create({
      data: {
        clubId: data.clubId,
        cashShiftId: data.cashShiftId,
        type: data.type,
        method: data.method,
        amount: new Prisma.Decimal(data.amount),
        concept: data.concept,
        paymentId: data.paymentId,
        createdByUserId: data.createdByUserId
      }
    });
  }

  async findAllByDateRange(startDate: Date, endDate: Date, clubId?: number) {
    return prisma.cashMovement.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        ...(clubId ? { clubId } : {})
      },
      include: {
        payment: {
          include: {
            account: {
              select: {
                id: true,
                sourceType: true,
                sourceId: true
              }
            },
            allocations: {
              select: {
                accountItemId: true,
                amount: true,
                accountItem: {
                  select: {
                    type: true,
                    description: true,
                    quantity: true,
                    unitPrice: true,
                    total: true
                  }
                }
              }
            }
          }
        },
        refund: {
          include: {
            account: {
              select: {
                id: true,
                sourceType: true,
                sourceId: true
              }
            },
            payment: {
              select: {
                id: true,
                channel: true,
                method: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
