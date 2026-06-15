import type { Participant } from '../types/agendaTypes';

export function normalizeText(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function toSlugToken(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'guest';
}

export function isOwnerLikeParticipantRef(participantRef: string | null | undefined) {
  const normalized = String(participantRef || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'owner' ||
    normalized.startsWith('owner-') ||
    normalized.startsWith('owner_') ||
    normalized.startsWith('guest:owner') ||
    normalized.startsWith('guest:booking-responsible') ||
    normalized.startsWith('booking-client:') ||
    normalized.startsWith('booking-user:')
  );
}

export function isOwnerLikeParticipantId(participantId: string | null | undefined) {
  const normalized = String(participantId || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === 'owner' || normalized.startsWith('owner-') || normalized.startsWith('owner_');
}

export function inferParticipantSourceTypeFromEntityRef(entityRef: string | undefined): Participant['sourceType'] {
  const ref = String(entityRef || '').trim().toLowerCase();
  if (!ref) return 'guest';
  if (ref.startsWith('booking-client:') || ref.startsWith('client:')) return 'clubClient';
  if (ref.startsWith('booking-user:') || ref.startsWith('user:')) return 'systemUser';
  return 'guest';
}

export function isBlockingQuoteError(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  const blockers = [
    'no se pueden reservar turnos en el pasado',
    'duracion no permitida por el club',
    'horario no permitido por el club',
    'el club esta cerrado ese dia',
    'el club esta cerrado para la fecha seleccionada',
    'la actividad esta cerrada para la fecha seleccionada',
    'la actividad esta cerrada para la fecha solicitada',
    'la reserva excede el horario de apertura del club',
    'limite de anticipacion excedido',
    'precio de cancha no configurado',
    'cancha en mantenimiento',
    'actividad no existe',
    'la actividad no pertenece al club de la cancha',
  ];
  return blockers.some((token) => normalized.includes(token));
}
