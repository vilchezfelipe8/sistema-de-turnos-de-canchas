import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError, validationError, zodValidationAppError } from '../errors';
import { subscriptionService } from '../services/subscriptions/SubscriptionService';
import { sanitizeString } from '../utils/sanitize';

const money = z.preprocess((value) => (value === '' || value == null ? undefined : Number(value)), z.number().positive());
const optionalMoney = z.preprocess(
  (value) => (value === '' || value == null ? null : Number(value)),
  z.number().nonnegative().nullable()
);
const optionalInt = (min: number, max: number) =>
  z.preprocess((value) => (value === '' || value == null ? null : Number(value)), z.number().int().min(min).max(max).nullable());
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const planSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().nullable(),
  billingType: z.enum(['RECURRING', 'FIXED_TERM']),
  periodMonths: z.number().int().min(1).max(24),
  enrollmentFee: optionalMoney.optional(),
  dueDayOfMonth: optionalInt(1, 28).optional(),
  graceDays: z.number().int().min(0).max(60).optional(),
  pauseMaxDays: z.number().int().min(0).max(180).optional(),
  pauseMaxCount: z.number().int().min(0).max(12).optional(),
  grantsMemberCategoryId: z.string().trim().min(1).optional().nullable(),
  sortOrder: z.number().int().optional(),
  options: z
    .array(
      z.object({
        id: z.string().trim().min(1).optional().nullable(),
        label: z.string().trim().min(1).max(80),
        installmentsCount: z.number().int().min(1).max(24),
        installmentPrice: money,
        isActive: z.boolean().optional(),
      })
    )
    .min(1)
    .max(10),
  entitlements: z
    .array(
      z.object({
        kind: z.enum(['ACTIVITY_ACCESS', 'CLASS_CREDITS']),
        activityTypeId: z.number().int().positive(),
        timesPerWeek: optionalInt(1, 14).optional(),
        creditsPerPeriod: optionalInt(1, 100).optional(),
        classType: z.enum(['INDIVIDUAL', 'GROUP']).optional().nullable(),
      })
    )
    .max(20)
    .optional(),
});

const sellSchema = z.object({
  clientId: z.string().trim().min(1),
  payerClientId: z.string().trim().min(1).optional().nullable(),
  planId: z.string().trim().min(1),
  optionId: z.string().trim().min(1),
  startDate: dateKey.optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

const statusSchema = z.object({ isActive: z.boolean() });

type ClubRequest = Request & { clubId?: number };

export class SubscriptionAdminController {
  private resolveClubId(req: ClubRequest) {
    const clubId = Number(req.clubId);
    if (!Number.isFinite(clubId) || clubId <= 0) {
      throw validationError('Revisá los campos marcados.', { clubId: 'Club inválido.' });
    }
    return clubId;
  }

  private resolveActorUserId(req: Request) {
    const userId = Number((req as any)?.user?.userId || 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw validationError('No se pudo resolver el usuario actual.', { user: 'Usuario inválido.' });
    }
    return userId;
  }

  private resolveId(raw: unknown, label: string) {
    const id = String(raw || '').trim();
    if (!id) throw validationError('Revisá los campos marcados.', { id: `${label} inválido.` });
    return id;
  }

  listPlans = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const includeInactive = ['1', 'true'].includes(String(req.query.includeInactive || '').toLowerCase());
      return res.json(await subscriptionService.listPlans(clubId, { includeInactive }));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los planes.');
    }
  };

  getPlan = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      return res.json(await subscriptionService.getPlan(clubId, this.resolveId(req.params.id, 'Plan')));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo obtener el plan.');
    }
  };

  createPlan = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const parsed = planSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const created = await subscriptionService.createPlan(clubId, {
        ...parsed.data,
        name: sanitizeString(parsed.data.name, 120),
        description: parsed.data.description ? sanitizeString(parsed.data.description, 1000) : null,
      });
      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo crear el plan.');
    }
  };

  updatePlan = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const planId = this.resolveId(req.params.id, 'Plan');
      const parsed = planSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const updated = await subscriptionService.updatePlan(clubId, planId, {
        ...parsed.data,
        name: sanitizeString(parsed.data.name, 120),
        description: parsed.data.description ? sanitizeString(parsed.data.description, 1000) : null,
      });
      return res.json(updated);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo guardar el plan.');
    }
  };

  setPlanStatus = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const planId = this.resolveId(req.params.id, 'Plan');
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      return res.json(await subscriptionService.setPlanActive(clubId, planId, parsed.data.isActive));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cambiar el estado del plan.');
    }
  };

  listSubscriptions = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const clientId = this.resolveId(req.query.clientId, 'Cliente');
      return res.json(await subscriptionService.listByClient(clubId, clientId));
    } catch (error) {
      return sendAppError(res, error, 'No se pudieron cargar los planes del cliente.');
    }
  };

  getSubscription = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      return res.json(await subscriptionService.getSubscription(clubId, this.resolveId(req.params.id, 'Plan del cliente')));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo obtener el plan del cliente.');
    }
  };

  sell = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const parsed = sellSchema.safeParse(req.body);
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const created = await subscriptionService.sell(clubId, actorUserId, {
        ...parsed.data,
        notes: parsed.data.notes ? sanitizeString(parsed.data.notes, 1000) : null,
      });
      return res.status(201).json(created);
    } catch (error) {
      return sendAppError(res, error, 'No se pudo vender el plan.');
    }
  };

  cancel = async (req: ClubRequest, res: Response) => {
    try {
      const clubId = this.resolveClubId(req);
      const actorUserId = this.resolveActorUserId(req);
      const parsed = cancelSchema.safeParse(req.body ?? {});
      if (!parsed.success) return sendAppError(res, zodValidationAppError(parsed.error, 'Revisá los campos marcados.'));
      const reason = parsed.data.reason ? sanitizeString(parsed.data.reason, 500) : null;
      return res.json(await subscriptionService.cancel(clubId, actorUserId, this.resolveId(req.params.id, 'Plan del cliente'), reason));
    } catch (error) {
      return sendAppError(res, error, 'No se pudo cancelar el plan.');
    }
  };
}
