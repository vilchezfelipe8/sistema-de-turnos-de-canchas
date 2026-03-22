import { ClubReviewStatus, Prisma } from '@prisma/client';
import { prisma, prismaRead } from '../prisma';

type CreateOrUpdateMyReviewInput = {
  clubId: number;
  bookingId: number;
  userId: number;
  rating: number;
  comment?: string | null;
};

const REVIEW_WINDOW_DAYS = 30;
const MAX_COMMENT_LENGTH = 500;

export class ClubReviewService {
  private normalizeComment(value: string | null | undefined): string | null {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_COMMENT_LENGTH) {
      throw new Error(`El comentario no puede superar ${MAX_COMMENT_LENGTH} caracteres`);
    }
    return trimmed;
  }

  private validateRating(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error('La calificación debe ser un entero entre 1 y 5');
    }
    return value;
  }

  private async assertBookingReviewEligibilityTx(
    tx: Prisma.TransactionClient,
    input: { clubId: number; bookingId: number; userId: number }
  ) {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, clubId: input.clubId },
      select: {
        id: true,
        status: true,
        endDateTime: true,
        userId: true,
        client: {
          select: { userId: true }
        }
      }
    });

    if (!booking) {
      throw new Error('Reserva no encontrada para el club indicado');
    }

    const ownerUserId = booking.userId ?? booking.client?.userId ?? null;
    if (!ownerUserId || Number(ownerUserId) !== Number(input.userId)) {
      throw new Error('No puedes reseñar una reserva de otro usuario');
    }

    if (String(booking.status) !== 'COMPLETED') {
      throw new Error('Solo se pueden reseñar reservas completadas');
    }

    const now = Date.now();
    const endAt = booking.endDateTime.getTime();
    if (endAt > now) {
      throw new Error('No se puede reseñar una reserva que aún no finalizó');
    }

    const maxAgeMs = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if ((now - endAt) > maxAgeMs) {
      throw new Error(`La reseña venció: solo se permiten reseñas hasta ${REVIEW_WINDOW_DAYS} días después del turno`);
    }
  }

  async createOrUpdateMyReview(input: CreateOrUpdateMyReviewInput) {
    const rating = this.validateRating(Number(input.rating));
    const comment = this.normalizeComment(input.comment);

    return prisma.$transaction(async (tx) => {
      await this.assertBookingReviewEligibilityTx(tx, {
        clubId: input.clubId,
        bookingId: input.bookingId,
        userId: input.userId
      });

      const review = await tx.clubReview.upsert({
        where: {
          bookingId_userId: {
            bookingId: input.bookingId,
            userId: input.userId
          }
        },
        update: {
          rating,
          comment,
          status: ClubReviewStatus.PUBLISHED
        },
        create: {
          clubId: input.clubId,
          bookingId: input.bookingId,
          userId: input.userId,
          rating,
          comment,
          status: ClubReviewStatus.PUBLISHED
        }
      });

      return review;
    });
  }

  async getMyReviewForBooking(input: { clubId: number; bookingId: number; userId: number }) {
    const review = await prismaRead.clubReview.findFirst({
      where: {
        clubId: input.clubId,
        bookingId: input.bookingId,
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
      throw new Error('Reseña no encontrada para el club indicado');
    }

    return prisma.clubReview.update({
      where: { id: input.reviewId },
      data: { status: input.status }
    });
  }
}
