const PHONE_KEYS = new Set([
  'businessphone',
  'displayphone',
  'from',
  'phone',
  'phonenumber',
  'recipientid',
  'recipientphone',
  'to',
  'waid'
]);

const SECRET_KEYS = new Set([
  'access_token',
  'authorization',
  'token',
  'tokensecretref',
  'verify_token'
]);

const isPhoneKey = (key: string) => {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return PHONE_KEYS.has(normalized) || normalized.endsWith('phone');
};

const isSecretKey = (key: string) => {
  const normalized = key.replace(/[^a-z0-9_]/gi, '').toLowerCase();
  return (
    SECRET_KEYS.has(normalized) ||
    normalized.includes('authorization') ||
    normalized.includes('token') ||
    normalized.includes('secret')
  );
};

const looksLikeBearerValue = (value: string) =>
  /^bearer\s+[a-z0-9._~+/=-]+$/i.test(String(value).trim());

export const maskPhone = (phone: unknown): string | null => {
  const value = String(phone ?? '').trim();
  if (!value) return null;

  const visibleDigits = 4;
  if (value.length <= visibleDigits) {
    return `${'*'.repeat(Math.max(value.length - 1, 0))}${value.slice(-1)}`;
  }

  const masked = '*'.repeat(Math.max(value.length - visibleDigits, 0));
  return `${masked}${value.slice(-visibleDigits)}`;
};

const sanitizeStringValue = (value: string, keyHint?: string): string => {
  if (keyHint && isSecretKey(keyHint)) {
    return '[REDACTED]';
  }

  if (looksLikeBearerValue(value)) {
    return '[REDACTED]';
  }

  if (keyHint && isPhoneKey(keyHint)) {
    return maskPhone(value) ?? '';
  }

  return value;
};

export const sanitizeWhatsappPayload = (
  value: unknown,
  keyHint?: string
): unknown => {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWhatsappPayload(item));
  }

  if (typeof value === 'string') {
    return sanitizeStringValue(value, keyHint);
  }

  if (typeof value !== 'object') {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(input)) {
    output[key] = sanitizeWhatsappPayload(entryValue, key);
  }

  return output;
};

export const sanitizeWhatsappRawRequest = (value: unknown): unknown =>
  sanitizeWhatsappPayload(value);

export const sanitizeWhatsappRawResponse = (value: unknown): unknown =>
  sanitizeWhatsappPayload(value);
