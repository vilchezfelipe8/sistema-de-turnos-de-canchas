export type PhoneCountryOption = {
  iso2: string;
  label: string;
  callingCode: string;
};

export const PHONE_COUNTRY_OPTIONS: PhoneCountryOption[] = [
  { iso2: 'AR', label: 'Argentina', callingCode: '+54' },
  { iso2: 'UY', label: 'Uruguay', callingCode: '+598' },
  { iso2: 'CL', label: 'Chile', callingCode: '+56' },
  { iso2: 'BR', label: 'Brasil', callingCode: '+55' },
  { iso2: 'PY', label: 'Paraguay', callingCode: '+595' },
  { iso2: 'BO', label: 'Bolivia', callingCode: '+591' },
  { iso2: 'PE', label: 'Perú', callingCode: '+51' },
  { iso2: 'CO', label: 'Colombia', callingCode: '+57' },
  { iso2: 'MX', label: 'México', callingCode: '+52' },
  { iso2: 'US', label: 'Estados Unidos', callingCode: '+1' },
  { iso2: 'CA', label: 'Canadá', callingCode: '+1' },
  { iso2: 'ES', label: 'España', callingCode: '+34' }
];

export const DEFAULT_PHONE_COUNTRY_ISO2 = 'AR';

const onlyDigits = (value: unknown) => String(value || '').replace(/\D/g, '');

export const resolveCallingCodeByIso2 = (iso2: string | null | undefined): string => {
  const safe = String(iso2 || '').trim().toUpperCase();
  const found = PHONE_COUNTRY_OPTIONS.find((option) => option.iso2 === safe);
  return found?.callingCode || PHONE_COUNTRY_OPTIONS[0].callingCode;
};

export const normalizePhoneCountryIso2 = (iso2: string | null | undefined): string => {
  const safe = String(iso2 || '').trim().toUpperCase();
  if (PHONE_COUNTRY_OPTIONS.some((option) => option.iso2 === safe)) return safe;
  return DEFAULT_PHONE_COUNTRY_ISO2;
};

export const buildCanonicalPhone = (input: {
  countryIso2?: string | null;
  localNumber?: string | null;
  fullPhone?: string | null;
}) => {
  const rawFull = String(input.fullPhone || '').trim();
  if (rawFull.startsWith('+')) {
    const digits = onlyDigits(rawFull);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const localDigits = onlyDigits(input.localNumber).replace(/^0+/, '');
  if (!localDigits) return null;

  const callingCodeDigits = onlyDigits(resolveCallingCodeByIso2(input.countryIso2));
  let normalizedLocal = localDigits;
  if (callingCodeDigits === '54' && normalizedLocal.length === 10 && !normalizedLocal.startsWith('9')) {
    normalizedLocal = `9${normalizedLocal}`;
  }
  const merged = `${callingCodeDigits}${normalizedLocal}`;
  if (merged.length < 8 || merged.length > 15) return null;
  return `+${merged}`;
};

export const splitCanonicalPhone = (phone: string | null | undefined, fallbackIso2?: string | null) => {
  const canonical = String(phone || '').trim();
  const fallback = normalizePhoneCountryIso2(fallbackIso2);
  if (!canonical.startsWith('+')) {
    return { countryIso2: fallback, localNumber: onlyDigits(canonical) };
  }

  const digits = onlyDigits(canonical);
  const optionsByCode = [...PHONE_COUNTRY_OPTIONS].sort(
    (left, right) => right.callingCode.length - left.callingCode.length
  );
  const matched = optionsByCode.find((option) => {
    const codeDigits = onlyDigits(option.callingCode);
    return digits.startsWith(codeDigits);
  });
  if (!matched) return { countryIso2: fallback, localNumber: digits };

  const codeDigits = onlyDigits(matched.callingCode);
  return {
    countryIso2: matched.iso2,
    localNumber: digits.slice(codeDigits.length)
  };
};
