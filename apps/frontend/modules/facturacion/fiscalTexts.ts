// Textos simples de facturación, compartidos entre la pantalla de Facturación y la cuenta.

/** Qué hacer con una factura que no salió, según lo que sugiere el backend. */
export const FACTURA_ACTION_HINT: Record<string, string> = {
  RETRY_AUTOMATICALLY: 'Pique la vuelve a intentar sola.',
  REFRESH_AUTH_AND_RETRY: 'Pique pide permiso a ARCA de nuevo y la reintenta.',
  REQUIRE_ADMIN_CONFIGURATION_FIX: 'Revisá los datos del club, el punto de venta o el certificado en Ajustes → Facturación.',
  REQUIRE_RECEIVER_DATA_FIX: 'Revisá el CUIT o DNI del cliente y volvé a emitirla desde la cuenta.',
  REQUIRE_MANUAL_RECONCILIATION: 'Puede que ARCA ya la tenga. Fijate en la web de ARCA antes de reintentar, para no duplicarla.',
  REQUIRE_ENGINEERING_REVIEW: 'Es un error que tiene que mirar Pique. Escribinos.',
};

export type FacturaTone = 'ok' | 'progress' | 'problem' | 'muted';

/** Estado de una factura en palabras. */
export const facturaStateText = (status: string): { label: string; tone: FacturaTone } => {
  switch (status) {
    case 'APPROVED':
    case 'APPROVED_WITH_OBSERVATIONS':
      return { label: 'Emitida', tone: 'ok' };
    case 'PENDING':
    case 'PROCESSING':
      return { label: 'Saliendo…', tone: 'progress' };
    case 'REJECTED':
      return { label: 'ARCA la rechazó', tone: 'problem' };
    case 'TECHNICAL_ERROR':
      return { label: 'No salió', tone: 'problem' };
    default:
      return { label: 'Cancelada', tone: 'muted' };
  }
};

export const FACTURA_TONE_CLASS: Record<FacturaTone, string> = {
  ok: 'bg-p-positive-bg text-p-positive',
  progress: 'bg-p-surface-2 text-p-text-secondary',
  problem: 'bg-p-error-bg text-[var(--error-fg)]',
  muted: 'bg-p-surface-2 text-p-text-muted',
};

/** CUIT válido: 11 dígitos y dígito verificador correcto. */
export const isValidCuit = (raw: string) => {
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod;
  return check !== 10 && check === Number(digits[10]);
};

/** 20123456789 → 20-12345678-9 (formatea lo que haya mientras se escribe). */
export const formatCuit = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 10) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
};
