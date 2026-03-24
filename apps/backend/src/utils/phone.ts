type NormalizePhoneInput =
  | string
  | null
  | undefined
  | {
      phone?: string | null;
      countryCode?: string | null;
      phoneNumberLocal?: string | null;
    };

type NormalizePhoneOptions = {
  defaultCountryIso2?: string | null;
  defaultCountryCode?: string | null;
};

const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;

export const COUNTRY_CALLING_CODE_BY_ISO2: Record<string, string> = {
  AR: '+54',
  UY: '+598',
  CL: '+56',
  BR: '+55',
  PY: '+595',
  BO: '+591',
  PE: '+51',
  CO: '+57',
  MX: '+52',
  US: '+1',
  CA: '+1',
  ES: '+34',
  IT: '+39',
  FR: '+33',
  DE: '+49',
  GB: '+44',
  PT: '+351'
};

const onlyDigits = (value: unknown) => String(value || '').replace(/\D/g, '');

const normalizeCountryCode = (value: string | null | undefined): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (raw.startsWith('+')) {
    const digits = onlyDigits(raw);
    if (!digits) return null;
    return `+${digits}`;
  }

  if (raw.startsWith('00')) {
    const digits = onlyDigits(raw.slice(2));
    if (!digits) return null;
    return `+${digits}`;
  }

  const upper = raw.toUpperCase();
  if (COUNTRY_CALLING_CODE_BY_ISO2[upper]) {
    return COUNTRY_CALLING_CODE_BY_ISO2[upper];
  }

  const digits = onlyDigits(raw);
  if (!digits) return null;
  return `+${digits}`;
};

export const resolveCountryCallingCodeByIso2 = (countryIso2: string | null | undefined): string | null => {
  const upper = String(countryIso2 || '').trim().toUpperCase();
  return COUNTRY_CALLING_CODE_BY_ISO2[upper] || null;
};

export function normalizeIdentityPhone(input: NormalizePhoneInput, options?: NormalizePhoneOptions): string | null {
  const isObjectInput = Boolean(input && typeof input === 'object');
  const payload = isObjectInput ? (input as Exclude<NormalizePhoneInput, string | null | undefined>) : null;

  const rawPhone = String((payload?.phone ?? (typeof input === 'string' ? input : '')) || '').trim();
  const rawLocal = String(payload?.phoneNumberLocal || '').trim();
  const explicitCountryCode = normalizeCountryCode(payload?.countryCode ?? null);
  const fallbackCountryCode =
    normalizeCountryCode(options?.defaultCountryCode ?? null) ||
    resolveCountryCallingCodeByIso2(options?.defaultCountryIso2 ?? null);
  const countryCode = explicitCountryCode || fallbackCountryCode;

  if (rawPhone.startsWith('+')) {
    const digits = onlyDigits(rawPhone);
    if (digits.length < MIN_E164_DIGITS || digits.length > MAX_E164_DIGITS) return null;
    return `+${digits}`;
  }

  if (rawPhone.startsWith('00')) {
    const digits = onlyDigits(rawPhone.slice(2));
    if (digits.length < MIN_E164_DIGITS || digits.length > MAX_E164_DIGITS) return null;
    return `+${digits}`;
  }

  const phoneDigits = onlyDigits(rawPhone);
  const localDigits = onlyDigits(rawLocal).replace(/^0+/, '');
  const selectedLocal = localDigits || phoneDigits.replace(/^0+/, '');

  if (countryCode && selectedLocal) {
    const ccDigits = onlyDigits(countryCode);
    let normalizedLocal = selectedLocal;
    // Regla país-específica (Argentina): E.164 móvil usa +54 9 ...
    if (ccDigits === '54' && normalizedLocal.length === 10 && !normalizedLocal.startsWith('9')) {
      normalizedLocal = `9${normalizedLocal}`;
    }
    const digits = `${ccDigits}${normalizedLocal}`;
    if (digits.length < MIN_E164_DIGITS || digits.length > MAX_E164_DIGITS) return null;
    return `+${digits}`;
  }

  if (phoneDigits.length >= MIN_E164_DIGITS && phoneDigits.length <= MAX_E164_DIGITS) {
    // Compatibilidad: si llega un número completo sin prefijo, lo promovemos a formato internacional.
    return `+${phoneDigits}`;
  }

  return null;
}

export function getPhoneIdentityVariants(phone: string | null | undefined): string[] {
  const canonical = normalizeIdentityPhone(phone);
  if (!canonical) return [];

  const digits = canonical.startsWith('+') ? canonical.slice(1) : onlyDigits(canonical);
  const values = new Set<string>([canonical]);
  if (digits) values.add(digits);
  return Array.from(values);
}

export function toDialablePhoneNumber(phone: string | null | undefined): string | null {
  const canonical = normalizeIdentityPhone(phone);
  if (!canonical) return null;
  const digits = onlyDigits(canonical);
  return digits || null;
}
