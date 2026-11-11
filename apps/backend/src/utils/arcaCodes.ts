// §55.2 — cbteTipo por clase, variante y tipo de comprobante
export const getCbteTipo = (
  voucherClass: 'A' | 'B' | 'C',
  variant: 'STANDARD' | 'PAGO_EN_CBU_INFORMADA' | 'OPERACION_SUJETA_A_RETENCION',
  kind: 'INVOICE' | 'CREDIT_NOTE'
): number => {
  if (voucherClass === 'A' && variant === 'OPERACION_SUJETA_A_RETENCION') {
    return kind === 'INVOICE' ? 51 : 53;
  }
  if (voucherClass === 'A') return kind === 'INVOICE' ? 1 : 3;
  if (voucherClass === 'B') return kind === 'INVOICE' ? 6 : 8;
  return kind === 'INVOICE' ? 11 : 13;
};

// §55.4 — docTipo receptor
export const ARCA_DOC_TIPO = {
  CUIT: 80,
  CUIL: 86,
  CDI: 87,
  CI_EXTRANJERA: 91,
  PASSPORT: 94,
  DNI: 96,
  CONSUMIDOR_FINAL: 99
} as const;

export type ArcaDocTipoKey = keyof typeof ARCA_DOC_TIPO;

export const ARCA_DOC_TIPO_ALLOWLIST: ReadonlySet<number> = new Set(Object.values(ARCA_DOC_TIPO));

// §55.5 — condicionIVAReceptorId (requerido por RG 4291 v4.3)
export const ARCA_CONDICION_IVA_RECEPTOR_ID = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 7
} as const;

export type ArcaCondicionIvaReceptorKey = keyof typeof ARCA_CONDICION_IVA_RECEPTOR_ID;

// §55.3 — alícuotas IVA ARCA
export const ARCA_IVA_ALICUOTA_ID = {
  EXENTO: 3,
  VAT_2_5: 9,
  VAT_5: 8,
  VAT_10_5: 4,
  VAT_21: 5,
  VAT_27: 6
} as const;

// Concepto ARCA
export const ARCA_CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3
} as const;

// §55.3 — vatRate (%) → alícuota ARCA id
const RATE_TO_ALICUOTA_ID: Record<number, number> = {
  0: 3,
  2.5: 9,
  5: 8,
  10.5: 4,
  21: 5,
  27: 6
};

export const getIvaAlicuotaId = (rate: number): number | null =>
  RATE_TO_ALICUOTA_ID[rate] ?? null;
