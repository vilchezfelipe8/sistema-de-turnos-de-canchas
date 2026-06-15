import { Request, Response } from 'express';
import { ClubReviewStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma';
import { ClubReviewService } from '../services/ClubReviewService';
import { sendAuthError } from '../utils/authError';
import { sendAppError } from '../errors';

const listQuerySchema = z.object({
  take: z.preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().int().positive().max(50).optional()
  ),
  cursor: z.string().trim().min(1).optional()
});

const upsertBodySchema = z.object({
  bookingId: z.preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().int().positive().optional()
  ),
  rating: z.preprocess((v) => Number(v), z.number().int().min(1).max(5)),
  comment: z.string().trim().max(220).optional().nullable()
});

const mineQuerySchema = z.object({
  bookingId: z.preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().int().positive().optional()
  )
});

const statusBodySchema = z.object({
  status: z.nativeEnum(ClubReviewStatus)
});

const adminListQuerySchema = z.object({
  take: z.preprocess(
    (v) => (v == null || v === '' ? undefined : Number(v)),
    z.number().int().positive().max(100).optional()
  ),
  cursor: z.string().trim().min(1).optional(),
  status: z.nativeEnum(ClubReviewStatus).optional()
});

const reviewIdParamsSchema = z.object({
  reviewId: z.string().trim().min(1)
});

export class ClubReviewController {
  private readonly service: ClubReviewService;

  constructor(service: ClubReviewService = new ClubReviewService()) {
    this.service = service;
  }

  private async resolveClubIdBySlug(slug: string) {
    const club = await prisma.club.findUnique({
      where: { slug },
      select: { id: true }
    });
    return club?.id ?? null;
  }

  listPublished = async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'Slug de club requerido' });

      const queryParsed = listQuerySchema.safeParse(req.query || {});
      if (!queryParsed.success) return res.status(400).json({ error: queryParsed.error.format() });

      const clubId = await this.resolveClubIdBySlug(slug);
      if (!clubId) return res.status(404).json({ error: 'Club no encontrado' });

      const take = queryParsed.data.take ?? 20;
      const rows = await this.service.listPublishedByClub(clubId, take, queryParsed.data.cursor);

      const payload = rows.map((review) => ({
        id: review.id,
        bookingId: review.bookingId,
        rating: review.rating,
        comment: review.comment,
        status: review.status,
        createdAt: review.createdAt,
        user: {
          id: review.user.id,
          name: `${String(review.user.firstName || '').trim()} ${String(review.user.lastName || '').trim()}`
            .trim() || 'Usuario'
        }
      }));

      return res.json({
        items: payload,
        nextCursor: rows.length >= take ? rows[rows.length - 1]?.id ?? null : null
      });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron listar reseñas');
    }
  };

  getSummary = async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'Slug de club requerido' });

      const clubId = await this.resolveClubIdBySlug(slug);
      if (!clubId) return res.status(404).json({ error: 'Club no encontrado' });

      const summary = await this.service.getSummaryByClub(clubId);
      return res.json(summary);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener el resumen de reseñas');
    }
  };

  createOrUpdateMine = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any).user?.userId);
      if (!Number.isInteger(userId) || userId <= 0) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
      }

      const slug = String(req.params.slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'Slug de club requerido' });

      const bodyParsed = upsertBodySchema.safeParse(req.body);
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const clubId = await this.resolveClubIdBySlug(slug);
      if (!clubId) return res.status(404).json({ error: 'Club no encontrado' });

      const review = await this.service.createOrUpdateMyReview({
        clubId,
        bookingId: bodyParsed.data.bookingId,
        userId,
        rating: bodyParsed.data.rating,
        comment: bodyParsed.data.comment
      });

      return res.status(200).json(review);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo guardar la reseña');
    }
  };

  getMineForBooking = async (req: Request, res: Response) => {
    try {
      const userId = Number((req as any).user?.userId);
      if (!Number.isInteger(userId) || userId <= 0) {
        return sendAuthError(res, 401, 'AUTH_MISSING', 'No autorizado');
      }

      const slug = String(req.params.slug || '').trim();
      if (!slug) return res.status(400).json({ error: 'Slug de club requerido' });

      const queryParsed = mineQuerySchema.safeParse(req.query || {});
      if (!queryParsed.success) return res.status(400).json({ error: queryParsed.error.format() });

      const clubId = await this.resolveClubIdBySlug(slug);
      if (!clubId) return res.status(404).json({ error: 'Club no encontrado' });

      const review = await this.service.getMyReviewForClub({
        clubId,
        userId
      });
      return res.status(200).json(review);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo obtener la reseña');
    }
  };

  setStatus = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      if (!Number.isInteger(clubId) || clubId <= 0) {
        return res.status(400).json({ error: 'Club inválido' });
      }

      const paramsParsed = reviewIdParamsSchema.safeParse(req.params);
      if (!paramsParsed.success) return res.status(400).json({ error: paramsParsed.error.format() });

      const bodyParsed = statusBodySchema.safeParse(req.body);
      if (!bodyParsed.success) return res.status(400).json({ error: bodyParsed.error.format() });

      const review = await this.service.setReviewStatus({
        clubId,
        reviewId: paramsParsed.data.reviewId,
        status: bodyParsed.data.status
      });

      return res.status(200).json(review);
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudo actualizar la reseña');
    }
  };

  listForAdmin = async (req: Request, res: Response) => {
    try {
      const clubId = Number((req as any).clubId);
      if (!Number.isInteger(clubId) || clubId <= 0) {
        return res.status(400).json({ error: 'Club inválido' });
      }

      const queryParsed = adminListQuerySchema.safeParse(req.query || {});
      if (!queryParsed.success) return res.status(400).json({ error: queryParsed.error.format() });

      const take = queryParsed.data.take ?? 30;
      const rows = await this.service.listByClubForAdmin({
        clubId,
        take,
        cursor: queryParsed.data.cursor,
        status: queryParsed.data.status
      });

      return res.status(200).json({
        items: rows.map((review) => ({
          id: review.id,
          bookingId: review.bookingId,
          rating: review.rating,
          comment: review.comment,
          status: review.status,
          createdAt: review.createdAt,
          updatedAt: review.updatedAt,
          booking: review.booking
            ? {
              id: review.booking.id,
              startDateTime: review.booking.startDateTime,
              endDateTime: review.booking.endDateTime
            }
            : null,
          user: {
            id: review.user.id,
            name: `${String(review.user.firstName || '').trim()} ${String(review.user.lastName || '').trim()}`
              .trim() || 'Usuario'
          }
        })),
        nextCursor: rows.length >= take ? rows[rows.length - 1]?.id ?? null : null
      });
    } catch (error: any) {
      return sendAppError(res, error, 'No se pudieron listar reseñas admin');
    }
  };
}
