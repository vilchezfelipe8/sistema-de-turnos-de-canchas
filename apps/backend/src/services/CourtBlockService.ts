import { prisma } from '../prisma';
import { badRequest, conflict, ErrorCodes, notFound } from '../errors';
import { TimeHelper } from '../utils/TimeHelper';

type PrismaLike = Pick<typeof prisma, 'courtBlock'>;

export type CourtBlockDto = {
    id: string;
    clubId: number;
    courtId: number;
    courtName: string;
    startDateTime: string;
    endDateTime: string;
    title: string | null;
    createdByUserId: number | null;
    createdAt: string;
    updatedAt: string;
};

export type CourtBlockListFilters = {
    date?: string;
    from?: Date;
    to?: Date;
    courtId?: number;
};

export type CourtBlockInput = {
    courtId: number;
    startDateTime: Date;
    endDateTime: Date;
    title?: string | null;
};

const MAX_BLOCK_MINUTES = 24 * 60 * 31;

const toDto = (row: any): CourtBlockDto => ({
    id: String(row.id),
    clubId: Number(row.clubId),
    courtId: Number(row.courtId),
    courtName: String(row.court?.name || ''),
    startDateTime: new Date(row.startDateTime).toISOString(),
    endDateTime: new Date(row.endDateTime).toISOString(),
    title: row.title ? String(row.title) : null,
    createdByUserId: row.createdByUserId ? Number(row.createdByUserId) : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString()
});

/**
 * Busca un bloqueo de cancha que se superponga con [startDateTime, endDateTime).
 * Lo usan reservas, reprogramaciones y series para rechazar horarios bloqueados.
 */
export const findCourtBlockOverlap = (
    params: { courtId: number; startDateTime: Date; endDateTime: Date; excludeBlockId?: string },
    client: PrismaLike = prisma
) => client.courtBlock.findFirst({
    where: {
        courtId: params.courtId,
        startDateTime: { lt: params.endDateTime },
        endDateTime: { gt: params.startDateTime },
        ...(params.excludeBlockId ? { id: { not: params.excludeBlockId } } : {})
    },
    include: { court: { select: { name: true } } },
    orderBy: { startDateTime: 'asc' }
});

export const courtBlockedError = () =>
    conflict('La cancha está bloqueada en ese horario.', ErrorCodes.COURT_BLOCKED);

export class CourtBlockService {
    async list(clubId: number, filters: CourtBlockListFilters): Promise<CourtBlockDto[]> {
        let rangeStart = filters.from;
        let rangeEnd = filters.to;
        if (filters.date) {
            const [year, month, day] = filters.date.split('-').map(Number);
            const timeZone = await this.resolveClubTimeZone(clubId);
            const range = TimeHelper.getUtcRangeForLocalDate(new Date(year, month - 1, day), timeZone);
            rangeStart = range.startUtc;
            rangeEnd = range.endUtc;
        }
        if (!rangeStart || !rangeEnd) {
            throw badRequest('Indicá una fecha (date) o un rango (from/to).', ErrorCodes.INVALID_INPUT);
        }
        const rows = await prisma.courtBlock.findMany({
            where: {
                clubId,
                startDateTime: { lt: rangeEnd },
                endDateTime: { gt: rangeStart },
                ...(filters.courtId ? { courtId: filters.courtId } : {})
            },
            include: { court: { select: { name: true } } },
            orderBy: [{ startDateTime: 'asc' }, { courtId: 'asc' }]
        });
        return rows.map(toDto);
    }

    async create(clubId: number, input: CourtBlockInput, actorUserId: number | null): Promise<CourtBlockDto> {
        await this.assertCourtInClub(clubId, input.courtId);
        this.assertValidRange(input.startDateTime, input.endDateTime);
        await this.assertSlotFree({ clubId, courtId: input.courtId, startDateTime: input.startDateTime, endDateTime: input.endDateTime });
        const row = await prisma.courtBlock.create({
            data: {
                clubId,
                courtId: input.courtId,
                startDateTime: input.startDateTime,
                endDateTime: input.endDateTime,
                title: this.normalizeTitle(input.title),
                createdByUserId: actorUserId
            },
            include: { court: { select: { name: true } } }
        });
        return toDto(row);
    }

    async update(clubId: number, blockId: string, input: Partial<CourtBlockInput>): Promise<CourtBlockDto> {
        const existing = await prisma.courtBlock.findFirst({ where: { id: blockId, clubId } });
        if (!existing) throw notFound('Bloqueo no encontrado.', ErrorCodes.COURT_BLOCK_NOT_FOUND);

        const courtId = input.courtId ?? existing.courtId;
        const startDateTime = input.startDateTime ?? existing.startDateTime;
        const endDateTime = input.endDateTime ?? existing.endDateTime;
        if (courtId !== existing.courtId) await this.assertCourtInClub(clubId, courtId);
        this.assertValidRange(startDateTime, endDateTime);
        await this.assertSlotFree({ clubId, courtId, startDateTime, endDateTime, excludeBlockId: blockId });

        const row = await prisma.courtBlock.update({
            where: { id: blockId },
            data: {
                courtId,
                startDateTime,
                endDateTime,
                ...(input.title !== undefined ? { title: this.normalizeTitle(input.title) } : {})
            },
            include: { court: { select: { name: true } } }
        });
        return toDto(row);
    }

    async remove(clubId: number, blockId: string): Promise<void> {
        const deleted = await prisma.courtBlock.deleteMany({ where: { id: blockId, clubId } });
        if (deleted.count === 0) throw notFound('Bloqueo no encontrado.', ErrorCodes.COURT_BLOCK_NOT_FOUND);
    }

    private normalizeTitle(title: string | null | undefined) {
        const trimmed = String(title || '').trim();
        return trimmed ? trimmed.slice(0, 120) : null;
    }

    private assertValidRange(start: Date, end: Date) {
        if (!(start instanceof Date) || Number.isNaN(start.getTime()) || !(end instanceof Date) || Number.isNaN(end.getTime())) {
            throw badRequest('Horario de bloqueo inválido.', ErrorCodes.INVALID_INPUT);
        }
        if (end.getTime() <= start.getTime()) {
            throw badRequest('El bloqueo tiene que terminar después de empezar.', ErrorCodes.INVALID_INPUT);
        }
        if ((end.getTime() - start.getTime()) / 60000 > MAX_BLOCK_MINUTES) {
            throw badRequest('El bloqueo no puede durar más de 31 días.', ErrorCodes.INVALID_INPUT);
        }
    }

    private async assertCourtInClub(clubId: number, courtId: number) {
        const court = await prisma.court.findFirst({ where: { id: courtId, clubId }, select: { id: true } });
        if (!court) throw notFound('Cancha no encontrada', ErrorCodes.COURT_NOT_FOUND);
    }

    // Un bloqueo no puede pisar reservas activas, clases ni otros bloqueos de la misma cancha.
    private async assertSlotFree(params: {
        clubId: number;
        courtId: number;
        startDateTime: Date;
        endDateTime: Date;
        excludeBlockId?: string;
    }) {
        const booking = await prisma.booking.findFirst({
            where: {
                clubId: params.clubId,
                courtId: params.courtId,
                status: { not: 'CANCELLED' },
                startDateTime: { lt: params.endDateTime },
                endDateTime: { gt: params.startDateTime }
            },
            select: { id: true }
        });
        if (booking) {
            throw conflict('Hay una reserva en ese horario. Movela o cancelala antes de bloquear.', ErrorCodes.BOOKING_OVERLAP);
        }
        const classSession = await prisma.classSession.findFirst({
            where: {
                clubId: params.clubId,
                courtId: params.courtId,
                status: { in: ['SCHEDULED', 'CONFIRMED'] },
                startsAt: { lt: params.endDateTime },
                endsAt: { gt: params.startDateTime }
            },
            select: { id: true }
        });
        if (classSession) {
            throw conflict('La cancha tiene una clase en ese horario.', ErrorCodes.BOOKING_OVERLAP);
        }
        const block = await findCourtBlockOverlap(params);
        if (block) {
            throw conflict('Ya hay un bloqueo en ese horario.', ErrorCodes.BOOKING_OVERLAP);
        }
    }

    private async resolveClubTimeZone(clubId: number) {
        const settings = await prisma.clubSettings.findUnique({ where: { clubId }, select: { timeZone: true } });
        return String(settings?.timeZone || '').trim() || 'America/Argentina/Buenos_Aires';
    }
}
