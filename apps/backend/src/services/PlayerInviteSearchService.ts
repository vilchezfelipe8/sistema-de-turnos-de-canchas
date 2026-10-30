import { prisma } from '../prisma';
import { ErrorCodes, badRequest, notFound } from '../errors';
import { playerRefFor, signPlayerInviteToken } from '../utils/playerInviteToken';

// Búsqueda de jugadores para invitar a una reserva.
// - Por nombre: solo entre personas con cuenta que tienen relación con el club (clientes, socios vinculados
//   o que ya jugaron ahí). No se busca por nombre en toda la plataforma para no exponer el padrón de usuarios.
// - "Jugaron con vos": personas con las que el usuario compartió reservas.
// Nunca se devuelven datos de contacto: solo nombre + inicial del apellido, una referencia opaca y un token
// firmado para invitar (atado a quien buscó).

export type PlayerInviteCandidate = {
    ref: string;
    inviteToken: string;
    displayName: string;
    initials: string;
    playedWithCount: number;
};

const MIN_QUERY_LETTERS = 3;
const MAX_QUERY_TOKENS = 3;
const SEARCH_LIMIT = 8;
const FREQUENT_LIMIT = 5;
const FREQUENT_RECENT_BOOKINGS = 80;
const SEARCHABLE_ACCOUNT_STATUSES = ['ACTIVE', 'PENDING_ACTIVATION'] as const;

const displayNameFor = (user: { firstName: string; lastName: string }) =>
    `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim().charAt(0)}${user.lastName ? '.' : ''}`.trim();

const initialsFor = (user: { firstName: string; lastName: string }) =>
    `${String(user.firstName || '').trim().charAt(0)}${String(user.lastName || '').trim().charAt(0)}`.toUpperCase() || '?';

export class PlayerInviteSearchService {
    private toCandidate(
        user: { id: number; firstName: string; lastName: string },
        requesterUserId: number,
        playedWithCount: number
    ): PlayerInviteCandidate {
        return {
            ref: playerRefFor(user.id),
            inviteToken: signPlayerInviteToken({ invitedUserId: user.id, requesterUserId }),
            displayName: displayNameFor(user),
            initials: initialsFor(user),
            playedWithCount
        };
    }

    // Cuántas reservas (no canceladas) compartió el usuario con cada persona, sobre sus reservas más recientes.
    private async playedWithCounts(requesterUserId: number): Promise<Map<number, number>> {
        const bookings = await prisma.booking.findMany({
            where: {
                status: { not: 'CANCELLED' },
                OR: [
                    { userId: requesterUserId },
                    { participants: { some: { userId: requesterUserId, status: 'JOINED' } } }
                ]
            },
            orderBy: { startDateTime: 'desc' },
            take: FREQUENT_RECENT_BOOKINGS,
            select: {
                userId: true,
                participants: {
                    where: { status: 'JOINED', userId: { not: null } },
                    select: { userId: true }
                }
            }
        });

        const counts = new Map<number, number>();
        bookings.forEach((booking) => {
            const others = new Set<number>();
            if (booking.userId && booking.userId !== requesterUserId) others.add(booking.userId);
            booking.participants.forEach((participant) => {
                if (participant.userId && participant.userId !== requesterUserId) others.add(participant.userId);
            });
            others.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
        });
        return counts;
    }

    private async resolveClubId(input: { clubSlug?: string | null; bookingId?: number | null }): Promise<number> {
        if (input.bookingId) {
            const booking = await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { clubId: true } });
            if (!booking) throw notFound('La reserva no existe.', ErrorCodes.BOOKING_NOT_FOUND);
            return booking.clubId;
        }
        const slug = String(input.clubSlug || '').trim();
        if (!slug) throw badRequest('Indicá el club de la reserva.', ErrorCodes.INVALID_INPUT);
        const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } });
        if (!club) throw notFound('El club no existe.', ErrorCodes.CLUB_NOT_FOUND);
        return club.id;
    }

    async searchByName(input: {
        requesterUserId: number;
        query: string;
        clubSlug?: string | null;
        bookingId?: number | null;
    }): Promise<PlayerInviteCandidate[]> {
        const tokens = String(input.query || '')
            .trim()
            .split(/\s+/)
            .map((token) => token.slice(0, 40))
            .filter(Boolean)
            .slice(0, MAX_QUERY_TOKENS);
        const letters = tokens.join('').replace(/[^\p{L}]/gu, '').length;
        if (letters < MIN_QUERY_LETTERS) return [];

        const clubId = await this.resolveClubId(input);
        const users = await prisma.user.findMany({
            where: {
                id: { not: input.requesterUserId },
                accountStatus: { in: [...SEARCHABLE_ACCOUNT_STATUSES] },
                AND: [
                    ...tokens.map((token) => ({
                        OR: [
                            { firstName: { contains: token, mode: 'insensitive' as const } },
                            { lastName: { contains: token, mode: 'insensitive' as const } }
                        ]
                    })),
                    {
                        OR: [
                            { clients: { some: { clubId } } },
                            { bookings: { some: { clubId } } },
                            { bookingParticipants: { some: { status: 'JOINED' as const, booking: { clubId } } } }
                        ]
                    }
                ]
            },
            select: { id: true, firstName: true, lastName: true },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            take: SEARCH_LIMIT * 2
        });

        const counts = await this.playedWithCounts(input.requesterUserId);
        return users
            .map((user) => this.toCandidate(user, input.requesterUserId, counts.get(user.id) || 0))
            // Primero la gente con la que ya jugó.
            .sort((a, b) => b.playedWithCount - a.playedWithCount)
            .slice(0, SEARCH_LIMIT);
    }

    async frequentPlayers(input: { requesterUserId: number }): Promise<PlayerInviteCandidate[]> {
        const counts = await this.playedWithCounts(input.requesterUserId);
        const topIds = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, FREQUENT_LIMIT * 2)
            .map(([id]) => id);
        if (topIds.length === 0) return [];

        const users = await prisma.user.findMany({
            where: { id: { in: topIds }, accountStatus: { in: [...SEARCHABLE_ACCOUNT_STATUSES] } },
            select: { id: true, firstName: true, lastName: true }
        });
        return users
            .map((user) => this.toCandidate(user, input.requesterUserId, counts.get(user.id) || 0))
            .sort((a, b) => b.playedWithCount - a.playedWithCount)
            .slice(0, FREQUENT_LIMIT);
    }
}
