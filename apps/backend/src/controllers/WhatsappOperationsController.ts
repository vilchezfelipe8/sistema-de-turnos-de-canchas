import { Request, Response } from 'express';
import { z } from 'zod';
import { sendAppError } from '../errors';
import { WhatsappOperationsService } from '../services/WhatsappOperationsService';
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_RECIPIENT_ROLES,
  WHATSAPP_DELIVERY_STATUSES
} from '../types/notifications';

const parseDate = (value: unknown) => {
  if (value == null || value === '') return undefined;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? value : parsed;
};

const deliveryListQuerySchema = z.object({
  clubId: z.preprocess(
    (value) => (value == null || value === '' ? undefined : Number(value)),
    z.number().int().positive().optional()
  ),
  status: z.enum(WHATSAPP_DELIVERY_STATUSES).optional(),
  eventType: z.enum(NOTIFICATION_EVENT_TYPES).optional(),
  recipientRole: z.enum(NOTIFICATION_RECIPIENT_ROLES).optional(),
  providerMessageId: z.string().trim().min(1).optional(),
  outboxMessageId: z.string().trim().min(1).optional(),
  from: z.preprocess(parseDate, z.date().optional()),
  to: z.preprocess(parseDate, z.date().optional()),
  limit: z.preprocess(
    (value) => (value == null || value === '' ? undefined : Number(value)),
    z.number().int().positive().max(100).optional()
  ),
  cursor: z.string().trim().min(1).optional()
});

const deliveryDetailParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const deliveryDetailQuerySchema = z.object({
  clubId: z.preprocess(
    (value) => (value == null || value === '' ? undefined : Number(value)),
    z.number().int().positive().optional()
  )
});

const webhookListQuerySchema = z.object({
  clubId: z.preprocess(
    (value) => (value == null || value === '' ? undefined : Number(value)),
    z.number().int().positive().optional()
  ),
  providerMessageId: z.string().trim().min(1).optional(),
  eventType: z.string().trim().min(1).optional(),
  status: z.enum(WHATSAPP_DELIVERY_STATUSES).optional(),
  from: z.preprocess(parseDate, z.date().optional()),
  to: z.preprocess(parseDate, z.date().optional()),
  limit: z.preprocess(
    (value) => (value == null || value === '' ? undefined : Number(value)),
    z.number().int().positive().max(100).optional()
  ),
  cursor: z.string().trim().min(1).optional()
});

const summaryQuerySchema = z.object({
  clubId: z.preprocess(
    (value) => (value == null || value === '' ? undefined : Number(value)),
    z.number().int().positive().optional()
  ),
  from: z.preprocess(parseDate, z.date().optional()),
  to: z.preprocess(parseDate, z.date().optional()),
  acceptedStaleMinutes: z.preprocess(
    (value) => (value == null || value === '' ? undefined : Number(value)),
    z.number().int().positive().max(24 * 60).optional()
  )
});

export class WhatsappOperationsController {
  constructor(
    private readonly operationsService = new WhatsappOperationsService()
  ) {}

  listDeliveries = async (req: Request, res: Response) => {
    try {
      const parsed = deliveryListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.format() });
      }

      const result = await this.operationsService.listDeliveries(parsed.data);
      return res.json(result);
    } catch (error) {
      return sendAppError(
        res,
        error,
        'No se pudieron cargar los deliveries de WhatsApp.'
      );
    }
  };

  getDeliveryDetail = async (req: Request, res: Response) => {
    try {
      const paramsParsed = deliveryDetailParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return res.status(400).json({ error: paramsParsed.error.format() });
      }

      const queryParsed = deliveryDetailQuerySchema.safeParse(req.query);
      if (!queryParsed.success) {
        return res.status(400).json({ error: queryParsed.error.format() });
      }

      const result = await this.operationsService.getDeliveryDetail({
        id: paramsParsed.data.id,
        clubId: queryParsed.data.clubId
      });

      if (!result) {
        return res
          .status(404)
          .json({ error: 'Delivery de WhatsApp no encontrado.' });
      }

      return res.json(result);
    } catch (error) {
      return sendAppError(
        res,
        error,
        'No se pudo cargar el detalle del delivery de WhatsApp.'
      );
    }
  };

  listWebhookEvents = async (req: Request, res: Response) => {
    try {
      const parsed = webhookListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.format() });
      }

      const result = await this.operationsService.listWebhookEvents(parsed.data);
      return res.json(result);
    } catch (error) {
      return sendAppError(
        res,
        error,
        'No se pudieron cargar los eventos webhook de WhatsApp.'
      );
    }
  };

  getPreflight = async (_req: Request, res: Response) => {
    try {
      const result = await this.operationsService.getPreflight();
      return res.json(result);
    } catch (error) {
      return sendAppError(
        res,
        error,
        'No se pudo ejecutar el preflight de WhatsApp.'
      );
    }
  };

  getSummary = async (req: Request, res: Response) => {
    try {
      const parsed = summaryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.format() });
      }

      const result = await this.operationsService.getSummary(parsed.data);
      return res.json(result);
    } catch (error) {
      return sendAppError(
        res,
        error,
        'No se pudo cargar el resumen operativo de WhatsApp.'
      );
    }
  };
}

