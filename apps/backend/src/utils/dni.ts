// DNI normalizado: solo dígitos. Se considera válido con 6 a 9 dígitos
// (cubre DNI argentinos viejos y nuevos sin aceptar números de teléfono).
export const DNI_MIN_DIGITS = 6;
export const DNI_MAX_DIGITS = 9;

export function normalizeDni(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < DNI_MIN_DIGITS || digits.length > DNI_MAX_DIGITS) return null;
  return digits;
}

// Un identificador de login es DNI si, sacando puntos, espacios y guiones, quedan solo dígitos.
export function looksLikeDni(identifier: string): boolean {
  const compact = String(identifier || '').replace(/[.\s-]/g, '');
  return compact.length > 0 && /^\d+$/.test(compact);
}
