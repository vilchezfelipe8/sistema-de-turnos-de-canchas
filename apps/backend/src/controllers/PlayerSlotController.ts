import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ErrorCodes, badRequest, forbidden, notFound, sendAppError, zodValidationAppError } from '../errors';
import { PlayerSlotService } from '../services/PlayerSlotService';

const nullablePrice = z.preprocess(
  (v) => (v === null || v === '' || v === undefined ? null : Number(v)),
  z.number().min(0).nullable()
);

export class PlayerSlotController {
  private readonly playerSlotService = new PlayerSlotService();

  private resolveClubId(req: Request) {
    const clubId = Number((req as any).clubId);
    if (!Number.isInteger(clubId) || clubId <= 0) throw badRequest('Club inválido', ErrorCodes.INVALID_INPUT);
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const actorUserId = Number((req as any).user?.userId || 0);
    return Number.isFinite(actorUserId) && actorUserId > 0 ? actorUserId : null;
  }

  private resolveBookingId(req: Request) {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) throw badRequest('Reserva inválida.', ErrorCodes.INVALID_INPUT);
    return bookingId;
  }

  // ---------- Configuración (Ajustes) ----------

  getPricingSettings = async (req: Request, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const settings = await prisma.clubSettings.findUnique({
        where: { clubId },
        select: { pricingMode: true, onlineCheckoutEnabled: true }
      });
      return res.json({
        pricingMode: settings?.pricingMode ?? 'PER_COURT',
        onlineCheckoutEnabled: settings?.onlineCheckoutEnabled ?? true
      });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener la configuración de precios');
    }
  };

  updatePricingSettings = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        pricingMode: z.enum(['PER_COURT', 'PER_PLAYER']).optional(),
        onlineCheckoutEnabled: z.boolean().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      if (parsed.data.pricingMode) {
        await this.playerSlotService.setPricingMode(clubId, parsed.data.pricingMode, actorUserId);
      }
      if (parsed.data.onlineCheckoutEnabled !== undefined) {
        await prisma.clubSettings.upsert({
          where: { clubId },
          update: { onlineCheckoutEnabled: parsed.data.onlineCheckoutEnabled },
          create: { clubId, onlineCheckoutEnabled: parsed.data.onlineCheckoutEnabled }
        });
        await prisma.auditLog.create({
          data: {
            clubId,
            userId: actorUserId,
            entity: 'CLUB_SETTINGS',
            entityId: String(clubId),
            action: 'ONLINE_CHECKOUT_TOGGLED',
            payload: { onlineCheckoutEnabled: parsed.data.onlineCheckoutEnabled }
          }
        });
      }
      return this.getPricingSettings(req, res);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar la configuración de precios');
    }
  };

  listFormats = async (req: Request, res: Response) => {
    try {
      const formats = await this.playerSlotService.listFormats(this.resolveClubId(req));
      return res.json(formats.map((format) => ({
        id: format.id,
        activityTypeId: format.activityTypeId,
        activityName: format.activityType.name,
        name: format.name,
        playerCount: format.playerCount,
        durationMinutes: format.durationMinutes,
        allowShortInGaps: format.allowShortInGaps,
        sortOrder: format.sortOrder,
        isActive: format.isActive
      })));
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron listar las modalidades');
    }
  };

  createFormat = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        activityTypeId: z.preprocess((v) => Number(v), z.number().int().positive()),
        name: z.string().trim().min(2).max(60),
        playerCount: z.preprocess((v) => Number(v), z.number().int().min(1).max(30)),
        durationMinutes: z.preprocess((v) => (v === undefined || v === null || v === '' ? null : Number(v)), z.number().int().nullable()).optional(),
        sortOrder: z.number().int().optional(),
        allowShortInGaps: z.boolean().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const created = await this.playerSlotService.createFormat({ clubId: this.resolveClubId(req), ...parsed.data });
      return res.status(201).json(created);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo crear la modalidad');
    }
  };

  updateFormat = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        name: z.string().trim().min(2).max(60).optional(),
        playerCount: z.preprocess((v) => (v === undefined ? undefined : Number(v)), z.number().int().min(1).max(30).optional()),
        durationMinutes: z.preprocess((v) => (v === undefined ? undefined : v === null || v === '' ? null : Number(v)), z.number().int().nullable().optional()),
        sortOrder: z.number().int().optional(),
        isActive: z.boolean().optional(),
        allowShortInGaps: z.boolean().optional()
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const updated = await this.playerSlotService.updateFormat({
        clubId: this.resolveClubId(req),
        formatId: String(req.params.formatId || ''),
        ...parsed.data
      });
      return res.json(updated);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar la modalidad');
    }
  };

  getPriceTable = async (req: Request, res: Response) => {
    try {
      return res.json(await this.playerSlotService.getPriceTable(this.resolveClubId(req)));
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener la tabla de precios');
    }
  };

  updatePriceTable = async (req: Request, res: Response) => {
    try {
      const parsed = z.object({
        prices: z.array(z.object({
          activityFormatId: z.string().trim().min(1),
          memberCategoryId: z.string().trim().min(1).nullable(),
          pricePerPlayer: nullablePrice
        })).min(1).max(500)
      }).safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los precios.'));
      const table = await this.playerSlotService.upsertPrices({
        clubId: this.resolveClubId(req),
        actorUserId: this.resolveActorUserId(req),
        prices: parsed.data.prices
      });
      return res.json(table);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron guardar los precios');
    }
  };

  // Público: modalidades activas del club para armar la reserva en la app.
  listPublicFormats = async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || '').trim();
      const club = await prisma.club.findUnique({
        where: { slug },
        select: { id: true, settings: { select: { pricingMode: true, onlineCheckoutEnabled: true } } }
      });
      if (!club) throw notFound('Club no encontrado.', ErrorCodes.CLUB_NOT_FOUND);
      const formats = await prisma.activityFormat.findMany({
        where: { clubId: club.id, isActive: true },
        orderBy: [{ activityTypeId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, activityTypeId: true, name: true, playerCount: true, durationMinutes: true, allowShortInGaps: true }
      });
      return res.json({
        pricingMode: club.settings?.pricingMode ?? 'PER_COURT',
        onlineCheckoutEnabled: club.settings?.onlineCheckoutEnabled ?? true,
        formats
      });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron obtener las modalidades');
    }
  };

  // ---------- Reserva (admin) ----------

  getAdminSlots = async (req: Request, res: Response) => {
    try {
      const bookingId = this.resolveBookingId(req);
      const booking = await prisma.booking.findFirst({
        where: { id: bookingId, clubId: this.resolveClubId(req) },
        select: { id: true, playerCount: true, memberBenefitAmount: true, activityFormat: { select: { id: true, name: true } } }
      });
      if (!booking) throw notFound('Reserva no encontrada.', ErrorCodes.BOOKING_NOT_FOUND);
      return res.json({
        perPlayer: Boolean(booking.activityFormat),
        activityFormat: booking.activityFormat,
        playerCount: booking.playerCount,
        memberBenefitAmount: Number(booking.memberBenefitAmount || 0),
        slots: await this.playerSlotService.getSlotsTx(prisma, bookingId)
      });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron obtener los lugares de la reserva');
    }
  };

  validateMemberAtCounter = async (req: Request, res: Response) => {
    try {
      const slotIndex = Number(req.params.slotIndex);
      if (!Number.isInteger(slotIndex) || slotIndex <= 0) throw badRequest('Lugar inválido.', ErrorCodes.INVALID_INPUT);
      const slots = await this.playerSlotService.validateMemberAtCounter({
        bookingId: this.resolveBookingId(req),
        clubId: this.resolveClubId(req),
        slotIndex,
        actorUserId: this.resolveActorUserId(req)
      });
      return res.json({ slots });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo validar al socio');
    }
  };

  reprice = async (req: Request, res: Response) => {
    try {
      const slots = await this.playerSlotService.repriceBooking({
        bookingId: this.resolveBookingId(req),
        clubId: this.resolveClubId(req),
        actorUserId: this.resolveActorUserId(req)
      });
      return res.json({ slots });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo recalcular el precio');
    }
  };

  // ---------- Reserva (jugador) ----------

  getMySlots = async (req: Request, res: Response) => {
    try {
      const bookingId = this.resolveBookingId(req);
      const userId = this.resolveActorUserId(req);
      if (!userId) throw forbidden('Necesitás iniciar sesión.');
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          clubId: true,
          userId: true,
          playerCount: true,
          client: { select: { userId: true } },
          activityFormat: { select: { id: true, name: true } },
          participants: { select: { userId: true, invitedUserId: true, status: true } }
        }
      });
      if (!booking) throw notFound('Reserva no encontrada.', ErrorCodes.BOOKING_NOT_FOUND);
      const isOwner = booking.userId === userId || booking.client?.userId === userId;
      const isParticipant = booking.participants.some(
        (participant) =>
          (participant.userId === userId || participant.invitedUserId === userId) &&
          (participant.status === 'JOINED' || participant.status === 'INVITED')
      );
      if (!isOwner && !isParticipant) throw forbidden('No tenés acceso a esta reserva.');

      const myClients = await prisma.client.findMany({ where: { clubId: booking.clubId, userId }, select: { id: true } });
      const slots = await this.playerSlotService.getSlotsTx(prisma, bookingId);
      return res.json({
        perPlayer: Boolean(booking.activityFormat),
        activityFormat: booking.activityFormat,
        playerCount: booking.playerCount,
        slots: this.playerSlotService.toPlayerView(slots, { userId, clientIds: myClients.map((client) => client.id) })
      });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron obtener los lugares de la reserva');
    }
  };
}
