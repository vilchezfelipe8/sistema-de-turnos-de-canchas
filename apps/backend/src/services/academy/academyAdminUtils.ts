import { badRequest, ErrorCodes } from '../../errors';

export const normalizeOptionalString = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeStringArray = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length > 0)
    )
  );
};

export const parseDateTimeOrThrow = (value: unknown, fieldLabel: string) => {
  const date = new Date(String(value || '').trim());
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`${fieldLabel} inválida.`, ErrorCodes.INVALID_DATE_TIME);
  }
  return date;
};

export const parseMoneyOrThrow = (value: unknown, fieldLabel: string) => {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw badRequest(`${fieldLabel} inválido.`, ErrorCodes.PAYMENT_INVALID_AMOUNT);
  }
  return amount.toFixed(2);
};
