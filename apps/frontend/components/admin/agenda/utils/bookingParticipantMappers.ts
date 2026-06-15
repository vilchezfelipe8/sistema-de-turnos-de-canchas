import type { AdminBookingParticipantDto } from '../../../../services/BookingService';
import type { Booking, Participant, ParticipantSuggestion } from '../types/agendaTypes';
import { toSlugToken } from './bookingValidation';
import { buildParticipantContactFromFields } from './bookingParticipantDisplay';

export function participantExplicitIdentityKeys(input: {
  sourceType?: Participant['sourceType'];
  entityRef?: string;
  selectedUserId?: number;
  personKind?: Participant['personKind'];
  personKey?: string;
  name?: string;
  contact?: string;
  dni?: string;
}) {
  const keys: string[] = [];
  const normalizedEntityRef = String(input.entityRef || '').trim().toLowerCase();
  if (normalizedEntityRef) {
    if (
      normalizedEntityRef.startsWith('client:') ||
      normalizedEntityRef.startsWith('user:') ||
      normalizedEntityRef.startsWith('booking-client:') ||
      normalizedEntityRef.startsWith('booking-user:') ||
      normalizedEntityRef.startsWith('participant-client:') ||
      normalizedEntityRef.startsWith('participant-user:')
    ) {
      keys.push(`ref:${normalizedEntityRef}`);
    }
  }
  const selectedUserId = Number(input.selectedUserId || 0);
  if (Number.isInteger(selectedUserId) && selectedUserId > 0) {
    keys.push(`user:${selectedUserId}`);
  }
  return Array.from(new Set(keys));
}

export function mapPersonSearchResultToParticipantSuggestion(
  row: any,
  query: string,
  prefix: string
): ParticipantSuggestion | null {
  const kind = String(row?.kind || '').trim();
  if (!kind || kind === 'newClientSuggestion') return null;

  const clientId = String(row?.clientId || '').trim();
  const userIdRaw = Number(row?.userId || 0);
  const userId = Number.isFinite(userIdRaw) && userIdRaw > 0 ? userIdRaw : undefined;
  const phone = String(row?.phone || '').trim();
  const email = String(row?.email || '').trim().toLowerCase();
  const sourceType: Participant['sourceType'] =
    kind === 'systemUser' && !clientId ? 'systemUser' : 'clubClient';
  const entityRef =
    clientId
      ? `client:${clientId}`
      : userId
        ? `user:${userId}`
        : undefined;

  return {
    id: `${prefix}-${String(row?.personKey || clientId || userId || query)}`,
    label: String(row?.displayName || query).trim() || query,
    secondary:
      phone || email || String(row?.dni || '').trim() || (kind === 'systemUser' ? 'Usuario Pique' : 'Cliente del club'),
    sourceType,
    entityRef,
    name: String(row?.displayName || query).trim() || query,
    contact: buildParticipantContactFromFields(phone, email),
    dni: String(row?.dni || '').trim() || undefined,
    personKind: kind as Participant['personKind'],
    personKey: String(row?.personKey || '').trim() || undefined,
    personSearchQuery: String(query || '').trim() || undefined,
    badges: Array.isArray(row?.badges) ? row.badges.filter(Boolean).map(String) : undefined,
    selectedUserId: userId,
  } satisfies ParticipantSuggestion;
}

export function resolveParticipantClientId(participant?: Participant | null) {
  const ref = String(participant?.entityRef || '').trim();
  if (ref.startsWith('client:')) {
    const raw = ref.slice('client:'.length).trim();
    return raw.startsWith('client-') ? raw.slice('client-'.length).trim() : raw;
  }
  if (ref.startsWith('booking-client:')) return ref.slice('booking-client:'.length).trim();
  return '';
}

export function resolveParticipantSelectedUserId(participant?: Participant | null) {
  const direct = Number(participant?.selectedUserId || 0);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const ref = String(participant?.entityRef || '').trim();
  if (ref.startsWith('user:')) {
    const raw = Number(ref.slice('user:'.length).trim());
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
  }
  if (ref.startsWith('booking-user:')) {
    const raw = Number(ref.slice('booking-user:'.length).trim());
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
  }
  return 0;
}

export function mapAdminParticipantToPlaygroundParticipant(
  dto: AdminBookingParticipantDto,
  existing?: Participant | null
): Participant {
  const clientId = String(dto.clientId || '').trim();
  const userIdRaw = Number(dto.userId || 0);
  const userId = Number.isFinite(userIdRaw) && userIdRaw > 0 ? userIdRaw : undefined;
  const entityRef = clientId ? `client:${clientId}` : userId ? `user:${userId}` : undefined;
  const sourceType: Participant['sourceType'] = clientId ? 'clubClient' : userId ? 'systemUser' : 'guest';
  const isOwner = String(dto.role || '') === 'ORGANIZER';
  const displayName = String(dto.displayName || dto.invitedName || '').trim() || (isOwner ? 'Titular' : 'Participante');

  return {
    id: isOwner ? 'owner' : (existing?.id || `booking-participant:${dto.id}`),
    bookingParticipantId: dto.id,
    name: displayName,
    contact: buildParticipantContactFromFields(dto.phone, dto.email),
    dni: existing?.dni,
    paid: existing?.paid ?? false,
    isOwner,
    sourceType,
    entityRef,
    selectedUserId: userId,
    personKind:
      clientId && userId
        ? 'linked'
        : clientId
          ? 'clubClient'
          : userId
            ? 'systemUser'
            : undefined,
    personKey: existing?.personKey,
    personSearchQuery: existing?.personSearchQuery,
    badges:
      clientId && userId
        ? ['Cliente del club', 'Usuario Pique']
        : clientId
          ? ['Cliente del club']
          : userId
            ? ['Usuario Pique']
            : undefined,
    paymentMethod: existing?.paymentMethod || 'CASH',
    customPrice: existing?.customPrice ?? null,
  };
}

export function findExistingParticipantMatch(
  participant: AdminBookingParticipantDto,
  currentParticipants: Participant[]
) {
  const participantId = String(participant.id || '').trim();
  const clientId = String(participant.clientId || '').trim();
  const userIdRaw = Number(participant.userId || 0);
  const userId = Number.isFinite(userIdRaw) && userIdRaw > 0 ? userIdRaw : 0;

  return (
    currentParticipants.find((entry) => String(entry.bookingParticipantId || '').trim() === participantId) ||
    currentParticipants.find((entry) => {
      if (String(participant.role || '') === 'ORGANIZER') return entry.isOwner;
      const entryClientId = resolveParticipantClientId(entry);
      const entryUserId = resolveParticipantSelectedUserId(entry);
      if (clientId && entryClientId === clientId) return true;
      if (userId > 0 && entryUserId === userId) return true;
      return false;
    }) ||
    null
  );
}

export function buildStableParticipantRef(
  participant: Participant,
  options?: {
    bookingClientId?: string;
    bookingUserId?: number;
  }
) {
  if (participant.entityRef && String(participant.entityRef).trim().length > 0) {
    return String(participant.entityRef).trim();
  }
  if (participant.isOwner && options?.bookingClientId) {
    return `booking-client:${String(options.bookingClientId)}`;
  }
  if (participant.isOwner && options?.bookingUserId) {
    return `booking-user:${Number(options.bookingUserId)}`;
  }
  if (participant.sourceType === 'systemUser') {
    const fromContact = String(participant.contact || '').trim();
    if (fromContact) return `user:${toSlugToken(fromContact)}`;
  }
  if (participant.sourceType === 'clubClient') {
    const fromContact = String(participant.contact || '').trim();
    if (fromContact) return `client:${toSlugToken(fromContact)}`;
  }
  return `guest:${String(participant.id)}`;
}

export function createInitialParticipants(): Participant[] {
  return [
    {
      id: 'owner',
      name: '',
      contact: '',
      paid: false,
      isOwner: true,
      sourceType: 'guest',
      paymentMethod: 'CASH',
      customPrice: null,
    },
  ];
}

export function buildDefaultParticipantsForBooking(booking: Booking): Participant[] {
  const ownerEntityRef =
    booking.clientId
      ? `booking-client:${booking.clientId}`
      : booking.userId
        ? `booking-user:${Number(booking.userId)}`
        : undefined;
  const ownerSourceType: Participant['sourceType'] =
    booking.clientId ? 'clubClient' : booking.userId ? 'systemUser' : 'guest';

  return createInitialParticipants().map((participant) =>
    participant.isOwner
      ? {
          ...participant,
          id: 'owner',
          name: String(booking.title || ''),
          dni: undefined,
          paid: booking.paymentState === 'paid',
          sourceType: ownerSourceType,
          entityRef: ownerEntityRef,
          selectedUserId:
            Number.isFinite(Number(booking.userId || 0)) && Number(booking.userId) > 0
              ? Number(booking.userId)
              : undefined,
          personKind:
            booking.clientId && booking.userId
              ? 'linked'
              : booking.clientId
                ? 'clubClient'
                : booking.userId
                  ? 'systemUser'
                  : undefined,
          badges:
            booking.clientId && booking.userId
              ? ['Cliente del club', 'Usuario Pique']
              : booking.clientId
                ? ['Cliente del club']
                : booking.userId
                  ? ['Usuario Pique']
                  : undefined,
        }
      : { ...participant, paid: booking.paymentState === 'paid' }
  );
}
