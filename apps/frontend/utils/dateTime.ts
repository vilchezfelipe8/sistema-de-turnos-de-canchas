const DEFAULT_LOCALE = 'es-AR';

type DateInput = Date | string | number | null | undefined;

const toValidDate = (value: DateInput): Date | null => {
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatTime24 = (value: DateInput, options?: { timeZone?: string; fallback?: string }) => {
  const date = toValidDate(value);
  if (!date) return options?.fallback ?? '--:--';

  return date.toLocaleTimeString(DEFAULT_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(options?.timeZone ? { timeZone: options.timeZone } : {})
  });
};

export const formatDateTime24 = (
  value: DateInput,
  options?: { timeZone?: string; fallback?: string }
) => {
  const date = toValidDate(value);
  if (!date) return options?.fallback ?? 'Sin hora definida';

  return date.toLocaleString(DEFAULT_LOCALE, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(options?.timeZone ? { timeZone: options.timeZone } : {})
  });
};
