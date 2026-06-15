import type { RecurringCreatedItem, RecurringOverlapItem } from '../types/agendaTypes';

function toValidDate(value: unknown) {
  const parsed = new Date(String(value || ''));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function formatSeriesDateLabel(value: unknown, timeZone?: string | null) {
  const parsed = toValidDate(value);
  if (!parsed) return '';
  return parsed.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function formatSeriesTimeLabel(value: unknown, timeZone?: string | null) {
  const parsed = toValidDate(value);
  if (!parsed) return '';
  return parsed.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
}

export function mapSeriesImpactItem(item: any, fallbackCourtName: string, timeZone?: string | null): RecurringOverlapItem {
  const requestedAt = item?.requestedStartDateTime || item?.startDateTime || item?.requestedAt;
  const conflictingAt = item?.conflictingStartDateTime || item?.conflictStartDateTime || item?.overlapStartDateTime;
  return {
    courtName: String(item?.courtName || item?.requestedCourtName || fallbackCourtName || 'Cancha').trim(),
    requestedDateLabel: formatSeriesDateLabel(requestedAt, timeZone),
    requestedTimeLabel: formatSeriesTimeLabel(requestedAt, timeZone),
    conflictingDateLabel: formatSeriesDateLabel(conflictingAt, timeZone) || undefined,
    conflictingTimeLabel: formatSeriesTimeLabel(conflictingAt, timeZone) || undefined,
    activityName: String(item?.activityName || '').trim() || undefined,
    clientName: String(item?.clientName || '').trim() || undefined,
  };
}

export function mapSeriesAppliedItem(item: any, fallbackCourtName: string, timeZone?: string | null): RecurringCreatedItem {
  const requestedAt = item?.requestedStartDateTime || item?.startDateTime || item?.requestedAt;
  const parsed = toValidDate(requestedAt);
  return {
    bookingId: Number.isFinite(Number(item?.bookingId || item?.id))
      ? Number(item?.bookingId || item?.id)
      : undefined,
    courtName: String(item?.courtName || item?.requestedCourtName || fallbackCourtName || 'Cancha').trim(),
    requestedDateLabel: formatSeriesDateLabel(requestedAt, timeZone),
    requestedTimeLabel: formatSeriesTimeLabel(requestedAt, timeZone),
    activityName: String(item?.activityName || '').trim() || undefined,
    sortStartMs: parsed ? parsed.getTime() : undefined,
  };
}
