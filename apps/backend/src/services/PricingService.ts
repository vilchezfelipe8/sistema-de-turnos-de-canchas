import { prisma } from '../prisma';
import { ErrorCodes, badRequest, notFound } from '../errors';
import { TimeHelper } from '../utils/TimeHelper';

export class PricingService {
  async calculateCourtPrice(courtId: number, startDateTime: Date): Promise<number> {
    if (!Number.isInteger(courtId) || courtId <= 0) {
      throw badRequest('courtId inválido', ErrorCodes.INVALID_INPUT);
    }
    if (!(startDateTime instanceof Date) || Number.isNaN(startDateTime.getTime())) {
      throw badRequest('startDateTime inválido', ErrorCodes.INVALID_INPUT);
    }

    const court = await prisma.court.findUnique({
      where: { id: courtId },
      include: { club: { include: { settings: true } } }
    });

    if (!court) {
      throw notFound('Cancha no encontrada', ErrorCodes.COURT_NOT_FOUND);
    }

    const timeZone = court.club?.settings?.timeZone ?? 'America/Argentina/Buenos_Aires';
    const localStart = TimeHelper.utcToLocal(startDateTime, timeZone);
    const dayOfWeek = localStart.getDay();
    const startMinutes = localStart.getHours() * 60 + localStart.getMinutes();

    const matchedRule = await prisma.courtPriceRule.findFirst({
      where: {
        courtId,
        dayOfWeek,
        startMinutes: { lte: startMinutes },
        endMinutes: { gt: startMinutes }
      },
      orderBy: [
        { startMinutes: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    if (matchedRule && Number.isFinite(Number(matchedRule.price))) {
      return Number(matchedRule.price);
    }

    return Number(court.price ?? 0);
  }
}
