import { prisma } from '../prisma';
import { TimeHelper } from '../utils/TimeHelper';

export class PricingService {
  async calculateCourtPrice(courtId: number, startDateTime: Date): Promise<number> {
    if (!Number.isInteger(courtId) || courtId <= 0) {
      throw new Error('courtId inválido');
    }
    if (!(startDateTime instanceof Date) || Number.isNaN(startDateTime.getTime())) {
      throw new Error('startDateTime inválido');
    }

    const court = await prisma.court.findUnique({
      where: { id: courtId },
      include: { club: { include: { settings: true } } }
    });

    if (!court) {
      throw new Error('Cancha no encontrada');
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
