type CodeInput = {
  prefix: string;
  technicalId?: string | number | null;
  displayCode?: string | null;
  digits?: number;
};

const normalizeToken = (value: string) =>
  value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

export const formatDisplayCode = ({
  prefix,
  technicalId,
  displayCode,
  digits = 6
}: CodeInput): string => {
  const normalizedPrefix = normalizeToken(prefix);
  const explicit = String(displayCode || '').trim();
  if (explicit) return explicit;

  const raw = String(technicalId ?? '').trim();
  if (!raw) return `${normalizedPrefix}-000000`;

  if (/^\d+$/.test(raw)) {
    const padded = raw.slice(-digits).padStart(digits, '0');
    return `${normalizedPrefix}-${padded}`;
  }

  const token = normalizeToken(raw);
  const suffix = token.slice(-digits).padStart(digits, '0');
  return `${normalizedPrefix}-${suffix}`;
};

export const formatAccountCode = (technicalId?: string | number | null, displayCode?: string | null) =>
  formatDisplayCode({ prefix: 'CTA', technicalId, displayCode });

export const formatBookingCode = (technicalId?: string | number | null, displayCode?: string | null) =>
  formatDisplayCode({ prefix: 'RES', technicalId, displayCode });

export const formatPaymentCode = (technicalId?: string | number | null, displayCode?: string | null) =>
  formatDisplayCode({ prefix: 'PAG', technicalId, displayCode });

export const formatRefundCode = (technicalId?: string | number | null, displayCode?: string | null) =>
  formatDisplayCode({ prefix: 'DEV', technicalId, displayCode });
