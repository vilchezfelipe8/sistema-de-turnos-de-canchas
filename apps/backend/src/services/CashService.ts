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
import { generateDisplayCode } from '../utils/displayCode';
import { DiscountService } from './DiscountService';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';

type ProductSaleItemInput = {
    itemKey?: string;
    productId?: number | null;
    quantity: number;
    customName?: string;
    unitPrice?: number;
};

type ProductSalePaymentAllocationInput = {
    itemKey?: string;
    productId?: number;
    amount: number;
};

type ClientDraftInput = {
    name: string;
    phone?: string;
    phoneCountryCode?: string;
    phoneNumberLocal?: string;
    dni?: string;
    email?: string;
    isProfessor?: boolean;
};

type NormalizedProductSaleItem = {
    itemKey: string;
    productId: number | null;
    quantity: number;
    customName?: string;
    unitPrice?: number;
};

export class CashService {
    private readonly eventService = new EventService();
    private readonly auditLogService = new AuditLogService();
    private readonly paymentService = new PaymentService();
    private readonly accountingService = new AccountingService();
    private readonly projectionService = new ProjectionService();
    private readonly discountService = new DiscountService();

    constructor(private cashRepository: CashRepository) {}

    private roundMoney(value: number) {
        return Number((Number(value || 0)).toFixed(2));
    }

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
        if (!resolvedClubId) {
            throw new Error('Club inválido para resumen de caja');
        }
        const club = await prisma.club.findUnique({ where: { id: resolvedClubId }, include: { settings: true } });
        const timeZone = String(club?.settings?.timeZone || '').trim();
        if (!timeZone) {
            throw new Error('Configuración de club inválida: timeZone es obligatorio para caja');
        }

        const [y, m, d] = String(dateStr).split('-').map((part) => Number(part));
        const localDate = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
            ? new Date(y, m - 1, d)
            : new Date();

        const { startUtc: start, endUtc: end } = TimeHelper.getUtcRangeForLocalDate(localDate, timeZone);

        const movementsRaw = await this.cashRepository.findAllByDateRange(start, end, resolvedClubId);

        const allMovementsRaw = [...(movementsRaw || [])].sort((a: any, b: any) => {
            const ta = new Date(a?.createdAt || 0).getTime();
            const tb = new Date(b?.createdAt || 0).getTime();
            return tb - ta;
        });

        const paymentIds = (allMovementsRaw || [])
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
                if (message.includes('PaymentAllocation') || message.includes('42P01')) {
                    throw new Error('Inconsistencia de esquema: PaymentAllocation es obligatorio para el resumen de caja.');
                }
                throw error;
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

        for (const movement of allMovementsRaw || []) {
            if (movement?.type !== 'PAYMENT_IN') continue;
            const paymentId = movement?.paymentId ?? movement?.payment?.id ?? null;
            if (!paymentId) continue;
            const perPaymentAllocations = allocationMap.get(paymentId) || [];
            if (perPaymentAllocations.length === 0) {
                throw new Error(`Inconsistencia financiera: el pago ${paymentId} no tiene PaymentAllocation.`);
            }
        }

        const bookingIds = (allMovementsRaw || [])
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

        const movements = (allMovementsRaw || []).map((movement: any) => {
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

    async getSummaryByDateRange(
        clubId: number | undefined,
        startDateStr: string,
        endDateStr: string,
        userId?: number,
        preferredClubId?: number
    ) {
        const [startYear, startMonth, startDay] = String(startDateStr).split('-').map(Number);
        const [endYear, endMonth, endDay] = String(endDateStr).split('-').map(Number);

        const start = new Date(startYear, startMonth - 1, startDay);
        const end = new Date(endYear, endMonth - 1, endDay);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            throw new Error('Rango de fechas inválido');
        }
        if (start.getTime() > end.getTime()) {
            throw new Error('La fecha inicial debe ser menor o igual a la fecha final');
        }

        const totalDays = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        if (totalDays > 62) {
            throw new Error('El rango máximo permitido es de 62 días');
        }

        let totalCash = 0;
        let totalDigital = 0;
        let totalIncome = 0;
        let totalExpense = 0;
        const groupedByMethod: Record<string, { income: number; expense: number; net: number }> = {};
        const allMovements: any[] = [];

        for (let i = 0; i < totalDays; i++) {
            const current = new Date(start);
            current.setDate(start.getDate() + i);
            const dateLabel = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;

            const daily = await this.getSummaryByDate(clubId, dateLabel, userId, preferredClubId);

            totalCash += Number(daily?.balance?.cash || 0);
            totalDigital += Number(daily?.balance?.digital || 0);
            totalIncome += Number(daily?.balance?.income || 0);
            totalExpense += Number(daily?.balance?.expense || 0);

            const dayGrouped = daily?.groupedByMethod || {};
            for (const methodKey of Object.keys(dayGrouped)) {
                const row = dayGrouped[methodKey] || { income: 0, expense: 0, net: 0 };
                if (!groupedByMethod[methodKey]) {
                    groupedByMethod[methodKey] = { income: 0, expense: 0, net: 0 };
                }
                groupedByMethod[methodKey].income += Number(row.income || 0);
                groupedByMethod[methodKey].expense += Number(row.expense || 0);
                groupedByMethod[methodKey].net = groupedByMethod[methodKey].income - groupedByMethod[methodKey].expense;
            }

            if (Array.isArray(daily?.movements)) {
                allMovements.push(...daily.movements);
            }
        }

        allMovements.sort((a, b) => {
            const ta = new Date(a?.createdAt || a?.date || 0).getTime();
            const tb = new Date(b?.createdAt || b?.date || 0).getTime();
            return tb - ta;
        });

        return {
            date: `${startDateStr}..${endDateStr}`,
            startDate: startDateStr,
            endDate: endDateStr,
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
            movements: allMovements
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
                'CASH';

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
            where: { clubId, isActive: true },
            select: {
                id: true,
                name: true,
                price: true,
                stock: true,
                category: true,
                isActive: true
            },
            orderBy: { name: 'asc' }
        });
    }

    // P2-C: retorna productos + servicios unificados para el selector POS
    async getPosItems(clubId: number) {
        const [products, services] = await Promise.all([
            prisma.product.findMany({
                where: { clubId, isActive: true },
                select: { id: true, name: true, price: true, stock: true, category: true },
                orderBy: { name: 'asc' }
            }),
            prisma.clubServiceCatalog.findMany({
                where: { clubId, isActive: true },
                select: { id: true, name: true, price: true, code: true },
                orderBy: { name: 'asc' }
            })
        ]);

        return [
            ...products.map((p) => ({
                type: 'product' as const,
                id: p.id,
                name: p.name,
                price: Number(p.price),
                stock: p.stock,
                category: p.category
            })),
            ...services.map((s) => ({
                type: 'service' as const,
                id: s.id,
                name: s.name,
                price: Number(s.price),
                stock: null,
                category: s.code
            }))
        ];
    }

    // P2-D: Reporte POS — ventas por turno, ventas por producto, pagos por método
    async getPosReport(clubId: number, startDate?: string, endDate?: string) {
        const start = startDate ? new Date(startDate) : new Date(new Date().setHours(0, 0, 0, 0));
        const end = endDate ? new Date(endDate) : new Date();

        // Fetch BAR account items in date range
        const items = await prisma.accountItem.findMany({
            where: {
                account: { clubId, sourceType: 'BAR', status: 'CLOSED' },
                createdAt: { gte: start, lte: end }
            },
            select: {
                id: true,
                description: true,
                quantity: true,
                total: true,
                productId: true,
                product: { select: { name: true } }
            }
        });

        // Sales by product
        const productMap = new Map<string, { name: string; quantity: number; revenue: number }>();
        for (const item of items) {
            const name = item.product?.name || item.description || 'Ítem';
            const key = item.productId ? `product:${item.productId}` : `custom:${name}`;
            const entry = productMap.get(key) || { name, quantity: 0, revenue: 0 };
            entry.quantity += Number(item.quantity || 0);
            entry.revenue += Number(item.total || 0);
            productMap.set(key, entry);
        }
        const salesByProduct = Array.from(productMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 20);

        // Payments in date range for BAR accounts (grouped by method)
        const payments = await prisma.payment.findMany({
            where: {
                account: { clubId, sourceType: 'BAR' },
                createdAt: { gte: start, lte: end },
                status: 'COMPLETED'
            },
            select: { id: true, amount: true, method: true, cashShiftId: true, cashShift: { select: { id: true, openedAt: true, closedAt: true } } }
        } as any);

        // Payments by method
        const methodMap = new Map<string, { method: string; count: number; total: number }>();
        for (const p of payments as any[]) {
            const method = String(p.method || 'OTHER');
            const entry = methodMap.get(method) || { method, count: 0, total: 0 };
            entry.count += 1;
            entry.total += Number(p.amount || 0);
            methodMap.set(method, entry);
        }
        const paymentsByMethod = Array.from(methodMap.values()).sort((a, b) => b.total - a.total);

        // Sales by shift
        const shiftMap = new Map<string, { shiftId: string; openedAt: string; closedAt: string | null; count: number; total: number }>();
        for (const p of payments as any[]) {
            const shiftId = p.cashShiftId;
            if (!shiftId) continue;
            const openedAt = p.cashShift?.openedAt ? new Date(p.cashShift.openedAt).toISOString() : '';
            const closedAt = p.cashShift?.closedAt ? new Date(p.cashShift.closedAt).toISOString() : null;
            const entry = shiftMap.get(shiftId) || { shiftId, openedAt, closedAt, count: 0, total: 0 };
            entry.count += 1;
            entry.total += Number(p.amount || 0);
            shiftMap.set(shiftId, entry);
        }
        const salesByShift = Array.from(shiftMap.values())
            .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
            .slice(0, 10);

        return { salesByProduct, salesByShift, paymentsByMethod };
    }

    private async resolveClientIdForSaleTx(tx: Prisma.TransactionClient, input: {
        clubId: number;
        clientId?: string;
        clientDraft?: ClientDraftInput;
        allowCreateMissing?: boolean;
    }) {
        const safeClientId = String(input.clientId || '').trim();
        let resolvedClientId: string | null = null;

        if (safeClientId) {
            const existingClient = await tx.client.findFirst({
                where: { id: safeClientId, clubId: input.clubId },
                select: { id: true }
            });
            if (!existingClient) throw new Error('Cliente no encontrado para el club');
            resolvedClientId = existingClient.id;
            return resolvedClientId;
        }

        const draft = input.clientDraft;
        if (!draft) return null;
        const club = await tx.club.findUnique({
            where: { id: input.clubId },
            select: { country: true }
        });

        const normalizedName = String(draft.name || '').trim();
        const normalizedPhone = normalizeIdentityPhone(
            {
                phone: draft.phone,
                countryCode: draft.phoneCountryCode,
                phoneNumberLocal: draft.phoneNumberLocal
            },
            { defaultCountryIso2: String(club?.country || '').trim() || null }
        ) || '';
        const normalizedDni = String(draft.dni || '').replace(/\D/g, '');
        const normalizedEmail = String(draft.email || '').trim().toLowerCase();

        if (normalizedName.length < 2 || !normalizedPhone) {
            throw new Error('CLIENT_DRAFT_INVALID');
        }

        const candidateIds = new Set<string>();
        if (normalizedDni.length >= 6) {
            const byDni = await tx.client.findFirst({
                where: { clubId: input.clubId, dni: normalizedDni },
                select: { id: true }
            });
            if (byDni?.id) candidateIds.add(byDni.id);
        }
        if (normalizedPhone) {
            const phoneVariants = getPhoneIdentityVariants(normalizedPhone);
            const byPhone = await tx.client.findFirst({
                where: { clubId: input.clubId, phone: { in: phoneVariants } },
                select: { id: true }
            });
            if (byPhone?.id) candidateIds.add(byPhone.id);
        }
        if (normalizedEmail.length > 3) {
            const byEmail = await tx.client.findFirst({
                where: { clubId: input.clubId, email: normalizedEmail },
                select: { id: true }
            });
            if (byEmail?.id) candidateIds.add(byEmail.id);
        }

        if (candidateIds.size > 1) {
            const conflictError: any = new Error('CLIENT_POSSIBLE_DUPLICATE');
            conflictError.code = 'CLIENT_POSSIBLE_DUPLICATE';
            const reasonSignals = new Set<string>();
            if (normalizedDni.length >= 6) reasonSignals.add('DNI');
            if (normalizedPhone) reasonSignals.add('PHONE');
            if (normalizedEmail.length > 3) reasonSignals.add('EMAIL');
            conflictError.details = {
                clubId: input.clubId,
                candidateClientIds: Array.from(candidateIds),
                reasonType: reasonSignals.size === 1 ? Array.from(reasonSignals)[0] : 'MULTI_SIGNAL_CONFLICT',
                signals: {
                    dni: normalizedDni || null,
                    phone: normalizedPhone || null,
                    email: normalizedEmail || null
                }
            };
            throw conflictError;
        }
        if (candidateIds.size === 1) {
            return Array.from(candidateIds)[0];
        }

        if (!input.allowCreateMissing) return null;

        const createdClient = await tx.client.create({
            data: {
                clubId: input.clubId,
                name: normalizedName,
                phone: normalizedPhone,
                ...(normalizedDni.length >= 6 ? { dni: normalizedDni } : {}),
                ...(normalizedEmail.length > 3 ? { email: normalizedEmail } : {}),
                isProfessor: Boolean(draft.isProfessor)
            },
            select: { id: true }
        });
        return createdClient.id;
    }

    private normalizeProductSaleItems(input: {
        productId?: number;
        quantity?: number;
        items?: ProductSaleItemInput[];
    }) {
        const rawItems = Array.isArray(input.items) && input.items.length > 0
            ? input.items
            : (input.productId && input.quantity ? [{ productId: input.productId, quantity: input.quantity }] : []);

        if (rawItems.length === 0) throw new Error('Seleccioná al menos un producto');

        const normalizedItems: NormalizedProductSaleItem[] = rawItems.map((item, index) => {
            const quantity = Math.floor(Number(item.quantity));
            const productId = Number(item.productId || 0);
            const providedItemKey = String(item.itemKey || '').trim();
            const customName = String(item.customName || '').trim();

            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error('Cantidad inválida');
            }

            if (Number.isInteger(productId) && productId > 0) {
                return {
                    itemKey: providedItemKey || `product:${productId}:${index}`,
                    productId,
                    quantity
                };
            }

            const unitPrice = this.roundMoney(Number(item.unitPrice || 0));
            if (customName.length < 2 || unitPrice <= 0) {
                throw new Error('Item de venta inválido');
            }

            const slugBase = customName
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 40) || 'item';

            return {
                itemKey: providedItemKey || `custom:${index}:${slugBase}`,
                productId: null,
                quantity,
                customName,
                unitPrice
            };
        });

        const seenKeys = new Set<string>();
        for (const item of normalizedItems) {
            if (seenKeys.has(item.itemKey)) {
                throw new Error('Hay items duplicados en la venta');
            }
            seenKeys.add(item.itemKey);
        }

        return normalizedItems;
    }

    async quoteProductSale(input: {
        clubId: number;
        productId?: number;
        quantity?: number;
        items?: ProductSaleItemInput[];
        clientId?: string;
        clientDraft?: ClientDraftInput;
        userId?: number;
    }) {
            // Fase 1.6: cliente es opcional en venta mostrador. Sin cliente = Consumidor final.
        const normalizedItems = this.normalizeProductSaleItems(input);

        const quote = await prisma.$transaction(async (tx) => {
            const resolvedClientId = await this.resolveClientIdForSaleTx(tx, {
                ...input,
                allowCreateMissing: false
            });
            const items = [];
            let listTotal = 0;
            let finalTotal = 0;
            let discountTotal = 0;

            for (const entry of normalizedItems) {
                const qty = Number(entry.quantity || 0);

                if (entry.productId) {
                    const product = await tx.product.findFirst({
                        where: { id: Number(entry.productId), clubId: input.clubId },
                        select: { id: true, name: true, price: true, category: true, stock: true, isActive: true }
                    });
                    if (!product) throw new Error('Producto no encontrado');
                    if (!product.isActive) throw new Error('Producto inactivo');
                    if (Number(product.stock) < qty) throw new Error('Stock insuficiente');

                    const listUnitPrice = Number(Number(product.price || 0).toFixed(2));
                    const listItemTotal = Number((listUnitPrice * qty).toFixed(2));

                    const discountDraft = await this.discountService.computeDraftDiscountTx(tx, {
                        clubId: input.clubId,
                        clientId: resolvedClientId,
                        itemType: 'PRODUCT',
                        quantity: qty,
                        unitPrice: listUnitPrice,
                        productId: product.id,
                        productCategory: product.category
                    });

                    const finalUnitPrice = Number(Number(discountDraft.unitPrice || listUnitPrice).toFixed(2));
                    const finalItemTotal = Number(Number(discountDraft.total || listItemTotal).toFixed(2));
                    const itemDiscount = Number(Math.max(0, listItemTotal - finalItemTotal).toFixed(2));

                    listTotal += listItemTotal;
                    finalTotal += finalItemTotal;
                    discountTotal += itemDiscount;

                    items.push({
                        itemKey: entry.itemKey,
                        productId: product.id,
                        productName: product.name,
                        quantity: qty,
                        listUnitPrice,
                        finalUnitPrice,
                        listTotal: listItemTotal,
                        finalTotal: finalItemTotal,
                        discountAmount: itemDiscount,
                        hasDiscount: itemDiscount > 0.009,
                        isCustom: false,
                        appliedPolicies: (discountDraft.snapshots || []).map((s: any) => ({
                            policyId: s.policyId,
                            discountAmount: Number(s.discountAmount || 0)
                        }))
                    });
                    continue;
                }

                const customName = String(entry.customName || '').trim();
                const listUnitPrice = this.roundMoney(Number(entry.unitPrice || 0));
                const listItemTotal = this.roundMoney(listUnitPrice * qty);

                listTotal += listItemTotal;
                finalTotal += listItemTotal;

                items.push({
                    itemKey: entry.itemKey,
                    productId: null,
                    productName: customName,
                    quantity: qty,
                    listUnitPrice,
                    finalUnitPrice: listUnitPrice,
                    listTotal: listItemTotal,
                    finalTotal: listItemTotal,
                    discountAmount: 0,
                    hasDiscount: false,
                    isCustom: true,
                    appliedPolicies: []
                });
            }

            return {
                clientId: resolvedClientId,
                listTotal: Number(listTotal.toFixed(2)),
                finalTotal: Number(finalTotal.toFixed(2)),
                discountTotal: Number(discountTotal.toFixed(2)),
                hasDiscount: discountTotal > 0.009,
                items
            };
        });

        return quote;
    }

    // ─── Fase 1.6B: Crear cuenta de venta mostrador SIN cobrar ────────────────
    // Crea Account BAR + AccountItems + descuenta stock, pero NO Payment ni CashMovement.
    // Requiere turno de caja abierto (guardia MVP).
    // El pago se registra después desde AccountDrawer.
    async createProductSaleAccount(input: {
        clubId: number;
        items: ProductSaleItemInput[];
        clientId?: string;
        idempotencyKey?: string;
    }, actorUserId?: number): Promise<{ accountId: string; total: number; description: string }> {
        const normalizedItems = this.normalizeProductSaleItems({ items: input.items });

        // Validar turno de caja abierto antes de crear nada.
        // No creamos CashMovement aquí, pero la venta de mostrador pertenece a la operación de caja.
        const openShift = await prisma.cashShift.findFirst({
            where: { status: 'OPEN', cashRegister: { clubId: input.clubId } },
            orderBy: { openedAt: 'desc' }
        });
        if (!openShift) {
            throw new Error('Abrí una caja antes de registrar ventas de mostrador.');
        }

        const quote = await this.quoteProductSale({
            clubId: input.clubId,
            items: normalizedItems,
            clientId: input.clientId
        });

        const total = Number(quote.finalTotal || 0);

        // Idempotencia: si ya existe una cuenta con esta key, devolver la misma.
        if (input.idempotencyKey) {
            const existing = await prisma.account.findFirst({
                where: { clubId: input.clubId, sourceType: 'BAR', idempotencyKey: input.idempotencyKey }
            });
            if (existing) {
                const consumerLabel = String(input.clientId || '').trim() ? 'cliente' : 'Consumidor final';
                return { accountId: existing.id, total, description: `Venta mostrador (${consumerLabel})` };
            }
        }

        const result = await prisma.$transaction(async (tx) => {
            // Validar cliente si se proporcionó
            const resolvedClientId = await this.resolveClientIdForSaleTx(tx, {
                clubId: input.clubId,
                clientId: input.clientId
            });

            const sourceId = `pos-account-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            const account = await tx.account.create({
                data: {
                    displayCode: generateDisplayCode('CTA'),
                    clubId: input.clubId,
                    sourceType: 'BAR',
                    sourceId,
                    status: 'OPEN',
                    totalAmount: new Prisma.Decimal(0),
                    paidAmount: new Prisma.Decimal(0),
                    idempotencyKey: input.idempotencyKey ?? null,
                    // Persistir cliente para visibilidad y reportes (P2-A)
                    clientId: resolvedClientId ?? null
                } as any
            });

            const consumerLabel: string = resolvedClientId ? 'cliente' : 'Consumidor final';
            const baseDescription = `Venta mostrador (${consumerLabel})`;

            for (const qi of quote.items) {
                const productId = Number(qi.productId || 0);
                const product = productId > 0
                    ? await tx.product.findFirst({
                        where: { id: productId, clubId: input.clubId },
                        select: { id: true, stock: true, category: true, isActive: true }
                    })
                    : null;
                if (productId > 0 && !product) throw new Error('Producto no encontrado');
                if (product && !product.isActive) throw new Error('Producto inactivo');
                if (product && Number(product.stock) < Number(qi.quantity)) throw new Error('Stock insuficiente');

                const item = await tx.accountItem.create({
                    data: {
                        accountId: account.id,
                        type: 'PRODUCT',
                        productId: product ? product.id : null,
                        description: `${baseDescription}: ${qi.productName}`,
                        quantity: qi.quantity,
                        unitPrice: new Prisma.Decimal(qi.finalUnitPrice),
                        total: new Prisma.Decimal(qi.finalTotal)
                    }
                });

                if (resolvedClientId && product) {
                    const discountDraft = await this.discountService.computeDraftDiscountTx(tx, {
                        clubId: input.clubId,
                        clientId: resolvedClientId,
                        itemType: 'PRODUCT',
                        quantity: qi.quantity,
                        unitPrice: qi.listUnitPrice,
                        productId: product.id,
                        productCategory: product.category
                    });
                    if (discountDraft.snapshots?.length) {
                        await this.discountService.persistAppliedDiscountsTx(tx, {
                            clubId: input.clubId,
                            accountItemId: item.id,
                            appliedByUserId: actorUserId ?? null,
                            snapshots: discountDraft.snapshots
                        });
                    }
                }

                if (product) {
                    const stockUpdate = await tx.product.updateMany({
                        where: {
                            id: product.id,
                            clubId: input.clubId,
                            stock: { gte: Number(qi.quantity) }
                        },
                        data: { stock: { decrement: Number(qi.quantity) } }
                    });
                    if (stockUpdate.count !== 1) throw new Error('Stock insuficiente');
                }

                await this.accountingService.createAccountItemTransaction(tx, {
                    clubId: input.clubId,
                    type: 'ACCOUNT_ITEM',
                    referenceType: 'ACCOUNT_ITEM',
                    referenceId: item.id,
                    accountId: account.id,
                    accountItemId: item.id,
                    amount: Number(qi.finalTotal || 0),
                    revenueAccount: 'BAR_REVENUE',
                    description: `${baseDescription}: ${qi.productName}`,
                    createdByUserId: actorUserId ?? null
                });
            }

            await tx.account.update({
                where: { id: account.id },
                data: { totalAmount: { increment: new Prisma.Decimal(total) } }
            });

            await this.projectionService.refreshAccountSummary(account.id, tx);

            return { accountId: account.id, total, description: baseDescription };
        });

        return result;
    }

    async createProductSale(input: {
        clubId: number;
        productId?: number;
        quantity?: number;
        items?: ProductSaleItemInput[];
        method: 'CASH' | 'TRANSFER' | 'CARD';
        channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
        payments?: Array<{
            method: 'CASH' | 'TRANSFER' | 'CARD';
            channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
            amount: number;
            allocations?: ProductSalePaymentAllocationInput[];
        }>;
        clientId?: string;
        clientDraft?: ClientDraftInput;
        userId?: number;
        idempotencyKey?: string;
    }, actorUserId?: number) {
        // Fase 1.6: cliente es opcional en venta mostrador. Sin cliente = Consumidor final.
        const normalizedItems = this.normalizeProductSaleItems(input);

        const quote = await this.quoteProductSale({
            clubId: input.clubId,
            items: normalizedItems,
            clientId: input.clientId,
            clientDraft: input.clientDraft
        });

        const total = Number(quote.finalTotal || 0);

        const paymentPlan = (Array.isArray(input.payments) && input.payments.length > 0
            ? input.payments
            : [{ method: input.method, channel: input.channel, amount: total }])
            .map((payment) => ({
                method: payment.method,
                channel: payment.channel,
                amount: Number(payment.amount),
                allocations: Array.isArray(payment.allocations)
                    ? payment.allocations
                        .map((allocation) => ({
                            itemKey: String(allocation.itemKey || '').trim(),
                            productId: Number(allocation.productId || 0),
                            amount: Number(allocation.amount)
                        }))
                        .filter((allocation) =>
                            (allocation.itemKey.length > 0 || (Number.isFinite(allocation.productId) && allocation.productId > 0)) &&
                            Number.isFinite(allocation.amount) &&
                            allocation.amount > 0
                        )
                    : undefined
            }))
            .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

        if (paymentPlan.length === 0) {
            throw new Error('Debe existir al menos un pago válido');
        }

        const paymentTotal = paymentPlan.reduce((sum, payment) => sum + payment.amount, 0);
        if (Math.abs(paymentTotal - total) > 0.01) {
            throw new Error('La suma de pagos debe coincidir con el total de la venta');
        }

        const quoteItemTotalByKey = new Map<string, number>(
            (quote.items || []).map((item: any) => [String(item.itemKey || ''), Number(item.finalTotal || 0)])
        );
        const quoteItemKeysByProduct = new Map<number, string[]>();
        for (const item of quote.items || []) {
            const productId = Number(item?.productId || 0);
            if (!Number.isFinite(productId) || productId <= 0) continue;
            if (!quoteItemKeysByProduct.has(productId)) {
                quoteItemKeysByProduct.set(productId, []);
            }
            quoteItemKeysByProduct.get(productId)!.push(String(item.itemKey || ''));
        }
        const resolveAllocationItemKey = (allocation: { itemKey?: string; productId?: number }) => {
            const explicitItemKey = String(allocation.itemKey || '').trim();
            if (explicitItemKey) {
                return quoteItemTotalByKey.has(explicitItemKey) ? explicitItemKey : null;
            }

            const productId = Number(allocation.productId || 0);
            if (!Number.isFinite(productId) || productId <= 0) return null;
            const matchingKeys = quoteItemKeysByProduct.get(productId) || [];
            return matchingKeys.length === 1 ? matchingKeys[0] : null;
        };
        const resolvedPaymentPlan = paymentPlan.map((payment) => ({
            ...payment,
            allocations: Array.isArray(payment.allocations) && payment.allocations.length > 0
                ? payment.allocations
                    .map((allocation) => {
                        const resolvedItemKey = resolveAllocationItemKey(allocation);
                        if (!resolvedItemKey) {
                            throw new Error('Una asignación hace referencia a un item inexistente o ambiguo en la venta.');
                        }
                        return {
                            itemKey: resolvedItemKey,
                            amount: Number(Number(allocation.amount || 0).toFixed(2))
                        };
                    })
                    .filter((allocation) => allocation.amount > 0.009)
                : undefined
        }));
        const hasExplicitAllocations = resolvedPaymentPlan.some((payment) => Array.isArray(payment.allocations) && payment.allocations.length > 0);
        if (hasExplicitAllocations) {
            const everyPaymentHasAllocations = resolvedPaymentPlan.every((payment) => Array.isArray(payment.allocations) && payment.allocations.length > 0);
            if (!everyPaymentHasAllocations) {
                throw new Error('Si configurás pagos por item, todos los pagos deben indicar sus items.');
            }

            const allocatedByItemKey = new Map<string, number>();
            for (const payment of resolvedPaymentPlan) {
                const allocationTotal = (payment.allocations || []).reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
                if (Math.abs(allocationTotal - Number(payment.amount || 0)) > 0.01) {
                    throw new Error('Las asignaciones del pago no coinciden con el monto cargado.');
                }

                for (const allocation of payment.allocations || []) {
                    const itemKey = String(allocation.itemKey || '');
                    const nextAllocated = Number(((allocatedByItemKey.get(itemKey) || 0) + Number(allocation.amount || 0)).toFixed(2));
                    const itemTotal = Number(quoteItemTotalByKey.get(itemKey) || 0);
                    if (nextAllocated - itemTotal > 0.01) {
                        throw new Error('Un item quedó sobreasignado en los pagos configurados.');
                    }
                    allocatedByItemKey.set(itemKey, nextAllocated);
                }
            }
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

                const idempotencyConsumerLabel: string = (() => {
                    if (input.clientDraft?.name) {
                        const bits = [input.clientDraft.name, input.clientDraft.phone, input.clientDraft.dni]
                            .filter((v) => typeof v === 'string' && String(v).trim().length > 0)
                            .map((v) => String(v).trim());
                        return bits.join(' | ');
                    }
                    if (String(input.clientId || '').trim()) return 'cliente';
                    return 'Consumidor final';
                })();
                const description = `Venta mostrador (${idempotencyConsumerLabel})`;

                return {
                    accountId: existingAccount.id,
                    total,
                    description,
                    payments: existingPayments
                };
            }
        }

        const sale = await prisma.$transaction(async (tx) => {
            const resolvedClientId = await this.resolveClientIdForSaleTx(tx, {
                ...input,
                allowCreateMissing: Boolean(input.clientDraft)
            });

            const sourceId = `product-sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            const account = await tx.account.create({
                data: {
                    displayCode: generateDisplayCode('CTA'),
                    clubId: input.clubId,
                    sourceType: 'BAR',
                    sourceId,
                    status: 'OPEN',
                    totalAmount: new Prisma.Decimal(0),
                    paidAmount: new Prisma.Decimal(0),
                    idempotencyKey: input.idempotencyKey ?? null
                }
            });

            // Fase 1.6: "Consumidor final" cuando no hay cliente explícito.
            const consumerLabel: string = (() => {
                if (input.clientDraft?.name) {
                    const bits = [input.clientDraft.name, input.clientDraft.phone, input.clientDraft.dni]
                        .filter((v) => typeof v === 'string' && String(v).trim().length > 0)
                        .map((v) => String(v).trim());
                    return bits.join(' | ');
                }
                if (String(input.clientId || '').trim()) return 'cliente';
                return 'Consumidor final';
            })();
            const baseDescription = `Venta mostrador (${consumerLabel})`;

            const createdItems: Array<{ id: string }> = [];
            for (const qi of quote.items) {
                const productId = Number(qi.productId || 0);
                const product = productId > 0
                    ? await tx.product.findFirst({
                        where: { id: productId, clubId: input.clubId },
                        select: { id: true, stock: true, category: true, isActive: true }
                    })
                    : null;
                if (productId > 0 && !product) throw new Error('Producto no encontrado');
                if (product && !product.isActive) throw new Error('Producto inactivo');
                if (product && Number(product.stock) < Number(qi.quantity)) throw new Error('Stock insuficiente');

                const item = await tx.accountItem.create({
                    data: {
                        accountId: account.id,
                        type: 'PRODUCT',
                        productId: product ? product.id : null,
                        description: `${baseDescription}: ${qi.productName}`,
                        quantity: qi.quantity,
                        unitPrice: new Prisma.Decimal(qi.finalUnitPrice),
                        total: new Prisma.Decimal(qi.finalTotal)
                    }
                });
                createdItems.push({ id: item.id });

                if (resolvedClientId && product) {
                    const discountDraft = await this.discountService.computeDraftDiscountTx(tx, {
                        clubId: input.clubId,
                        clientId: resolvedClientId,
                        itemType: 'PRODUCT',
                        quantity: qi.quantity,
                        unitPrice: qi.listUnitPrice,
                        productId: product.id,
                        productCategory: product.category
                    });
                    if (discountDraft.snapshots?.length) {
                        await this.discountService.persistAppliedDiscountsTx(tx, {
                            clubId: input.clubId,
                            accountItemId: item.id,
                            appliedByUserId: actorUserId ?? null,
                            snapshots: discountDraft.snapshots
                        });
                    }
                }

                if (product) {
                    const stockUpdate = await tx.product.updateMany({
                        where: {
                            id: product.id,
                            clubId: input.clubId,
                            stock: { gte: Number(qi.quantity) }
                        },
                        data: { stock: { decrement: Number(qi.quantity) } }
                    });
                    if (stockUpdate.count !== 1) throw new Error('Stock insuficiente');
                }

                await this.accountingService.createAccountItemTransaction(tx, {
                    clubId: input.clubId,
                    type: 'ACCOUNT_ITEM',
                    referenceType: 'ACCOUNT_ITEM',
                    referenceId: item.id,
                    accountId: account.id,
                    accountItemId: item.id,
                    amount: Number(qi.finalTotal || 0),
                    revenueAccount: 'BAR_REVENUE',
                    description: `${baseDescription}: ${qi.productName}`,
                    createdByUserId: actorUserId ?? null
                });
            }

            await tx.account.update({
                where: { id: account.id },
                data: {
                    totalAmount: { increment: new Prisma.Decimal(total) }
                }
            });

            await this.projectionService.refreshAccountSummary(account.id, tx);
            const itemTotals = Array.isArray(quote.items)
                ? quote.items.map((i: any) => Number(i.finalTotal || 0))
                : [];
            const itemsGrandTotal = itemTotals.reduce((sum, value) => sum + Number(value || 0), 0);
            const accountItemIds = createdItems.map((i) => i.id);
            const accountItemIdByItemKey = new Map<string, string>(
                accountItemIds.map((accountItemId, index) => [
                    String(quote.items?.[index]?.itemKey || ''),
                    String(accountItemId)
                ])
            );
            const buildRoundedProportionalAllocations = (paymentAmount: number) => {
                if (!Array.isArray(accountItemIds) || accountItemIds.length === 0 || itemsGrandTotal <= 0.009) {
                    return undefined;
                }

                const roundedPaymentAmount = Number(Number(paymentAmount || 0).toFixed(2));
                let remainingAmount = roundedPaymentAmount;

                return accountItemIds
                    .map((accountItemId, index) => {
                        const isLastItem = index === accountItemIds.length - 1;
                        const amount = isLastItem
                            ? remainingAmount
                            : Number((((roundedPaymentAmount * Number(itemTotals[index] || 0)) / itemsGrandTotal) || 0).toFixed(2));
                        const safeAmount = Math.max(0, Number(amount.toFixed(2)));
                        remainingAmount = Number((remainingAmount - safeAmount).toFixed(2));

                        return {
                            accountItemId: String(accountItemId),
                            amount: safeAmount
                        };
                    })
                    .filter((allocation) => allocation.amount > 0.009);
            };

            const payments = [];
            for (const payment of resolvedPaymentPlan) {
                const explicitAllocations =
                    Array.isArray(payment.allocations) && payment.allocations.length > 0
                        ? payment.allocations.map((allocation) => ({
                            accountItemId: String(accountItemIdByItemKey.get(String(allocation.itemKey || '')) || ''),
                            amount: Number(Number(allocation.amount || 0).toFixed(2))
                        })).filter((allocation) => allocation.accountItemId && allocation.amount > 0.009)
                        : undefined;

                const created = await this.paymentService.createInTransaction(tx, {
                    clubId: input.clubId,
                    accountId: account.id,
                    amount: payment.amount,
                    method: payment.method as PaymentMethod,
                    channel: payment.method === 'TRANSFER' ? payment.channel : undefined,
                    source: 'POS',
                    createdByUserId: actorUserId ?? input.userId,
                    allocations:
                        explicitAllocations && explicitAllocations.length > 0
                            ? explicitAllocations
                            : Array.isArray(accountItemIds) &&
                              accountItemIds.length > 0 &&
                              itemsGrandTotal > 0.009
                            ? buildRoundedProportionalAllocations(payment.amount)
                            : undefined
                });
                payments.push(created);
            }

            return {
                accountId: account.id,
                total,
                description: baseDescription,
                payments
            };
        });

        return sale;
    }
}
