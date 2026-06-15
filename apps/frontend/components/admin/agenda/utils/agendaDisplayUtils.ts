import type { Booking } from '../types/agendaTypes';
import { normalizeText } from './bookingValidation';

const LEGACY_UI_EXACT_LABELS: Record<string, string> = {
  owner: 'Titular',
  date: 'Fecha',
  court: 'Cancha',
  time: 'Hora',
  locked: 'Bloqueada',
  add: 'Agregar',
  price: 'Precio',
  payment: 'Pago',
  payments: 'Pagos',
};

const LEGACY_UI_INLINE_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bOwner\b/gi, replacement: 'Titular' },
  { pattern: /\bDate\b/gi, replacement: 'Fecha' },
  { pattern: /\bCourt\b/gi, replacement: 'Cancha' },
  { pattern: /\bTime\b/gi, replacement: 'Hora' },
  { pattern: /\bLocked\b/gi, replacement: 'Bloqueada' },
  { pattern: /\bAdd\b/gi, replacement: 'Agregar' },
  { pattern: /\bPrice\b/gi, replacement: 'Precio' },
  { pattern: /\bPayments?\b/gi, replacement: 'Pago' },
];

export function formatPaymentMethodLabel(method: string): string {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'TRANSFER') return 'Transferencia';
  if (method === 'CARD') return 'Tarjeta';
  if (method === 'OTHER') return 'Otro';
  return 'Pago';
}

export function localizeLegacyUiText(rawValue: unknown): string {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  const exact = LEGACY_UI_EXACT_LABELS[raw.toLowerCase()];
  if (exact) return exact;

  const courtNumber = raw.match(/^court\s+(\d+)$/i);
  if (courtNumber) return `Cancha ${courtNumber[1]}`;

  return LEGACY_UI_INLINE_REPLACEMENTS.reduce(
    (accumulator, item) => accumulator.replace(item.pattern, item.replacement),
    raw
  );
}

export function toUserSafeMessage(rawValue: unknown, fallback: string): string {
  const fallbackMessage = String(fallback || '').trim() || 'Ocurrio un error inesperado.';
  const localizedFallback = localizeLegacyUiText(fallbackMessage) || fallbackMessage;
  const raw = String(rawValue || '').trim();
  if (!raw) return localizedFallback;

  const normalized = raw.toLowerCase();
  const hasInternalKeywords = [
    'backend',
    'frontend',
    'payload',
    'table',
    'column',
    'sql',
    'prisma',
    'stack',
    'booking-client:',
    'booking-user:',
    'guest:',
    'accountid',
    'assignmentid',
    'chargeresponsibleref',
    'entityref',
  ].some((keyword) => normalized.includes(keyword));

  if (hasInternalKeywords) return localizedFallback;

  const cleaned = raw
    .replace(/\b(TypeError|ReferenceError|SyntaxError)\b:?/gi, '')
    .replace(/\bBOOKING_[A-Z_]+\b/g, 'reserva')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const localized = localizeLegacyUiText(cleaned);
  return localized || localizedFallback;
}

export function normalizeBookingDisplayTitle(rawTitle: unknown, fallback = 'Reserva') {
  const title = String(rawTitle || '').trim();
  if (!title) return fallback;

  const normalized = title.toLowerCase();
  if (normalized === 'locked' || normalized === 'block' || normalized === 'blocked') {
    return 'Bloqueo';
  }

  return title;
}

export function bookingColor(state: Booking['state']) {
  if (state === 'completed') return 'bg-blue-100 text-ink-900';
  if (state === 'confirmed') return 'bg-lima-100 text-ink-900';
  if (state === 'blocked') return 'bg-red-100 text-ink-900';
  return 'bg-amber-200 text-ink-900';
}

export function bookingStatusLabel(state: Booking['state']) {
  if (state === 'completed') return 'COMPLETADA';
  if (state === 'confirmed') return 'CONFIRMADA';
  if (state === 'blocked') return 'BLOQUEADO';
  return 'PENDIENTE';
}

export function bookingBadgeColor(state: Booking['state']) {
  if (state === 'completed') return 'bg-blue-200 text-ink-900';
  if (state === 'confirmed') return 'bg-lima-200 text-ink-900';
  if (state === 'blocked') return 'bg-red-200 text-ink-900';
  return 'bg-amber-300 text-ink-900';
}

export function bookingPaymentLabel(state: Booking['paymentState']) {
  if (state === 'paid') return 'PAGADA';
  if (state === 'partial') return 'PARCIAL';
  return 'SIN PAGO';
}

export function bookingPaymentBadgeColor(state: Booking['paymentState']) {
  if (state === 'paid') return 'bg-lima-200 text-ink-900';
  if (state === 'partial') return 'bg-amber-300 text-ink-900';
  return 'bg-ink-300 text-ink-900';
}

export function blockContentVisibility(height: number) {
  return {
    showDurationOnly: height < 30,
    showBadge: height >= 52,
    showTitle: height >= 34,
    showTimeRange: height >= 42,
    inlineTimeWithBadges: height >= 52 && height < 70,
  };
}

export function humanizeClubSlug(slug: string) {
  const safe = String(slug || '').trim();
  if (!safe) return '';
  return safe
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function inferCourtSport(courtLike: any): string {
  const candidates = [
    courtLike?.sport,
    courtLike?.surface,
    courtLike?.surfaceType,
    courtLike?.activityType?.name,
    courtLike?.activity?.name,
    courtLike?.name,
  ]
    .map(normalizeText)
    .filter((value) => value.length > 0);

  const full = candidates.join(' ');

  if (full.includes('tenis') || full.includes('tennis')) return 'Tenis';
  if (full.includes('pickle')) return 'Pickleball';
  if (full.includes('squash')) return 'Squash';
  if (full.includes('voley') || full.includes('beach volley') || full.includes('volley playa')) return 'Voley playa';
  if (full.includes('futbol') || full.includes('futbol 5')) return 'Fútbol';
  if (full.includes('padel') || full.includes('paddle')) return 'Pádel';

  return String(courtLike?.activityType?.name || courtLike?.sport || courtLike?.surface || 'Pádel');
}
