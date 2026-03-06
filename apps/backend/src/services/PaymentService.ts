import { PaymentStatus, Prisma } from '@prisma/client';
import { prisma } from '../prisma';

type ListPaymentsFilters = {
  clubId: number;
  bookingId?: number;
  userId?: number;
  status?: PaymentStatus;
  method?: string;
  from?: Date;
  to?: Date;
  take?: number;
};

type CreatePaymentInput = {
  clubId: number;
  amount: number;
  method: string;
  status?: PaymentStatus;
  bookingId?: number | null;
  userId?: number | null;
};

export class PaymentService {
  async list(filters: ListPaymentsFilters) {
    const where: Prisma.PaymentWhereInput = {
      clubId: filters.clubId,
      ...(filters.bookingId ? { bookingId: filters.bookingId } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.method ? { method: filters.method } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {})
            }
          }
        : {})
    };

    return prisma.payment.findMany({
      where,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        booking: { select: { id: true, startDateTime: true, endDateTime: true, paymentStatus: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: filters.take ?? 100
    });
  }

  async create(input: CreatePaymentInput) {
    return prisma.payment.create({
      data: {
        clubId: input.clubId,
        amount: new Prisma.Decimal(input.amount),
        method: input.method,
        status: input.status ?? PaymentStatus.PAID,
        bookingId: input.bookingId ?? null,
        userId: input.userId ?? null
      }
    });
  }

  async updateStatus(id: string, clubId: number, status: PaymentStatus) {
    const payment = await prisma.payment.findFirst({ where: { id, clubId } });
    if (!payment) throw new Error('Pago no encontrado');

    return prisma.payment.update({
      where: { id },
      data: { status }
    });
  }
}
