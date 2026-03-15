import { CashRepository } from '../repositories/CashRepository';
import { PaymentMethod, Prisma } from '@prisma/client';
import { TimeHelper } from '../utils/TimeHelper';
import { prisma } from '../prisma';
import { getUserClubContext } from '../utils/getUserClubContext';
import { EventService } from './EventService';
import { AuditLogService } from './AuditLogService';
import { PaymentService } from './PaymentService';
import { AccountingService } from './AccountingService';
import { ProjectionService } from './ProjectionService';

export class CashService {
    private readonly eventService = new EventService();
    private readonly auditLogService = new AuditLogService();
    private readonly paymentService = new PaymentService();
    private readonly accountingService = new AccountingService();
    private readonly projectionService = new ProjectionService();

    constructor(private cashRepository: CashRepository) {}

    private async resolveClubId(clubId?: number, userId?: number, preferredClubId?: number) {
        if (clubId && Number.isInteger(clubId) && clubId > 0) {
            return clubId;
        }
        if (userId && Number.isInteger(userId) && userId > 0) {
            const ctx = await getUserClubContext(userId, preferredClubId);
            return ctx.clubId;
        }
        return undefined;
    }

    async getDailySummary(clubId?: number, userId?: number, preferredClubId?: number) {
        const today = new Date();
        const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        return this.getSummaryByDate(clubId, localDate, userId, preferredClubId);
    }

    async getSummaryByDate(clubId: number | undefined, dateStr: string, userId?: number, preferredClubId?: number) {
        const resolvedClubId = await this.resolveClubId(clubId, userId, preferredClubId);
        const timeZone = resolvedClubId
            ? ((await prisma.club.findUnique({ where: { id: resolvedClubId }, include: { settings: true } }))?.settings?.timeZone ?? 'America/Argentina/Buenos_Aires')
            : 'America/Argentina/Buenos_Aires';

        const [y, m, d] = String(dateStr).split('-').map((part) => Number(part));
        const localDate = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
            ? new Date(y, m - 1, d)
            : new Date();

        const { startUtc: start, endUtc: end } = TimeHelper.getUtcRangeForLocalDate(localDate, timeZone);

        const movementsRaw = await this.cashRepository.findAllByDateRange(start, end, resolvedClubId);

        const paymentIds = (movementsRaw || [])
            .map((movement: any) => movement?.paymentId ?? movement?.refund?.payment?.id ?? movement?.refund?.paymentId)
            .filter((id: any) => typeof id === 'string' && id.trim().length > 0);

        let allocations: Array<{ paymentId: string; accountItem: { type: string } | null; amount: any }> = [];
        if (paymentIds.length > 0) {
            try {
                allocations = await prisma.paymentAllocation.findMany({
                    where: { paymentId: { in: paymentIds } },
                    include: { accountItem: { select: { type: true } } }
                });
            } catch (error: any) {
                const message = String(error?.message || '');
                if (!message.includes('PaymentAllocation') && !message.includes('42P01')) {
                    throw error;
                }
            }
        }

        const allocationMap = new Map<string, Array<{ type: string | null; amount: number }>>();
        for (const allocation of allocations) {
            const paymentId = allocation.paymentId;
            const type = allocation.accountItem?.type ?? null;
            const amount = Number(allocation.amount || 0);
            if (!allocationMap.has(paymentId)) allocationMap.set(paymentId, []);
            allocationMap.get(paymentId)!.push({ type, amount });
        }

        const bookingIds = (movementsRaw || [])
            .map((movement: any) => {
                const sourceType = movement?.payment?.account?.sourceType ?? movement?.refund?.account?.sourceType ?? null;
                const sourceId = movement?.payment?.account?.sourceId ?? movement?.refund?.account?.sourceId ?? null;
                if (sourceType !== 'BOOKING') return null;
                const asNumber = Number(sourceId);
                return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
            })
            .filter((id): id is number => Number.isFinite(Number(id)) && Number(id) > 0);

        let bookingMap = new Map<number, { id: number; startDateTime: any; courtName: string | null; clientName: string | null }>();
        if (resolvedClubId && bookingIds.length > 0) {
            const bookings: any[] = await prisma.booking.findMany({
                where: { clubId: resolvedClubId, id: { in: bookingIds } },
                include: {
                    court: { select: { name: true } },
                    client: { select: { name: true } }
                }
            });

            for (const booking of bookings) {
                bookingMap.set(booking.id, {
                    id: booking.id,
                    startDateTime: booking.startDateTime,
                    courtName: booking.court?.name ?? null,
                    clientName: booking.client?.name ?? null
                });
            }
        }

        const movements = (movementsRaw || []).map((movement: any) => {
            const sourceType = movement?.payment?.account?.sourceType ?? movement?.refund?.account?.sourceType ?? null;
            const sourceId = movement?.payment?.account?.sourceId ?? movement?.refund?.account?.sourceId ?? null;
            const accountId = movement?.payment?.account?.id ?? movement?.refund?.account?.id ?? null;
            const paymentId = movement?.paymentId ?? movement?.refund?.payment?.id ?? movement?.refund?.paymentId ?? null;
            const refundId = movement?.refundId ?? movement?.refund?.id ?? null;
            let bookingAmount = 0;
            let barAmount = 0;
            const bookingId = sourceType === 'BOOKING' ? Number(sourceId) : null;
            const booking = bookingId && bookingMap.has(bookingId) ? bookingMap.get(bookingId) : null;

            if (paymentId && allocationMap.has(paymentId)) {
                const items = allocationMap.get(paymentId) || [];
                for (const item of items) {
                    if (item.type === 'BOOKING') bookingAmount += item.amount;
                    else barAmount += item.amount;
                }
            } else if (movement?.type === 'PAYMENT_IN') {
                const amount = Number(movement?.amount || 0);
                if (sourceType === 'BOOKING') bookingAmount = amount;
                else if (sourceType === 'BAR') barAmount = amount;
            }

            return {
                ...movement,
                sourceType,
                sourceId,
                accountId,
                paymentId,
                refundId,
                booking,
                bookingAmount,
                barAmount
            };
        });

        // 3. Calcular totales (Lógica de negocio)
        let totalCash = 0;
        let totalDigital = 0;
        let totalIncome = 0;
        let totalExpense = 0;
        const groupedByMethod: Record<string, { income: number; expense: number; net: number }> = {};

        movements.forEach(m => {
            const amount = Number(m.amount || 0);
            const isIn = m.type === 'PAYMENT_IN' || m.type === 'DEPOSIT';
            const val = isIn ? amount : -amount;
            
            if (isIn) totalIncome += amount;
            else totalExpense += amount;

            if (m.method === 'CASH') totalCash += val;
            else totalDigital += val;

            const methodKey = String(m.method || 'OTHER');
            if (!groupedByMethod[methodKey]) {
                groupedByMethod[methodKey] = { income: 0, expense: 0, net: 0 };
            }

            if (isIn) groupedByMethod[methodKey].income += amount;
            else groupedByMethod[methodKey].expense += amount;

            groupedByMethod[methodKey].net = groupedByMethod[methodKey].income - groupedByMethod[methodKey].expense;
        });

        return {
            date: dateStr,
            balance: {
                total: totalCash + totalDigital,
                cash: totalCash,
                digital: totalDigital,
                income: totalIncome,
                expense: totalExpense
            },
            totalIncome,
            totalExpenses: totalExpense,
            cashBalance: totalCash,
            groupedByMethod,
            movements
        };
    }

    async addMovement(data: any, actorUserId?: number) {
        const created = await prisma.$transaction(async (tx) => {
            const movement = await tx.cashMovement.create({ data });

            const amount = Number(movement.amount || 0);
            const isIn = movement.type === 'PAYMENT_IN' || movement.type === 'DEPOSIT';

            const movementAccount =
                movement.method === 'TRANSFER' ? 'BANK' :
                movement.method === 'CARD' ? 'CARD_CLEARING' :
                movement.method === 'MP' ? 'ONLINE_GATEWAY' : 'CASH';

            const transaction = await tx.ledgerTransaction.create({
                data: {
                    clubId: Number(movement.clubId),
                    // NOTE: Schema currently has no CASH_MOVEMENT enum value; using ADJUSTMENT as manual movement posting type.
                    type: 'ADJUSTMENT',
                    referenceType: 'MANUAL',
                    referenceId: String(movement.id),
                    createdByUserId: actorUserId ?? data?.userId ?? null
                }
            });

            await tx.ledgerEntry.createMany({
                data: [
                    {
                        transactionId: transaction.id,
                        clubId: Number(movement.clubId),
                        type: 'ADJUSTMENT',
                        referenceType: 'MANUAL',
                        referenceId: String(movement.id),
                        amount: new Prisma.Decimal(Math.abs(amount)),
                        account: isIn ? movementAccount : 'ADJUSTMENTS',
                        direction: 'DEBIT',
                        description: String(movement.concept || ''),
                        createdByUserId: actorUserId ?? data?.userId ?? null
                    },
                    {
                        transactionId: transaction.id,
                        clubId: Number(movement.clubId),
                        type: 'ADJUSTMENT',
                        referenceType: 'MANUAL',
                        referenceId: String(movement.id),
                        amount: new Prisma.Decimal(Math.abs(amount)),
                        account: isIn ? 'ADJUSTMENTS' : movementAccount,
                        direction: 'CREDIT',
                        description: String(movement.concept || ''),
                        createdByUserId: actorUserId ?? data?.userId ?? null
                    }
                ]
            });

            return movement;
        });

        await this.projectionService.refreshCashShiftSummary(String(data.cashShiftId));
        await this.projectionService.refreshDailyCashSummary(Number(data.clubId), created.createdAt);

        if (data?.type === 'PAYMENT_IN' && Number(data?.amount) > 0 && Number.isInteger(Number(data?.clubId))) {
            await this.eventService.paymentReceived(Number(data.clubId), {
                movementId: created.id,
                amount: Number(data.amount),
                method: data.method,
                userId: actorUserId ?? null,
                bookingId: null
            });

            await this.auditLogService.create({
                clubId: Number(data.clubId),
                userId: actorUserId ?? data.userId ?? null,
                entity: 'Payment',
                entityId: String(created.id),
                action: 'PAYMENT_CREATE',
                payload: {
                    type: data.type,
                    amount: Number(data.amount),
                    method: data.method,
                    concept: data.concept,
                    paymentId: data.paymentId ?? null
                }
            });
        }

        return created;
    }

    async getProducts(clubId: number) {
        return prisma.product.findMany({
            where: { clubId },
            select: {
                id: true,
                name: true,
                price: true,
                stock: true,
                category: true
            },
            orderBy: { name: 'asc' }
        });
    }

    async createProductSale(input: {
        clubId: number;
        productId: number;
        quantity: number;
        method: 'CASH' | 'TRANSFER';
        payments?: Array<{ method: 'CASH' | 'TRANSFER'; amount: number }>;
        guestName?: string;
        guestPhone?: string;
        guestDni?: string;
        userId?: number;
        idempotencyKey?: string;
    }, actorUserId?: number) {
        const quantity = Math.floor(Number(input.quantity));
        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Cantidad inválida');
        }

        const product = await prisma.product.findFirst({
            where: { id: input.productId, clubId: input.clubId }
        });
        if (!product) {
            throw new Error('Producto no encontrado');
        }
        if (Number(product.stock) < quantity) {
            throw new Error('Stock insuficiente');
        }

        const total = Number(product.price) * quantity;

        const paymentPlan = (Array.isArray(input.payments) && input.payments.length > 0
            ? input.payments
            : [{ method: input.method, amount: total }])
            .map((payment) => ({
                method: payment.method,
                amount: Number(payment.amount)
            }))
            .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

        if (paymentPlan.length === 0) {
            throw new Error('Debe existir al menos un pago válido');
        }

        const paymentTotal = paymentPlan.reduce((sum, payment) => sum + payment.amount, 0);
        if (Math.abs(paymentTotal - total) > 0.01) {
            throw new Error('La suma de pagos debe coincidir con el total de la venta');
        }

        // Idempotencia: si viene idempotencyKey y ya existe una venta con esa key,
        // devolvemos la misma respuesta sin volver a crear nada.
        if (input.idempotencyKey) {
            const existingAccount = await prisma.account.findFirst({
                where: {
                    clubId: input.clubId,
                    sourceType: 'BAR',
                    idempotencyKey: input.idempotencyKey
                }
            });

            if (existingAccount) {
                const existingPayments = await prisma.payment.findMany({
                    where: { accountId: existingAccount.id }
                });

                const guestBits = [input.guestName, input.guestPhone, input.guestDni]
                    .filter((value) => typeof value === 'string' && value.trim().length > 0)
                    .map((value) => String(value).trim());
                const description = guestBits.length > 0
                    ? `Venta producto: ${product.name} (${guestBits.join(' | ')})`
                    : `Venta producto: ${product.name}`;

                return {
                    accountId: existingAccount.id,
                    total,
                    description,
                    payments: existingPayments
                };
            }
        }

        const sale = await prisma.$transaction(async (tx) => {
            const sourceId = `product-sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            const account = await tx.account.create({
                data: {
                    clubId: input.clubId,
                    sourceType: 'BAR',
                    sourceId,
                    status: 'OPEN',
                    totalAmount: new Prisma.Decimal(0),
                    paidAmount: new Prisma.Decimal(0),
                    idempotencyKey: input.idempotencyKey ?? null
                }
            });

            const guestBits = [input.guestName, input.guestPhone, input.guestDni]
                .filter((value) => typeof value === 'string' && value.trim().length > 0)
                .map((value) => String(value).trim());
            const description = guestBits.length > 0
                ? `Venta producto: ${product.name} (${guestBits.join(' | ')})`
                : `Venta producto: ${product.name}`;

            const item = await tx.accountItem.create({
                data: {
                    accountId: account.id,
                    type: 'PRODUCT',
                    productId: product.id,
                    description,
                    quantity,
                    unitPrice: new Prisma.Decimal(product.price),
                    total: new Prisma.Decimal(total)
                }
            });

            await tx.account.update({
                where: { id: account.id },
                data: {
                    totalAmount: { increment: new Prisma.Decimal(total) }
                }
            });

            await this.accountingService.createAccountItemTransaction(tx, {
                clubId: input.clubId,
                type: 'ACCOUNT_ITEM',
                referenceType: 'ACCOUNT_ITEM',
                referenceId: item.id,
                accountId: account.id,
                accountItemId: item.id,
                amount: total,
                revenueAccount: 'BAR_REVENUE',
                description,
                createdByUserId: actorUserId ?? null
            });

            await tx.product.update({
                where: { id: product.id },
                data: {
                    stock: Number(product.stock) - quantity
                }
            });

            await this.projectionService.refreshAccountSummary(account.id, tx);
            return { accountId: account.id, total, description, accountItemId: item.id };
        });

        const payments = [];
        for (const payment of paymentPlan) {
            const created = await this.paymentService.create({
                clubId: input.clubId,
                accountId: sale.accountId,
                amount: payment.amount,
                method: payment.method as PaymentMethod,
                source: 'POS',
                createdByUserId: actorUserId ?? input.userId,
                allocations: sale.accountItemId
                    ? [{ accountItemId: String(sale.accountItemId), amount: Number(payment.amount) }]
                    : undefined
            });
            payments.push(created);
        }

        return {
            accountId: sale.accountId,
            total: sale.total,
            description: sale.description,
            payments
        };
    }
}
