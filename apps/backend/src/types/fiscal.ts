export type VoucherClass = 'A' | 'B' | 'C';
export type FiscalMode = 'OBLIGATORIA' | 'OPCIONAL' | 'DESHABILITADA';
export type FiscalProvider = 'ARCA' | 'NONE' | 'OTRO';
export type FiscalVoucherKind = 'INVOICE' | 'CREDIT_NOTE';
export type OperationKind = 'PRODUCT' | 'SERVICE' | 'MIXED';
export type VoucherVariant = 'STANDARD' | 'PAGO_EN_CBU_INFORMADA' | 'OPERACION_SUJETA_A_RETENCION';

export type FiscalResolution =
  | {
      mode: 'INTERNAL_ONLY';
      reason: string;
    }
  | {
      mode: 'ISSUE_FISCAL';
      voucherKind: FiscalVoucherKind;
      voucherClass: VoucherClass;
      voucherVariant: VoucherVariant;
      comprobanteTipo: number;
      concept: 1 | 2 | 3;
      requiresReceiverDoc: boolean;
      requiresServiceDates: boolean;
      requiresAssociatedVoucher: boolean;
    };

export type ResolveFiscalPolicyInput = {
  clubId: number;
  provider: FiscalProvider;
  fiscalMode: FiscalMode;
  issuerFiscalCondition: string | null;
  receiverFiscalCondition?: string | null;
  receiverDocType?: number | null;
  receiverDocNumber?: string | null;
  operationKind: OperationKind;
  voucherKind: FiscalVoucherKind;
  voucherVariant?: VoucherVariant | null;
};
