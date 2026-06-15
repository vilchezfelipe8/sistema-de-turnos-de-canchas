import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { normalizeEmail } from '../utils/magicLink';
import { getPhoneIdentityVariants, normalizeIdentityPhone } from '../utils/phone';
import { recordUserClientLinkAuditTx } from './UserClientLinkAudit';
import { ErrorCodes, badRequest, conflict, notFound } from '../errors';

export type PersonSearchResult = {
  personKey: string;
  kind: 'linked' | 'clubClient' | 'systemUser' | 'newClientSuggestion';
  clientId: string | null;
  userId: number | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  badges: string[];
  sourceReason?: string;
};

type PersonUserRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneNumber: string | null;
  dni: string | null;
  relatedToClub: boolean;
  matchedByExactIdentity: boolean;
};

type PersonClientRow = {
  id: string;
  clubId: number;
  userId: number | null;
  name: string;
  email: string | null;
  phone: string | null;
  dni: string | null;
  isProfessor?: boolean | null;
  createdAt?: Date | null;
};

export class PersonService {
  private normalizeSearchEmail(value: string | null | undefined) {
    const raw = String(value || '').trim();
    if (!raw.includes('@')) return null;
    return normalizeEmail(raw) || null;
  }

  private normalizePhone(value: string | null | undefined) {
    return normalizeIdentityPhone(value);
  }

  private normalizeDni(value: string | null | undefined) {
    const normalized = String(value || '').replace(/\D/g, '');
    return normalized.length >= 6 ? normalized : null;
  }

  private buildIdentityTokens(input: {
    userId?: number | null;
    email?: string | null;
    phone?: string | null;
    dni?: string | null;
  }) {
    const tokens: string[] = [];
    const userId = Number(input.userId || 0);
    if (Number.isInteger(userId) && userId > 0) tokens.push(`user:${userId}`);
    const email = normalizeEmail(String(input.email || ''));
    if (email) tokens.push(`email:${email}`);
    const phone = this.normalizePhone(input.phone);
    if (phone) {
      for (const variant of getPhoneIdentityVariants(phone)) {
        tokens.push(`phone:${variant}`);
      }
    }
    const dni = this.normalizeDni(input.dni);
    if (dni) tokens.push(`dni:${dni}`);
    return Array.from(new Set(tokens));
  }

  private dedupeClientRows(rows: PersonClientRow[]) {
    const seenIds = new Set<string>();
    const deduped: PersonClientRow[] = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row?.id || '').trim();
      if (!id) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      deduped.push(row);
    }

    return deduped;
  }

  private buildDisplayNameForUser(user: Pick<PersonUserRow, 'id' | 'firstName' | 'lastName' | 'email'>) {
    const fullName = `${String(user.firstName || '').trim()} ${String(user.lastName || '').trim()}`.trim();
    return fullName || String(user.email || '').trim() || `Usuario ${user.id}`;
  }

  private buildNewClientSuggestion(query: string): PersonSearchResult {
    return {
      personKey: `new:${query.toLowerCase()}`,
      kind: 'newClientSuggestion',
      clientId: null,
      userId: null,
      displayName: query,
      email: this.normalizeSearchEmail(query),
      phone: this.normalizePhone(query),
      dni: this.normalizeDni(query),
      badges: ['Nuevo cliente'],
      sourceReason: 'Sin coincidencias en el club'
    };
  }

  private collapsePeople(rows: PersonSearchResult[]) {
    const resultByKey = new Map<string, PersonSearchResult>();
    for (const row of rows) {
      if (!resultByKey.has(row.personKey)) resultByKey.set(row.personKey, row);
    }

    return Array.from(resultByKey.values());
  }

  private summarizeIdentityForLog(input: {
    clubId: number;
    userId?: number | null;
    email?: string | null;
    phone?: string | null;
    dni?: string | null;
  }) {
    const safePhone = this.normalizePhone(input.phone);
    const safeEmail = normalizeEmail(String(input.email || ''));
    const safeDni = this.normalizeDni(input.dni);
    return {
      clubId: Number(input.clubId),
      userId: Number(input.userId || 0) > 0 ? Number(input.userId) : null,
      phone: safePhone ? `***${safePhone.slice(-4)}` : null,
      email: safeEmail ? `${safeEmail.slice(0, 2)}***@${safeEmail.split('@')[1] || ''}` : null,
      dniSuffix: safeDni ? safeDni.slice(-4) : null
    };
  }

  private logEnsure(event: string, input: {
    clubId: number;
    userId?: number | null;
    email?: string | null;
    phone?: string | null;
    dni?: string | null;
  }, extra?: Record<string, unknown>) {
    console.info('[PERSON_ENSURE_CLIENT]', {
      event,
      ...this.summarizeIdentityForLog(input),
      ...(extra || {})
    });
  }

  private buildLockKey(input: {
    clubId: number;
    userId?: number | null;
    email?: string | null;
    phone?: string | null;
    dni?: string | null;
  }) {
    const fragments = [
      `club:${Number(input.clubId || 0)}`,
      Number(input.userId || 0) > 0 ? `user:${Number(input.userId)}` : null,
      normalizeEmail(String(input.email || '')) ? `email:${normalizeEmail(String(input.email || ''))}` : null,
      this.normalizePhone(input.phone) ? `phone:${this.normalizePhone(input.phone)}` : null,
      this.normalizeDni(input.dni) ? `dni:${this.normalizeDni(input.dni)}` : null
    ].filter(Boolean);
    return fragments.join('|') || `club:${Number(input.clubId || 0)}|anonymous`;
  }

  private async acquireEnsureLockTx(
    tx: Prisma.TransactionClient,
    input: {
      clubId: number;
      userId?: number | null;
      email?: string | null;
      phone?: string | null;
      dni?: string | null;
    }
  ) {
    const key = this.buildLockKey(input);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private async findCanonicalClientByStrongIdentityTx(
    tx: Prisma.TransactionClient,
    input: {
      clubId: number;
      email?: string | null;
      phone?: string | null;
      dni?: string | null;
    }
  ) {
    const clubId = Number(input.clubId);
    const email = normalizeEmail(String(input.email || ''));
    const phone = this.normalizePhone(input.phone);
    const dni = this.normalizeDni(input.dni);
    const or: Prisma.ClientWhereInput[] = [];
    if (dni) or.push({ dni });
    if (email) or.push({ email });
    const phoneVariants = phone ? getPhoneIdentityVariants(phone) : [];
    if (phoneVariants.length > 0) or.push({ phone: { in: phoneVariants } });
    if (or.length === 0) return { canonical: null, matches: [] as PersonClientRow[] };

    const matches = await tx.client.findMany({
      where: { clubId, OR: or },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    }) as PersonClientRow[];

    if (matches.length === 0) return { canonical: null, matches };

    const canonical = matches[0];
    const matchedBy: string[] = [];
    if (dni && String(canonical.dni || '') === dni) matchedBy.push('DNI');
    if (email && normalizeEmail(String(canonical.email || '')) === email) matchedBy.push('EMAIL');
    if (phone && getPhoneIdentityVariants(canonical.phone).some((variant) => phoneVariants.includes(variant))) {
      matchedBy.push('PHONE');
    }
    return {
      canonical: {
        ...canonical,
        matchedBy
      },
      matches
    };
  }

  async searchPeople(clubId: number, query?: string): Promise<PersonSearchResult[]> {
    const search = String(query || '').trim();
    if (!search) return [];

    const exactEmail = this.normalizeSearchEmail(search);
    const exactPhone = this.normalizePhone(search);
    const exactPhoneVariants = exactPhone ? getPhoneIdentityVariants(exactPhone) : [];
    const exactDni = this.normalizeDni(search);

    const clients = await prisma.client.findMany({
      where: {
        clubId,
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { dni: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 24
    }) as PersonClientRow[];

    const dedupedClients = this.dedupeClientRows(clients);

    const relatedUsers = await prisma.user.findMany({
      where: {
        AND: [
          {
            OR: [
              { memberships: { some: { clubId } } },
              { clients: { some: { clubId } } },
              { bookings: { some: { clubId } } },
              { fixedBookings: { some: { clubId } } },
              { bookingParticipants: { some: { booking: { clubId } } } },
              { onlinePaymentAttempts: { some: { booking: { clubId } } } }
            ]
          },
          {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search, mode: 'insensitive' } }
            ]
          }
        ]
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
        dni: true
      },
      orderBy: { id: 'desc' },
      take: 24
    });

    const exactUsers = exactEmail || exactPhoneVariants.length > 0 || exactDni
      ? await prisma.user.findMany({
          where: {
            OR: [
              ...(exactEmail ? [{ email: exactEmail }] : []),
              ...(exactPhoneVariants.length > 0 ? [{ phoneNumber: { in: exactPhoneVariants } }] : []),
              ...(exactDni ? [{ dni: exactDni }] : [])
            ]
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            dni: true
          },
          orderBy: { id: 'desc' },
          take: 12
        })
      : [];

    const explicitlyLinkedUserIds = Array.from(
      new Set(
        dedupedClients
          .map((client) => Number(client.userId || 0))
          .filter((value) => Number.isInteger(value) && value > 0)
      )
    );
    const linkedUsersById = explicitlyLinkedUserIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: explicitlyLinkedUserIds } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            dni: true
          }
        })
      : [];

    const userMap = new Map<number, PersonUserRow>();
    for (const user of relatedUsers) {
      userMap.set(Number(user.id), {
        ...user,
        relatedToClub: true,
        matchedByExactIdentity: false
      });
    }
    for (const user of exactUsers) {
      const id = Number(user.id);
      const previous = userMap.get(id);
      userMap.set(id, {
        ...user,
        relatedToClub: previous?.relatedToClub ?? false,
        matchedByExactIdentity: true
      });
    }
    for (const user of linkedUsersById) {
      const id = Number(user.id);
      const previous = userMap.get(id);
      userMap.set(id, {
        ...user,
        relatedToClub: previous?.relatedToClub ?? true,
        matchedByExactIdentity: previous?.matchedByExactIdentity ?? false
      });
    }
    const users = Array.from(userMap.values());

    const usedUserIds = new Set<number>();
    const personRows: PersonSearchResult[] = [];

    for (const client of dedupedClients) {
      const linkedUser = Number(client.userId || 0) > 0
        ? users.find((user) => Number(user.id) === Number(client.userId)) || null
        : null;

      if (linkedUser) usedUserIds.add(Number(linkedUser.id));

      const linked = Boolean(linkedUser);
      const badges = linked ? ['Cliente del club', 'Usuario Pique'] : ['Cliente del club'];
      const sourceReason = linkedUser ? 'Cliente vinculado a usuario' : 'Cliente del club';

      personRows.push({
        personKey: linkedUser
          ? `linked:client:${client.id}:user:${linkedUser.id}`
          : `client:${client.id}`,
        kind: linked ? 'linked' : 'clubClient',
        clientId: String(client.id),
        userId: linkedUser ? Number(linkedUser.id) : (Number(client.userId || 0) > 0 ? Number(client.userId) : null),
        displayName: String(client.name || '').trim() || 'Sin nombre',
        email: client.email || null,
        phone: client.phone || null,
        dni: client.dni || null,
        badges,
        sourceReason
      });
    }

    for (const user of users) {
      if (usedUserIds.has(Number(user.id))) continue;
      const fullName = this.buildDisplayNameForUser(user);
      personRows.push({
        personKey: `user:${user.id}`,
        kind: 'systemUser',
        clientId: null,
        userId: Number(user.id),
        displayName: fullName,
        email: user.email || null,
        phone: user.phoneNumber || null,
        dni: user.dni || null,
        badges: ['Usuario Pique'],
        sourceReason: user.relatedToClub
          ? 'Usuario relacionado con el club'
          : 'Coincidencia exacta por email o teléfono'
      });
    }

    const collapsed = this.collapsePeople(personRows).slice(0, 8);
    if (collapsed.length > 0) return collapsed;
    return [this.buildNewClientSuggestion(search)];
  }

  async validateSearchSelection(
    clubId: number,
    input: {
      query: string;
      personKey: string;
      userId?: number | null;
      clientId?: string | null;
      allowedKinds?: Array<PersonSearchResult['kind']>;
    }
  ) {
    const query = String(input.query || '').trim();
    const personKey = String(input.personKey || '').trim();
    const safeUserId = Number(input.userId || 0);
    const safeClientId = String(input.clientId || '').trim();

    if (query.length < 2) {
      throw badRequest('La búsqueda de persona es inválida.', ErrorCodes.INVALID_INPUT);
    }
    if (!personKey) {
      throw badRequest('La selección de persona es inválida.', ErrorCodes.INVALID_INPUT);
    }

    const rows = await this.searchPeople(Number(clubId), query);
    const matched = rows.find((row) => String(row.personKey || '').trim() === personKey) || null;

    if (!matched) {
      throw badRequest(
        'La persona seleccionada ya no está disponible. Volvé a buscar y seleccionarla de nuevo.',
        ErrorCodes.INVALID_INPUT
      );
    }

    if (Array.isArray(input.allowedKinds) && input.allowedKinds.length > 0 && !input.allowedKinds.includes(matched.kind)) {
      throw badRequest('La persona seleccionada no es válida para este flujo.', ErrorCodes.INVALID_INPUT);
    }

    if (safeUserId > 0 && Number(matched.userId || 0) !== safeUserId) {
      throw badRequest('La selección de usuario ya no coincide con la búsqueda actual.', ErrorCodes.INVALID_INPUT);
    }

    if (safeClientId && String(matched.clientId || '').trim() !== safeClientId) {
      throw badRequest('La selección de cliente ya no coincide con la búsqueda actual.', ErrorCodes.INVALID_INPUT);
    }

    return matched;
  }

  async ensureClientForUser(
    clubId: number,
    userId: number,
    options?: {
      actorUserId?: number | null;
      source?: 'ADMIN_SELECTED_USER' | 'SELF_BOOKING' | 'PAYMENT_CLAIM' | 'MANUAL_ADMIN' | 'SELF_CLAIM';
      tx?: Prisma.TransactionClient;
    }
  ) {
    const safeUserId = Number(userId || 0);
    if (!Number.isInteger(safeUserId) || safeUserId <= 0) {
      throw badRequest('Usuario inválido para asociar al club.', ErrorCodes.INVALID_INPUT);
    }

    const run = async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.findUnique({
        where: { id: safeUserId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneNumber: true,
          dni: true
        }
      });
      if (!user) throw notFound('Usuario no encontrado', ErrorCodes.USER_NOT_FOUND);

      const name = this.buildDisplayNameForUser(user);
      const normalizedEmail = normalizeEmail(String(user.email || ''));
      const normalizedPhone = this.normalizePhone(user.phoneNumber);
      const normalizedDni = this.normalizeDni(user.dni);

      await this.acquireEnsureLockTx(tx, {
        clubId,
        userId: safeUserId,
        email: normalizedEmail,
        phone: normalizedPhone,
        dni: normalizedDni
      });

      const existingByUser = await tx.client.findFirst({
        where: {
          clubId: Number(clubId),
          userId: safeUserId
        }
      });
      if (existingByUser) {
        this.logEnsure('reuse_existing_client_by_user', {
          clubId,
          userId: safeUserId,
          email: normalizedEmail,
          phone: normalizedPhone,
          dni: normalizedDni
        }, {
          clientId: String(existingByUser.id)
        });
        await recordUserClientLinkAuditTx(tx, {
          clubId: Number(clubId),
          userId: safeUserId,
          clientId: String(existingByUser.id),
          reason: 'ALREADY_LINKED',
          source: String(options?.source || 'ADMIN_SELECTED_USER'),
          actorUserId: Number(options?.actorUserId || 0) || null
        });
        return existingByUser;
      }

      const strongMatches = await this.findCanonicalClientByStrongIdentityTx(tx, {
        clubId: Number(clubId),
        email: normalizedEmail,
        phone: normalizedPhone,
        dni: normalizedDni
      });

      if (strongMatches.canonical) {
        if (strongMatches.matches.length > 1) {
          throw conflict(
            'Se encontraron varios clientes del club con los mismos datos. Elegí el cliente correcto antes de vincular este usuario.',
            ErrorCodes.CLIENT_POSSIBLE_DUPLICATE,
            {
              userId: safeUserId,
              primaryClientId: String(strongMatches.canonical.id),
              candidateClientIds: strongMatches.matches.map((match) => String(match.id)),
              candidates: strongMatches.matches.map((match) => ({
                id: String(match.id),
                name: String(match.name || '').trim() || 'Cliente sin nombre',
                phone: match.phone || null,
                email: match.email || null,
                dni: match.dni || null,
                userId: Number(match.userId || 0) > 0 ? Number(match.userId) : null
              })),
              signals: {
                matchedBy: Array.isArray((strongMatches.canonical as any).matchedBy)
                  ? (strongMatches.canonical as any).matchedBy
                  : []
              }
            }
          );
        }

        const canonicalUserId = Number((strongMatches.canonical as any).userId || 0);
        if (canonicalUserId > 0 && canonicalUserId !== safeUserId) {
          throw conflict(
            'El cliente encontrado ya está vinculado a otro usuario de Pique.',
            ErrorCodes.CLIENT_LINK_CONFLICT,
            {
              clientId: String(strongMatches.canonical.id),
              linkedUserId: canonicalUserId
            }
          );
        }

        const updated = canonicalUserId === safeUserId
          ? strongMatches.canonical
          : await tx.client.update({
              where: { id: String(strongMatches.canonical.id) },
              data: { userId: safeUserId }
            });

        this.logEnsure('link_existing_client_by_strong_identity', {
          clubId,
          userId: safeUserId,
          email: normalizedEmail,
          phone: normalizedPhone,
          dni: normalizedDni
        }, {
          clientId: String(updated.id),
          matchedBy: (strongMatches.canonical as any).matchedBy || [],
          duplicateClientCount: strongMatches.matches.length
        });

        await recordUserClientLinkAuditTx(tx, {
          clubId: Number(clubId),
          userId: safeUserId,
          clientId: String(updated.id),
          reason: options?.source === 'SELF_CLAIM' ? 'SELF_CLAIM_LINK' : 'MANUAL_ADMIN_LINK',
          source: String(options?.source || 'ADMIN_SELECTED_USER'),
          actorUserId: Number(options?.actorUserId || 0) || null,
          payload: {
            matchedBy: (strongMatches.canonical as any).matchedBy || [],
            duplicateClientCount: strongMatches.matches.length
          }
        });

        return updated;
      }

      const created = await tx.client.create({
        data: {
          clubId: Number(clubId),
          userId: safeUserId,
          name,
          email: normalizedEmail || null,
          phone: normalizedPhone || null,
          dni: normalizedDni || null
        }
      });

      this.logEnsure('create_client_for_user', {
        clubId,
        userId: safeUserId,
        email: normalizedEmail,
        phone: normalizedPhone,
        dni: normalizedDni
      }, {
        clientId: String(created.id)
      });

      await recordUserClientLinkAuditTx(tx, {
        clubId: Number(clubId),
        userId: safeUserId,
        clientId: String(created.id),
        reason: 'CREATED_CLIENT',
        source: String(options?.source || 'ADMIN_SELECTED_USER'),
        actorUserId: Number(options?.actorUserId || 0) || null
      });

      return created;
    };

    if (options?.tx) return run(options.tx);
    return prisma.$transaction(run);
  }
}
