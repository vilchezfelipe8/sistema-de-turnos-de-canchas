import { BookingStatus, ClubReviewStatus, Prisma } from '@prisma/client';
import { prisma, prismaRead } from '../prisma';
import { ErrorCodes, badRequest, conflict, forbidden, notFound } from '../errors';

type CreateOrUpdateMyReviewInput = {
  clubId: number;
  bookingId?: number;
  userId: number;
  rating: number;
  comment?: string | null;
};

const MAX_COMMENT_LENGTH = 220;

export class ClubReviewService {
  private normalizeComment(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      throw badRequest(`El comentario no puede superar ${MAX_COMMENT_LENGTH} caracteres`, ErrorCodes.INVALID_INPUT);
    }
    return trimmed;
  }

  private validateRating(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw badRequest('La calificación debe ser un entero entre 1 y 5', ErrorCodes.INVALID_INPUT);
    }
    return value;
  }

  private async assertBookingReviewEligibilityTx(
    tx: Prisma.TransactionClient,
    input: { clubId: number; userId: number; bookingId?: number }
  ) {
    const now = new Date();

    const bookingSelect = {
      id: true,
      status: true,
      endDateTime: true,
      userId: true,
      client: {
        select: { userId: true }
      }
    } satisfies Prisma.BookingSelect;

    const booking = input.bookingId
      ? await tx.booking.findFirst({
        where: { id: input.bookingId, clubId: input.clubId },
        select: bookingSelect
      })
      : await tx.booking.findFirst({
        where: {
          clubId: input.clubId,
          endDateTime: { lte: now },
          status: BookingStatus.COMPLETED,
          OR: [
            { userId: input.userId },
            { client: { userId: input.userId } }
          ]
        },
        orderBy: [
          { endDateTime: 'desc' },
          { id: 'desc' }
        ],
        select: bookingSelect
      });

    if (!booking) {
      throw conflict('Necesitás una reserva finalizada en este club para dejar una reseña', ErrorCodes.BOOKING_INVALID_STATUS);
    }

    if (input.bookingId) {
      const ownerUserId = booking.userId ?? booking.client?.userId ?? null;
      if (!ownerUserId || Number(ownerUserId) !== Number(input.userId)) {
        throw forbidden('No podés reseñar una reserva de otro usuario');
      }
    }

    const bookingStatus = String(booking.status || '').toUpperCase();
    if (booking.endDateTime.getTime() > now.getTime()) {
      throw conflict('No se puede reseñar una reserva que aún no finalizó', ErrorCodes.BOOKING_INVALID_STATUS);
    }

    if (bookingStatus !== BookingStatus.COMPLETED) {
      if (bookingStatus === BookingStatus.CANCELLED) {
        throw conflict('No se puede reseñar una reserva cancelada', ErrorCodes.BOOKING_INVALID_STATUS);
      }
      throw conflict('Solo se pueden reseñar reservas completadas', ErrorCodes.BOOKING_INVALID_STATUS);
    }

    return booking;
  }

  async createOrUpdateMyReview(input: CreateOrUpdateMyReviewInput) {
    const rating = this.validateRating(Number(input.rating));
    const comment = this.normalizeComment(input.comment);

    return prisma.$transaction(async (tx) => {
      const reviewKey = {
        clubId: input.clubId,
        userId: input.userId
      };

      const existingReview = await tx.clubReview.findUnique({
        where: { clubId_userId: reviewKey },
        select: { bookingId: true }
      });

      let reviewBookingId = existingReview?.bookingId ?? null;
      if (!existingReview || input.bookingId) {
        const eligibleBooking = await this.assertBookingReviewEligibilityTx(tx, {
          clubId: input.clubId,
          userId: input.userId,
          bookingId: input.bookingId
        });
        reviewBookingId = eligibleBooking.id;
      }

      if (!reviewBookingId) {
        throw conflict('Necesitás una reserva finalizada en este club para dejar una reseña', ErrorCodes.BOOKING_INVALID_STATUS);
      }

      const review = await tx.clubReview.upsert({
        where: {
          clubId_userId: reviewKey
        },
        update: {
          bookingId: reviewBookingId,
          rating,
          comment,
          status: ClubReviewStatus.PUBLISHED
        },
        create: {
          clubId: input.clubId,
          bookingId: reviewBookingId,
          userId: input.userId,
          rating,
          comment,
          status: ClubReviewStatus.PUBLISHED
        }
      });

      return review;
    });
  }

  async getMyReviewForClub(input: { clubId: number; userId: number }) {
    const review = await prismaRead.clubReview.findFirst({
      where: {
        clubId: input.clubId,
        userId: input.userId
      },
      select: {
        id: true,
        bookingId: true,
        rating: true,
        comment: true,
        status: true,
        createdAt: true,
        updatedAt: true
      }
    });
    return review;
  }

  async getMyReviewForBooking(input: { clubId: number; bookingId?: number; userId: number }) {
    return this.getMyReviewForClub({
      clubId: input.clubId,
      userId: input.userId
    });
  }

  async listPublishedByClub(clubId: number, take: number = 20, cursor?: string) {
    const safeTake = Number.isInteger(take) && take > 0 ? Math.min(take, 50) : 20;

    const rows = await prismaRead.clubReview.findMany({
      where: {
        clubId,
        status: ClubReviewStatus.PUBLISHED
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: safeTake
    });

    return rows;
  }

  async listByClubForAdmin(input: { clubId: number; take?: number; cursor?: string; status?: ClubReviewStatus }) {
    const safeTake = Number.isInteger(input.take) && Number(input.take) > 0 ? Math.min(Number(input.take), 100) : 30;

    const rows = await prismaRead.clubReview.findMany({
      where: {
        clubId: input.clubId,
        ...(input.status ? { status: input.status } : {})
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        booking: {
          select: {
            id: true,
            startDateTime: true,
            endDateTime: true
          }
        }
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: safeTake
    });

    return rows;
  }

  async getSummaryByClub(clubId: number) {
    const [count, agg] = await Promise.all([
      prismaRead.clubReview.count({
        where: {
          clubId,
          status: ClubReviewStatus.PUBLISHED
        }
      }),
      prismaRead.clubReview.aggregate({
        where: {
          clubId,
          status: ClubReviewStatus.PUBLISHED
        },
        _avg: { rating: true }
      })
    ]);

    return {
      count,
      averageRating: Number(Number(agg._avg.rating || 0).toFixed(2))
    };
  }

  async setReviewStatus(input: { clubId: number; reviewId: string; status: ClubReviewStatus }) {
    const review = await prisma.clubReview.findFirst({
      where: {
        id: input.reviewId,
        clubId: input.clubId
      },
      select: { id: true }
    });

    if (!review) {
      throw notFound('Reseña no encontrada para el club indicado', ErrorCodes.NOT_FOUND);
    }

    return prisma.clubReview.update({
      where: { id: input.reviewId },
      data: { status: input.status }
    });
  }
}
