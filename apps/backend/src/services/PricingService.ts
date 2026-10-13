import { prisma } from '../prisma';
import { ErrorCodes, badRequest, notFound } from '../errors';
import { TimeHelper } from '../utils/TimeHelper';

export type LightsConfig = {
  lightsEnabled?: boolean | null;
  lightsExtraAmount?: number | string | null;
  lightsFromHour?: string | null;
};

export type CourtPriceBreakdownInput = {
  courtId: number;
  startDateTime: Date;
  effectiveDurationMinutes: number;
  referenceDurationMinutes: number;
  timeZone: string;
  lights?: LightsConfig | null;
};

export type CourtPriceBreakdown = {
  // Precio de la regla horaria (o Court.price) sin ajustes
  basePrice: number;
  // basePrice ajustado proporcionalmente a la duración del turno
  durationAdjustedPrice: number;
  lightsExtra: number;
  // durationAdjustedPrice + lightsExtra (lo que hoy se guarda como listPrice)
  listPrice: number;
};

const round2 = (value: number) => Number(Number(value || 0).toFixed(2));

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

  // Precio proporcional a la duración respecto de la duración de referencia de la actividad.
  static adjustForDuration(
    basePrice: number,
    effectiveDurationMinutes: number,
    referenceDurationMinutes: number
  ): number {
    const safeBase = Number(basePrice || 0);
    const safeEffective = Number(effectiveDurationMinutes || 0);
    const safeReference = Number(referenceDurationMinutes || 0);

    if (!Number.isFinite(safeBase) || safeBase <= 0) return 0;
    if (!Number.isFinite(safeEffective) || safeEffective <= 0) return round2(safeBase);
    if (!Number.isFinite(safeReference) || safeReference <= 0) return round2(safeBase);

    return round2(safeBase * (safeEffective / safeReference));
  }

  // Recargo por luces: monto fijo por turno si el turno empieza a partir de lightsFromHour (hora local del club).
  static computeLightsExtra(startDateTime: Date, timeZone: string, lights?: LightsConfig | null): number {
    if (!lights || !lights.lightsEnabled || !lights.lightsFromHour) return 0;
    const amount = Number(lights.lightsExtraAmount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    const [lh, lm] = String(lights.lightsFromHour).split(':').map((n) => Number.parseInt(n, 10));
    if (Number.isNaN(lh) || Number.isNaN(lm)) return 0;

    const localStart = TimeHelper.utcToLocal(startDateTime, timeZone);
    const bookingTotalMinutes = localStart.getHours() * 60 + localStart.getMinutes();
    return bookingTotalMinutes >= lh * 60 + lm ? round2(amount) : 0;
  }

  // Única fuente del precio de un turno en modo por cancha: regla horaria/Court.price + duración + luces.
  // Si la cancha no tiene precio configurado devuelve basePrice <= 0 y el llamador decide qué hacer.
  async resolveCourtPriceBreakdown(input: CourtPriceBreakdownInput): Promise<CourtPriceBreakdown> {
    const basePrice = Number(await this.calculateCourtPrice(input.courtId, input.startDateTime));
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
      return { basePrice: Number.isFinite(basePrice) ? basePrice : 0, durationAdjustedPrice: 0, lightsExtra: 0, listPrice: 0 };
    }

    const durationAdjustedPrice = PricingService.adjustForDuration(
      basePrice,
      input.effectiveDurationMinutes,
      input.referenceDurationMinutes
    );
    const lightsExtra = PricingService.computeLightsExtra(input.startDateTime, input.timeZone, input.lights);

    return {
      basePrice,
      durationAdjustedPrice,
      lightsExtra,
      listPrice: round2(durationAdjustedPrice + lightsExtra)
    };
  }
}
