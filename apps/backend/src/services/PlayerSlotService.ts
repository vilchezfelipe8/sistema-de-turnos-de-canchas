import { MemberPriceValidation, Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, conflict, notFound } from '../errors';
import { PricingService } from './PricingService';
import { DiscountService } from './DiscountService';
import { AccountingService } from './AccountingService';
import { ProjectionService } from './ProjectionService';
import { isMemberCurrent, localDateKey } from './MemberService';

// Precio por jugador (docs/socios-y-precios-diferenciados.md §6.2 y §6.5).
// Cada reserva de un club en modo PER_PLAYER tiene `playerCount` lugares (BookingPlayerSlot).
// Parte de un lugar = precio por jugador de la modalidad para su categoría (o no socio) + luces / jugadores.

type TxClient = Prisma.TransactionClient;
type DbClient = TxClient | typeof prisma;

const round2 = (value: number) => Number(Number(value || 0).toFixed(2));
const EPSILON = 0.009;

// Solo estas validaciones dan precio socio (D9).
const VALIDATED_FOR_MEMBER_PRICE: MemberPriceValidation[] = ['SELF', 'ACCEPTED', 'STAFF_VALIDATED'];

export type PlayerSlotDto = {
  slotIndex: number;
  participantId: string | null;
  clientId: string | null;
  userId: number | null;
  displayName: string | null;
  isEmpty: boolean;
  memberPriceValidation: MemberPriceValidation;
  // Categoría con la que se cobró (vacía si paga como no socio).
  pricingMemberCategoryId: string | null;
  pricingMemberCategoryName: string | null;
  // El jugador es socio vigente pero su precio socio todavía no se validó (D9).
  memberPricePending: boolean;
  shareListAmount: number;
  shareAmount: number;
  accountItemId: string | null;
  paidAmount: number;
  isFrozen: boolean;
};

export type PerPlayerQuote = {
  activityFormatId: string;
  formatName: string;
  playerCount: number;
  generalPricePerPlayer: number;
  // Precio por jugador para el titular (socio vigente o general)
  ownerPricePerPlayer: number;
  ownerMemberCategoryName: string | null;
  lightsExtra: number;
  lightsPerSlot: number;
  // Titular con su precio + resto de lugares a precio general
  estimatedTotal: number;
  listTotal: number;
};

// Reparte el recargo de luces en partes iguales; los centavos sobrantes van al lugar 1 (D10b).
export function splitLightsForSlot(lightsExtra: number, playerCount: number, slotIndex: number) {
  if (!(lightsExtra > 0) || !(playerCount > 0)) return 0;
  const base = Math.floor((lightsExtra / playerCount) * 100) / 100;
  const remainder = round2(lightsExtra - base * playerCount);
  return round2(slotIndex === 1 ? base + remainder : base);
}

type SlotForPricing = {
  slotIndex: number;
  clientId: string | null;
  memberPriceValidation: MemberPriceValidation;
};

export class PlayerSlotService {
  private readonly discountService = new DiscountService();
  private readonly accountingService = new AccountingService();
  private readonly projectionService = new ProjectionService();

  // ---------- Configuración ----------

  async getPricingMode(clubId: number, db: DbClient = prisma) {
    const settings = await db.clubSettings.findUnique({ where: { clubId }, select: { pricingMode: true } });
    return settings?.pricingMode ?? 'PER_COURT';
  }

  async isPerPlayerClub(clubId: number, db: DbClient = prisma) {
    return (await this.getPricingMode(clubId, db)) === 'PER_PLAYER';
  }

  async setPricingMode(clubId: number, pricingMode: 'PER_COURT' | 'PER_PLAYER', actorUserId: number | null) {
    await prisma.clubSettings.upsert({
      where: { clubId },
      update: { pricingMode },
      create: { clubId, pricingMode }
    });
    await prisma.auditLog.create({
      data: {
        clubId,
        userId: actorUserId,
        entity: 'CLUB_SETTINGS',
        entityId: String(clubId),
        action: 'PRICING_MODE_CHANGED',
        payload: { pricingMode }
      }
    });
    return { pricingMode };
  }

  async listFormats(clubId: number) {
    return prisma.activityFormat.findMany({
      where: { clubId },
      orderBy: [{ activityTypeId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { activityType: { select: { id: true, name: true } } }
    });
  }

  private assertDuration(durationMinutes: number | null | undefined) {
    if (durationMinutes === null || durationMinutes === undefined) return;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 600 || durationMinutes % 5 !== 0) {
      throw badRequest('La duración debe estar entre 15 y 600 minutos, en múltiplos de 5.', ErrorCodes.INVALID_INPUT);
    }
  }

  async createFormat(input: { clubId: number; activityTypeId: number; name: string; playerCount: number; durationMinutes?: number | null; sortOrder?: number }) {
    const activity = await prisma.activityType.findFirst({ where: { id: input.activityTypeId, clubId: input.clubId } });
    if (!activity) throw notFound('Actividad no encontrada.', ErrorCodes.ACTIVITY_NOT_FOUND);
    if (!Number.isInteger(input.playerCount) || input.playerCount < 1 || input.playerCount > 30) {
      throw badRequest('La cantidad de jugadores debe estar entre 1 y 30.', ErrorCodes.INVALID_INPUT);
    }
    this.assertDuration(input.durationMinutes);
    try {
      return await prisma.activityFormat.create({
        data: {
          clubId: input.clubId,
          activityTypeId: activity.id,
          name: input.name.trim(),
          playerCount: input.playerCount,
          durationMinutes: input.durationMinutes ?? null,
          sortOrder: input.sortOrder ?? 0
        }
      });
    } catch (error) {
      if ((error as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
        throw conflict('Esa actividad ya tiene una modalidad con ese nombre.', ErrorCodes.INVALID_INPUT);
      }
      throw error;
    }
  }

  async updateFormat(input: { clubId: number; formatId: string; name?: string; playerCount?: number; durationMinutes?: number | null; sortOrder?: number; isActive?: boolean }) {
    const format = await prisma.activityFormat.findFirst({ where: { id: input.formatId, clubId: input.clubId } });
    if (!format) throw notFound('Modalidad no encontrada.', ErrorCodes.NOT_FOUND);
    if (input.playerCount !== undefined && input.playerCount !== format.playerCount) {
      // Cambiar la cantidad de jugadores no altera reservas existentes (guardan su propio playerCount).
      if (!Number.isInteger(input.playerCount) || input.playerCount < 1 || input.playerCount > 30) {
        throw badRequest('La cantidad de jugadores debe estar entre 1 y 30.', ErrorCodes.INVALID_INPUT);
      }
    }
    this.assertDuration(input.durationMinutes);
    // RN-15: no se desactiva una modalidad con reservas futuras activas.
    if (input.isActive === false && format.isActive) {
      const upcoming = await prisma.booking.count({
        where: { activityFormatId: format.id, status: { in: ['PENDING', 'CONFIRMED'] }, startDateTime: { gt: new Date() } }
      });
      if (upcoming > 0) {
        throw conflict(`La modalidad tiene ${upcoming} reserva(s) futura(s). Esperá a que pasen o cancelalas antes de desactivarla.`, ErrorCodes.INVALID_INPUT);
      }
    }
    return prisma.activityFormat.update({
      where: { id: format.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.playerCount !== undefined ? { playerCount: input.playerCount } : {}),
        ...(input.durationMinutes !== undefined ? { durationMinutes: input.durationMinutes } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
      }
    });
  }

  async getPriceTable(clubId: number) {
    const [formats, categories, rules] = await Promise.all([
      prisma.activityFormat.findMany({
        where: { clubId },
        orderBy: [{ activityTypeId: 'asc' }, { sortOrder: 'asc' }],
        include: { activityType: { select: { id: true, name: true } } }
      }),
      prisma.memberCategory.findMany({ where: { clubId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.playerPriceRule.findMany({ where: { clubId } })
    ]);
    return {
      formats: formats.map((format) => ({
        id: format.id,
        name: format.name,
        playerCount: format.playerCount,
        isActive: format.isActive,
        activityTypeId: format.activityTypeId,
        activityName: format.activityType.name
      })),
      categories: categories.map((category) => ({ id: category.id, name: category.name, isActive: category.isActive })),
      prices: rules.map((rule) => ({
        activityFormatId: rule.activityFormatId,
        memberCategoryId: rule.memberCategoryId,
        pricePerPlayer: Number(rule.pricePerPlayer)
      }))
    };
  }

  // Reemplaza los precios enviados. Un precio null borra la celda (la categoría vuelve a pagar el general).
  async upsertPrices(input: {
    clubId: number;
    actorUserId: number | null;
    prices: Array<{ activityFormatId: string; memberCategoryId: string | null; pricePerPlayer: number | null }>;
  }) {
    const formatIds = Array.from(new Set(input.prices.map((p) => p.activityFormatId)));
    const formats = await prisma.activityFormat.findMany({ where: { id: { in: formatIds }, clubId: input.clubId }, select: { id: true } });
    if (formats.length !== formatIds.length) throw notFound('Modalidad no encontrada.', ErrorCodes.NOT_FOUND);
    const categoryIds = Array.from(new Set(input.prices.map((p) => p.memberCategoryId).filter(Boolean))) as string[];
    if (categoryIds.length) {
      const categories = await prisma.memberCategory.count({ where: { id: { in: categoryIds }, clubId: input.clubId } });
      if (categories !== categoryIds.length) throw notFound('Categoría no encontrada.', ErrorCodes.MEMBER_CATEGORY_NOT_FOUND);
    }

    await prisma.$transaction(async (tx) => {
      for (const price of input.prices) {
        const where = { clubId: input.clubId, activityFormatId: price.activityFormatId, memberCategoryId: price.memberCategoryId };
        const existing = await tx.playerPriceRule.findFirst({ where });
        if (price.pricePerPlayer === null) {
          if (existing) await tx.playerPriceRule.delete({ where: { id: existing.id } });
          continue;
        }
        if (!Number.isFinite(price.pricePerPlayer) || price.pricePerPlayer < 0) {
          throw badRequest('Los precios deben ser números positivos.', ErrorCodes.INVALID_INPUT);
        }
        if (existing) {
          await tx.playerPriceRule.update({ where: { id: existing.id }, data: { pricePerPlayer: round2(price.pricePerPlayer) } });
        } else {
          await tx.playerPriceRule.create({ data: { ...where, pricePerPlayer: round2(price.pricePerPlayer) } });
        }
      }
      await tx.auditLog.create({
        data: {
          clubId: input.clubId,
          userId: input.actorUserId,
          entity: 'PLAYER_PRICE_RULE',
          entityId: String(input.clubId),
          action: 'PLAYER_PRICES_UPDATED',
          payload: { prices: input.prices } as Prisma.InputJsonValue
        }
      });
    });
    return this.getPriceTable(input.clubId);
  }

  // ---------- Cálculo ----------

  // Duración fija de la modalidad elegida (null = se usan las duraciones de la actividad).
  async resolveFormatDurationTx(
    db: DbClient,
    input: { clubId: number; activityId: number; activityFormatId: string | null | undefined }
  ): Promise<{ durationMinutes: number; formatName: string } | null> {
    const formatId = String(input.activityFormatId || '').trim();
    if (!formatId || !(await this.isPerPlayerClub(input.clubId, db))) return null;
    const format = await db.activityFormat.findFirst({
      where: { id: formatId, clubId: input.clubId, activityTypeId: input.activityId },
      select: { name: true, durationMinutes: true }
    });
    return format?.durationMinutes ? { durationMinutes: format.durationMinutes, formatName: format.name } : null;
  }

  async resolveFormatTx(db: DbClient, input: { clubId: number; activityId: number; activityFormatId: string | null | undefined }) {
    const formatId = String(input.activityFormatId || '').trim();
    if (!formatId) throw badRequest('Elegí la modalidad del turno.', ErrorCodes.INVALID_INPUT, { field: 'activityFormatId' });
    const format = await db.activityFormat.findFirst({
      where: { id: formatId, clubId: input.clubId, activityTypeId: input.activityId, isActive: true }
    });
    if (!format) throw badRequest('La modalidad no existe o no está activa para esta actividad.', ErrorCodes.INVALID_INPUT, { field: 'activityFormatId' });
    return format;
  }

  // Precio por jugador de la modalidad. Sin regla de categoría → precio general (sin beneficio).
  // Sin precio general → la modalidad no se puede reservar (E9).
  private async loadFormatPricesTx(db: DbClient, activityFormatId: string) {
    const rules = await db.playerPriceRule.findMany({ where: { activityFormatId } });
    const general = rules.find((rule) => rule.memberCategoryId === null);
    if (!general) {
      throw conflict('La modalidad no tiene precio por jugador cargado para no socios.', ErrorCodes.CLUB_CONFIG_INVALID);
    }
    const byCategory = new Map<string, number>();
    for (const rule of rules) {
      if (rule.memberCategoryId) byCategory.set(rule.memberCategoryId, Number(rule.pricePerPlayer));
    }
    return {
      general: Number(general.pricePerPlayer),
      priceFor: (categoryId: string | null) =>
        categoryId && byCategory.has(categoryId) ? byCategory.get(categoryId)! : Number(general.pricePerPlayer)
    };
  }

  private async loadClubPricingContextTx(db: DbClient, clubId: number) {
    const settings = await db.clubSettings.findUnique({
      where: { clubId },
      select: { timeZone: true, lightsEnabled: true, lightsExtraAmount: true, lightsFromHour: true, membersEnabled: true }
    });
    return {
      timeZone: settings?.timeZone || 'America/Argentina/Buenos_Aires',
      membersEnabled: Boolean(settings?.membersEnabled),
      lights: {
        lightsEnabled: settings?.lightsEnabled ?? false,
        lightsExtraAmount: settings?.lightsExtraAmount == null ? null : Number(settings.lightsExtraAmount),
        lightsFromHour: settings?.lightsFromHour ?? null
      }
    };
  }

  // Categoría vigente del cliente a la fecha del turno (RN-01), sin mirar la validación.
  private async loadCurrentCategoriesTx(
    db: DbClient,
    clubId: number,
    clientIds: string[],
    atDateKey: string,
    membersEnabled: boolean
  ) {
    const result = new Map<string, { categoryId: string; categoryName: string }>();
    const ids = Array.from(new Set(clientIds.filter(Boolean)));
    if (!membersEnabled || !ids.length) return result;
    const members = await db.clubMember.findMany({
      where: { clubId, clientId: { in: ids } },
      include: { category: { select: { name: true, isActive: true } } }
    });
    for (const member of members) {
      if (isMemberCurrent(member, atDateKey)) {
        result.set(member.clientId, { categoryId: member.categoryId, categoryName: member.category.name });
      }
    }
    return result;
  }


  async computeSlotAmountsTx(
    db: DbClient,
    input: {
      clubId: number;
      activityFormatId: string;
      playerCount: number;
      startDateTime: Date;
      slots: SlotForPricing[];
    }
  ) {
    const context = await this.loadClubPricingContextTx(db, input.clubId);
    const prices = await this.loadFormatPricesTx(db, input.activityFormatId);
    const lightsExtra = PricingService.computeLightsExtra(input.startDateTime, context.timeZone, context.lights);
    const lightsFor = (slotIndex: number) => splitLightsForSlot(lightsExtra, input.playerCount, slotIndex);
    const dateKey = localDateKey(input.startDateTime, context.timeZone);
    const currentCategories = await this.loadCurrentCategoriesTx(
      db,
      input.clubId,
      input.slots.map((slot) => slot.clientId || ''),
      dateKey,
      context.membersEnabled
    );

    return input.slots.map((slot) => {
      const current = slot.clientId ? currentCategories.get(slot.clientId) ?? null : null;
      const effectiveCategoryId =
        current && VALIDATED_FOR_MEMBER_PRICE.includes(slot.memberPriceValidation) ? current.categoryId : null;
      const lights = lightsFor(slot.slotIndex);
      return {
        slotIndex: slot.slotIndex,
        pricingMemberCategoryId: effectiveCategoryId,
        currentCategory: current,
        shareListAmount: round2(prices.general + lights),
        shareAmount: round2(prices.priceFor(effectiveCategoryId) + lights)
      };
    });
  }

  // Cotización para la grilla y el presupuesto: titular con su precio, resto a precio general.
  async quotePerPlayer(input: {
    clubId: number;
    activityId: number;
    activityFormatId: string | null | undefined;
    startDateTime: Date;
    ownerClientId: string | null;
  }): Promise<PerPlayerQuote> {
    const format = await this.resolveFormatTx(prisma, input);
    const slots: SlotForPricing[] = Array.from({ length: format.playerCount }, (_, index) => ({
      slotIndex: index + 1,
      clientId: index === 0 ? input.ownerClientId : null,
      memberPriceValidation: index === 0 && input.ownerClientId ? 'SELF' : 'NOT_MEMBER'
    }));
    const amounts = await this.computeSlotAmountsTx(prisma, {
      clubId: input.clubId,
      activityFormatId: format.id,
      playerCount: format.playerCount,
      startDateTime: input.startDateTime,
      slots
    });
    const context = await this.loadClubPricingContextTx(prisma, input.clubId);
    const lightsExtra = PricingService.computeLightsExtra(input.startDateTime, context.timeZone, context.lights);
    const prices = await this.loadFormatPricesTx(prisma, format.id);
    const owner = amounts[0];
    return {
      activityFormatId: format.id,
      formatName: format.name,
      playerCount: format.playerCount,
      generalPricePerPlayer: prices.general,
      ownerPricePerPlayer: prices.priceFor(owner.pricingMemberCategoryId),
      ownerMemberCategoryName: owner.pricingMemberCategoryId ? owner.currentCategory?.categoryName ?? null : null,
      lightsExtra,
      lightsPerSlot: round2(lightsExtra / format.playerCount),
      estimatedTotal: round2(amounts.reduce((sum, slot) => sum + slot.shareAmount, 0)),
      listTotal: round2(amounts.reduce((sum, slot) => sum + slot.shareListAmount, 0))
    };
  }

  // ---------- Lugares ----------

  private async slotPaidAmountTx(db: DbClient, accountItemId: string | null) {
    if (!accountItemId) return 0;
    const allocated = await db.paymentAllocation.aggregate({ where: { accountItemId }, _sum: { amount: true } });
    return round2(Number(allocated._sum.amount || 0));
  }

  // Crea los lugares de una reserva nueva: lugar 1 = titular, resto vacíos.
  async initializeSlotsTx(
    tx: TxClient,
    input: {
      bookingId: number;
      clubId: number;
      activityFormatId: string;
      playerCount: number;
      startDateTime: Date;
      owner: { participantId: string | null; clientId: string; userId: number | null; displayName: string | null };
      // Titular autenticado con ficha vinculada (SELF), cargado por el staff (STAFF_VALIDATED)
      // o con ficha encontrada por datos declarados (PENDING).
      ownerValidation: 'SELF' | 'STAFF_VALIDATED' | 'PENDING';
      actorUserId: number | null;
    }
  ) {
    const slots: SlotForPricing[] = Array.from({ length: input.playerCount }, (_, index) => ({
      slotIndex: index + 1,
      clientId: index === 0 ? input.owner.clientId : null,
      memberPriceValidation: index === 0 ? input.ownerValidation : 'NOT_MEMBER'
    }));
    const amounts = await this.computeSlotAmountsTx(tx, {
      clubId: input.clubId,
      activityFormatId: input.activityFormatId,
      playerCount: input.playerCount,
      startDateTime: input.startDateTime,
      slots
    });

    await tx.bookingPlayerSlot.createMany({
      data: amounts.map((amount) => ({
        bookingId: input.bookingId,
        clubId: input.clubId,
        slotIndex: amount.slotIndex,
        participantId: amount.slotIndex === 1 ? input.owner.participantId : null,
        clientId: amount.slotIndex === 1 ? input.owner.clientId : null,
        userId: amount.slotIndex === 1 ? input.owner.userId : null,
        displayName: amount.slotIndex === 1 ? input.owner.displayName : null,
        memberPriceValidation: amount.slotIndex === 1 ? input.ownerValidation : 'NOT_MEMBER',
        memberValidatedByUserId: amount.slotIndex === 1 && input.ownerValidation === 'STAFF_VALIDATED' ? input.actorUserId : null,
        pricingMemberCategoryId: amount.pricingMemberCategoryId,
        shareListAmount: amount.shareListAmount,
        shareAmount: amount.shareAmount
      }))
    });

    return this.applyBookingTotalsTx(tx, input.bookingId);
  }

  // Ocupa un lugar libre (o el indicado) con un jugador. Si es socio y lo cargó otro, queda PENDING (D9).
  async assignSlotTx(
    tx: TxClient,
    input: {
      bookingId: number;
      slotIndex?: number | null;
      participantId: string | null;
      clientId: string | null;
      userId: number | null;
      displayName: string | null;
      validation: MemberPriceValidation;
      actorUserId: number | null;
    }
  ) {
    const slots = await tx.bookingPlayerSlot.findMany({ where: { bookingId: input.bookingId }, orderBy: { slotIndex: 'asc' } });
    if (!slots.length) return null;

    const alreadyIn = slots.find(
      (slot) =>
        (input.participantId && slot.participantId === input.participantId) ||
        (input.clientId && slot.clientId === input.clientId) ||
        (input.userId && slot.userId === input.userId)
    );
    if (alreadyIn && alreadyIn.slotIndex !== input.slotIndex) {
      throw conflict('Ese jugador ya ocupa un lugar en la reserva.', ErrorCodes.BOOKING_PARTICIPANT_ALREADY_EXISTS);
    }

    const isEmpty = (slot: (typeof slots)[number]) => !slot.participantId && !slot.clientId && !slot.userId;
    const target = input.slotIndex ? slots.find((slot) => slot.slotIndex === input.slotIndex) : slots.find(isEmpty);
    if (!target) {
      throw conflict('No quedan lugares libres en esta reserva.', ErrorCodes.BOOKING_FULL);
    }
    if (!isEmpty(target) && target.slotIndex !== 1) {
      throw conflict('Ese lugar ya está ocupado.', ErrorCodes.BOOKING_FULL);
    }
    if (await this.slotPaidAmountTx(tx, target.accountItemId) > EPSILON) {
      throw conflict('Ese lugar ya tiene pagos. Resolvé el pago antes de cambiar el jugador.', ErrorCodes.CONFLICT);
    }

    await tx.bookingPlayerSlot.update({
      where: { id: target.id },
      data: {
        participantId: input.participantId,
        clientId: input.clientId,
        userId: input.userId,
        displayName: input.displayName,
        memberPriceValidation: input.validation,
        memberValidatedByUserId: input.validation === 'STAFF_VALIDATED' ? input.actorUserId : null
      }
    });
    await this.recalculateSlotsTx(tx, input.bookingId, { actorUserId: input.actorUserId, slotIndexes: [target.slotIndex] });
    return target.slotIndex;
  }

  // Suma un participante a un lugar de una reserva por jugador. Un socio cargado por otra persona
  // queda PENDING hasta que confirme desde su cuenta o lo valide el staff (D9). Sin lugares → no hace nada.
  async assignParticipantTx(
    tx: TxClient,
    input: {
      bookingId: number;
      participantId: string;
      clientId: string | null;
      userId: number | null;
      displayName: string | null;
      slotIndex?: number | null;
      actorUserId: number | null;
    }
  ) {
    const hasSlots = (await tx.bookingPlayerSlot.count({ where: { bookingId: input.bookingId } })) > 0;
    if (!hasSlots) return null;
    const booking = await tx.booking.findUnique({ where: { id: input.bookingId }, select: { clubId: true, startDateTime: true } });
    if (!booking) return null;
    const context = await this.loadClubPricingContextTx(tx, booking.clubId);
    const current = input.clientId
      ? await this.loadCurrentCategoriesTx(tx, booking.clubId, [input.clientId], localDateKey(booking.startDateTime, context.timeZone), context.membersEnabled)
      : new Map();
    return this.assignSlotTx(tx, {
      bookingId: input.bookingId,
      slotIndex: input.slotIndex ?? null,
      participantId: input.participantId,
      clientId: input.clientId,
      userId: input.userId,
      displayName: input.displayName,
      validation: input.clientId && current.has(input.clientId) ? 'PENDING' : 'NOT_MEMBER',
      actorUserId: input.actorUserId
    });
  }

  // Asegura que la reserva tenga un lugar libre antes de sumar a alguien (RN-08).
  async assertHasFreeSlotTx(tx: TxClient, bookingId: number) {
    const slots = await tx.bookingPlayerSlot.findMany({ where: { bookingId }, select: { participantId: true, clientId: true, userId: true } });
    if (!slots.length) return;
    if (!slots.some((slot) => !slot.participantId && !slot.clientId && !slot.userId)) {
      throw conflict('No quedan lugares libres en esta reserva.', ErrorCodes.BOOKING_FULL);
    }
  }

  // Libera el lugar de un participante (se baja, se lo quita, rechaza la invitación).
  // RN-05d: si su parte tiene pagos no se libera.
  async releaseParticipantSlotTx(tx: TxClient, input: { bookingId: number; participantId: string; actorUserId: number | null }) {
    const slot = await tx.bookingPlayerSlot.findFirst({ where: { bookingId: input.bookingId, participantId: input.participantId } });
    if (!slot) return;
    if (slot.slotIndex === 1) return; // el titular se cambia con changeBookingClient
    if (await this.slotPaidAmountTx(tx, slot.accountItemId) > EPSILON) {
      throw conflict(
        'Este jugador ya pagó su parte. Resolvé el pago (devolución o traspaso) antes de liberar el lugar.',
        ErrorCodes.CONFLICT
      );
    }
    await tx.bookingPlayerSlot.update({
      where: { id: slot.id },
      data: {
        participantId: null,
        clientId: null,
        userId: null,
        displayName: null,
        memberPriceValidation: 'NOT_MEMBER',
        memberValidatedByUserId: null
      }
    });
    await this.recalculateSlotsTx(tx, input.bookingId, { actorUserId: input.actorUserId, slotIndexes: [slot.slotIndex] });
  }

  // El jugador aceptó la invitación desde su cuenta: su precio socio queda confirmado.
  async markParticipantAcceptedTx(
    tx: TxClient,
    input: { bookingId: number; participantId: string; clientId: string | null; userId: number; actorUserId: number | null }
  ) {
    const slot = await tx.bookingPlayerSlot.findFirst({ where: { bookingId: input.bookingId, participantId: input.participantId } });
    if (!slot) return;
    await tx.bookingPlayerSlot.update({
      where: { id: slot.id },
      data: {
        clientId: input.clientId ?? slot.clientId,
        userId: input.userId,
        memberPriceValidation: 'ACCEPTED'
      }
    });
    await this.recalculateSlotsTx(tx, input.bookingId, { actorUserId: input.actorUserId, slotIndexes: [slot.slotIndex] });
  }

  // Cambio de titular = cambiar el jugador del lugar 1 (RN-06).
  async replaceOwnerSlotTx(
    tx: TxClient,
    input: { bookingId: number; participantId: string | null; clientId: string; userId: number | null; displayName: string | null; actorUserId: number | null }
  ) {
    const slot = await tx.bookingPlayerSlot.findFirst({ where: { bookingId: input.bookingId, slotIndex: 1 } });
    if (!slot) return;
    if (await this.slotPaidAmountTx(tx, slot.accountItemId) > EPSILON) {
      throw conflict('La parte del titular ya tiene pagos. Resolvé el pago antes de cambiar el titular.', ErrorCodes.CONFLICT);
    }
    await tx.bookingPlayerSlot.update({
      where: { id: slot.id },
      data: {
        participantId: input.participantId,
        clientId: input.clientId,
        userId: input.userId,
        displayName: input.displayName,
        memberPriceValidation: 'STAFF_VALIDATED',
        memberValidatedByUserId: input.actorUserId
      }
    });
    await this.recalculateSlotsTx(tx, input.bookingId, { actorUserId: input.actorUserId, slotIndexes: [1] });
  }

  // Validación presencial del socio en el mostrador (D9).
  async validateMemberAtCounter(input: { bookingId: number; clubId: number; slotIndex: number; actorUserId: number | null }) {
    return prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({ where: { id: input.bookingId, clubId: input.clubId } });
      if (!booking) throw notFound('Reserva no encontrada.', ErrorCodes.BOOKING_NOT_FOUND);
      this.assertBookingEditable(booking);
      const slot = await tx.bookingPlayerSlot.findFirst({ where: { bookingId: booking.id, slotIndex: input.slotIndex } });
      if (!slot || !slot.clientId) throw badRequest('El lugar no tiene un jugador identificado.', ErrorCodes.INVALID_INPUT);
      if (await this.slotPaidAmountTx(tx, slot.accountItemId) > EPSILON) {
        throw conflict('Ese lugar ya tiene pagos; su parte no se modifica.', ErrorCodes.CONFLICT);
      }
      await tx.bookingPlayerSlot.update({
        where: { id: slot.id },
        data: { memberPriceValidation: 'STAFF_VALIDATED', memberValidatedByUserId: input.actorUserId }
      });
      await tx.auditLog.create({
        data: {
          clubId: input.clubId,
          userId: input.actorUserId,
          entity: 'BOOKING',
          entityId: String(booking.id),
          action: 'BOOKING_MEMBER_VALIDATED_AT_COUNTER',
          payload: { slotIndex: input.slotIndex, clientId: slot.clientId }
        }
      });
      await this.recalculateSlotsTx(tx, booking.id, { actorUserId: input.actorUserId, slotIndexes: [slot.slotIndex] });
      return this.getSlotsTx(tx, booking.id);
    });
  }

  // RN-07 / §7.4: un admin recalcula las partes sin pagos con la condición actual de cada jugador.
  async repriceBooking(input: { bookingId: number; clubId: number; actorUserId: number | null }) {
    return prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({ where: { id: input.bookingId, clubId: input.clubId } });
      if (!booking) throw notFound('Reserva no encontrada.', ErrorCodes.BOOKING_NOT_FOUND);
      this.assertBookingEditable(booking);
      await this.recalculateSlotsTx(tx, booking.id, { actorUserId: input.actorUserId });
      await tx.auditLog.create({
        data: {
          clubId: input.clubId,
          userId: input.actorUserId,
          entity: 'BOOKING',
          entityId: String(booking.id),
          action: 'BOOKING_REPRICED',
          payload: {}
        }
      });
      return this.getSlotsTx(tx, booking.id);
    });
  }

  private assertBookingEditable(booking: { status: string }) {
    // RN-06: completadas o canceladas no se recalculan.
    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      throw conflict('La reserva ya está cerrada; sus precios no se modifican.', ErrorCodes.BOOKING_INVALID_STATUS);
    }
  }

  // Recalcula las partes de los lugares (todos o los indicados) que no tengan pagos y sincroniza la cuenta.
  async recalculateSlotsTx(tx: TxClient, bookingId: number, options: { actorUserId: number | null; slotIndexes?: number[] }) {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || !booking.activityFormatId || !booking.playerCount) return null;
    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') return null;

    const slots = await tx.bookingPlayerSlot.findMany({ where: { bookingId }, orderBy: { slotIndex: 'asc' } });
    const amounts = await this.computeSlotAmountsTx(tx, {
      clubId: booking.clubId,
      activityFormatId: booking.activityFormatId,
      playerCount: booking.playerCount,
      startDateTime: booking.startDateTime,
      slots
    });
    const targets = new Set(options.slotIndexes ?? slots.map((slot) => slot.slotIndex));

    for (const slot of slots) {
      if (!targets.has(slot.slotIndex)) continue;
      if (await this.slotPaidAmountTx(tx, slot.accountItemId) > EPSILON) continue; // RN-05d
      const amount = amounts.find((row) => row.slotIndex === slot.slotIndex)!;
      await tx.bookingPlayerSlot.update({
        where: { id: slot.id },
        data: {
          pricingMemberCategoryId: amount.pricingMemberCategoryId,
          shareListAmount: amount.shareListAmount,
          shareAmount: amount.shareAmount,
          sharePricedAt: new Date()
        }
      });
    }

    await this.syncAccountItemsTx(tx, bookingId, options.actorUserId);
    return this.applyBookingTotalsTx(tx, bookingId);
  }

  // ---------- Cuenta ----------

  private async describeSlotTx(db: DbClient, slot: { slotIndex: number; displayName: string | null; clientId: string | null; pricingMemberCategoryId: string | null }) {
    let name = slot.displayName;
    if (!name && slot.clientId) {
      const client = await db.client.findUnique({ where: { id: slot.clientId }, select: { name: true } });
      name = client?.name ?? null;
    }
    if (!name) return `Cancha — Lugar ${slot.slotIndex} (sin asignar)`;
    let condition = 'No socio';
    if (slot.pricingMemberCategoryId) {
      const category = await db.memberCategory.findUnique({ where: { id: slot.pricingMemberCategoryId }, select: { name: true } });
      condition = `Socio ${category?.name ?? ''}`.trim();
    }
    return `Cancha — ${name} (${condition})`;
  }

  // Un ítem BOOKING por lugar. Crea los que faltan y ajusta los que no tienen pagos.
  // Si la cuenta todavía no existe (estrategia lazy) no hace nada: se sincroniza al crearla.
  async syncAccountItemsTx(tx: TxClient, bookingId: number, actorUserId: number | null) {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || !booking.activityFormatId) return null;
    const account = await tx.account.findFirst({
      where: { clubId: booking.clubId, sourceType: 'BOOKING', sourceId: String(bookingId) }
    });
    if (!account || account.status !== 'OPEN') return null;

    const slots = await tx.bookingPlayerSlot.findMany({ where: { bookingId }, orderBy: { slotIndex: 'asc' } });
    let totalDelta = 0;

    for (const slot of slots) {
      const description = await this.describeSlotTx(tx, slot);
      const discount = await this.discountService.computeDraftDiscountTx(tx, {
        clubId: booking.clubId,
        clientId: slot.clientId,
        itemType: 'BOOKING',
        quantity: 1,
        unitPrice: Number(slot.shareAmount),
        activityTypeId: booking.activityId
      });
      const desiredTotal = round2(discount.total);

      if (!slot.accountItemId) {
        const item = await tx.accountItem.create({
          data: {
            accountId: account.id,
            type: 'BOOKING',
            description,
            quantity: 1,
            unitPrice: desiredTotal,
            total: desiredTotal,
            clientId: slot.clientId
          }
        });
        await this.accountingService.createAccountItemTransaction(tx, {
          clubId: booking.clubId,
          type: 'ACCOUNT_ITEM',
          referenceType: 'BOOKING',
          referenceId: String(bookingId),
          accountId: account.id,
          accountItemId: item.id,
          amount: desiredTotal,
          revenueAccount: 'BOOKING_REVENUE',
          description: `Reserva cancha #${bookingId} — lugar ${slot.slotIndex}`,
          createdByUserId: actorUserId
        });
        if (discount.snapshots.length) {
          await this.discountService.persistAppliedDiscountsTx(tx, {
            clubId: booking.clubId,
            accountItemId: item.id,
            appliedByUserId: actorUserId,
            snapshots: discount.snapshots
          });
        }
        await tx.bookingPlayerSlot.update({ where: { id: slot.id }, data: { accountItemId: item.id } });
        totalDelta += desiredTotal;
        continue;
      }

      const item = await tx.accountItem.findUnique({ where: { id: slot.accountItemId } });
      if (!item) continue;
      if (await this.slotPaidAmountTx(tx, item.id) > EPSILON) continue; // parte congelada

      const currentTotal = round2(Number(item.total));
      if (Math.abs(currentTotal - desiredTotal) > EPSILON) {
        await this.accountingService.reverseAccountItemTransaction(tx, {
          clubId: booking.clubId,
          type: 'ACCOUNT_ITEM',
          referenceType: 'ACCOUNT_ITEM',
          referenceId: item.id,
          accountId: account.id,
          accountItemId: item.id,
          amount: currentTotal,
          revenueAccount: 'BOOKING_REVENUE',
          description: `Reversión lugar ${slot.slotIndex} reserva #${bookingId}`,
          createdByUserId: actorUserId
        });
        await this.accountingService.createAccountItemTransaction(tx, {
          clubId: booking.clubId,
          type: 'ACCOUNT_ITEM',
          referenceType: 'BOOKING',
          referenceId: String(bookingId),
          accountId: account.id,
          accountItemId: item.id,
          amount: desiredTotal,
          revenueAccount: 'BOOKING_REVENUE',
          description: `Reserva cancha #${bookingId} — lugar ${slot.slotIndex}`,
          createdByUserId: actorUserId
        });
        await tx.accountItemDiscount.deleteMany({ where: { accountItemId: item.id } });
        if (discount.snapshots.length) {
          await this.discountService.persistAppliedDiscountsTx(tx, {
            clubId: booking.clubId,
            accountItemId: item.id,
            appliedByUserId: actorUserId,
            snapshots: discount.snapshots
          });
        }
        totalDelta += desiredTotal - currentTotal;
      }
      await tx.accountItem.update({
        where: { id: item.id },
        data: { description, unitPrice: desiredTotal, total: desiredTotal, clientId: slot.clientId }
      });
    }

    if (Math.abs(totalDelta) > EPSILON) {
      const nextTotal = round2(Number(account.totalAmount) + totalDelta);
      const paid = round2(Number(account.paidAmount));
      if (paid > nextTotal + EPSILON) {
        throw conflict('El cambio dejaría la cuenta sobrepagada. Revisá los pagos antes de continuar.', ErrorCodes.PAYMENT_OVERPAY);
      }
      await tx.account.update({ where: { id: account.id }, data: { totalAmount: nextTotal } });
    }
    await this.projectionService.refreshAccountSummary(account.id, tx);
    return account.id;
  }

  // Booking.price = Σ partes (ítems con descuento si la cuenta existe), listPrice = Σ precio no socio.
  async applyBookingTotalsTx(tx: TxClient, bookingId: number) {
    const slots = await tx.bookingPlayerSlot.findMany({
      where: { bookingId },
      include: { accountItem: { select: { total: true } } }
    });
    const listPrice = round2(slots.reduce((sum, slot) => sum + Number(slot.shareListAmount), 0));
    const priceBeforeDiscounts = round2(slots.reduce((sum, slot) => sum + Number(slot.shareAmount), 0));
    const price = round2(slots.reduce((sum, slot) => sum + Number(slot.accountItem ? slot.accountItem.total : slot.shareAmount), 0));
    const memberBenefitAmount = round2(listPrice - priceBeforeDiscounts);
    const updated = await tx.booking.update({
      where: { id: bookingId },
      data: { listPrice, price, memberBenefitAmount }
    });

    // El reparto de cobro "uno paga todo" sigue el total vigente (la suma cambia al editar jugadores).
    const billing = await tx.bookingBillingConfig.findUnique({ where: { bookingId } });
    if (billing && billing.chargeMode === 'INDIVIDUAL') {
      const payload = (billing.assignmentsJson || {}) as any;
      const assignments = Array.isArray(payload.assignments) ? payload.assignments : [];
      const chargeable = assignments.filter((assignment: any) => assignment?.isChargeable);
      if (chargeable.length === 1) {
        chargeable[0].assignedAmount = price;
        await tx.bookingBillingConfig.update({
          where: { bookingId },
          data: { assignmentsJson: { ...payload, assignments } as Prisma.InputJsonValue }
        });
      }
    }
    return updated;
  }

  // ---------- Lectura ----------

  async getSlotsTx(db: DbClient, bookingId: number): Promise<PlayerSlotDto[]> {
    const booking = await db.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return [];
    const slots = await db.bookingPlayerSlot.findMany({ where: { bookingId }, orderBy: { slotIndex: 'asc' } });
    if (!slots.length) return [];

    const context = await this.loadClubPricingContextTx(db, booking.clubId);
    const dateKey = localDateKey(booking.startDateTime, context.timeZone);
    const current = await this.loadCurrentCategoriesTx(
      db,
      booking.clubId,
      slots.map((slot) => slot.clientId || ''),
      dateKey,
      context.membersEnabled
    );
    const categoryIds = Array.from(new Set(slots.map((slot) => slot.pricingMemberCategoryId).filter(Boolean))) as string[];
    const categories = categoryIds.length
      ? await db.memberCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
      : [];
    const categoryName = new Map(categories.map((category) => [category.id, category.name]));
    const clientIds = slots.map((slot) => slot.clientId).filter(Boolean) as string[];
    const clients = clientIds.length
      ? await db.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
      : [];
    const clientName = new Map(clients.map((client) => [client.id, client.name]));

    const result: PlayerSlotDto[] = [];
    for (const slot of slots) {
      const paidAmount = await this.slotPaidAmountTx(db, slot.accountItemId);
      const isEmpty = !slot.participantId && !slot.clientId && !slot.userId;
      result.push({
        slotIndex: slot.slotIndex,
        participantId: slot.participantId,
        clientId: slot.clientId,
        userId: slot.userId,
        displayName: slot.displayName || (slot.clientId ? clientName.get(slot.clientId) ?? null : null),
        isEmpty,
        memberPriceValidation: slot.memberPriceValidation,
        pricingMemberCategoryId: slot.pricingMemberCategoryId,
        pricingMemberCategoryName: slot.pricingMemberCategoryId ? categoryName.get(slot.pricingMemberCategoryId) ?? null : null,
        memberPricePending: Boolean(
          slot.clientId &&
          current.has(slot.clientId) &&
          !VALIDATED_FOR_MEMBER_PRICE.includes(slot.memberPriceValidation)
        ),
        shareListAmount: Number(slot.shareListAmount),
        shareAmount: Number(slot.shareAmount),
        accountItemId: slot.accountItemId,
        paidAmount,
        isFrozen: paidAmount > EPSILON
      });
    }
    return result;
  }

  // Vista del jugador (P13): cada uno ve su propia categoría; de los demás solo el monto.
  toPlayerView(slots: PlayerSlotDto[], viewer: { userId: number; clientIds: string[] }) {
    return slots.map((slot) => {
      const isMine = (slot.userId && slot.userId === viewer.userId) || (slot.clientId && viewer.clientIds.includes(slot.clientId));
      return {
        slotIndex: slot.slotIndex,
        isEmpty: slot.isEmpty,
        isMine: Boolean(isMine),
        displayName: slot.displayName ? this.abbreviateName(slot.displayName, Boolean(isMine)) : null,
        shareAmount: slot.shareAmount,
        paid: slot.isFrozen && slot.paidAmount + EPSILON >= slot.shareAmount,
        // Solo para el propio jugador
        memberCategoryName: isMine ? slot.pricingMemberCategoryName : null,
        memberPricePending: isMine ? slot.memberPricePending : false
      };
    });
  }

  private abbreviateName(name: string, full: boolean) {
    if (full) return name;
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || name;
    return `${parts[0]} ${parts[parts.length - 1].charAt(0)}.`;
  }
}
