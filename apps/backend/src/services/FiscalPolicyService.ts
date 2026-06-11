import type {
  FiscalResolution,
  ResolveFiscalPolicyInput,
  VoucherClass,
  VoucherVariant
} from '../types/fiscal';
import { getCbteTipo } from '../utils/arcaCodes';

const resolveConcept = (operationKind: ResolveFiscalPolicyInput['operationKind']): 1 | 2 | 3 => {
  if (operationKind === 'PRODUCT') return 1;
  if (operationKind === 'SERVICE') return 2;
  return 3;
};

type ClassVariantResult =
  | { voucherClass: VoucherClass; voucherVariant: VoucherVariant }
  | { blocked: true; reason: string };

const resolveClassAndVariant = (
  issuerCondition: string | null,
  receiverCondition: string | null | undefined,
  requestedVariant: VoucherVariant | null | undefined
): ClassVariantResult => {
  const issuer = String(issuerCondition || '').toUpperCase();
  const receiver = String(receiverCondition || '').toUpperCase();

  if (!issuer || issuer === 'CONSUMIDOR_FINAL') {
    return { blocked: true, reason: 'La condicion fiscal del emisor no permite emitir comprobantes fiscales.' };
  }

  let voucherClass: VoucherClass;

  if (issuer === 'RESPONSABLE_INSCRIPTO') {
    voucherClass = receiver === 'RESPONSABLE_INSCRIPTO' ? 'A' : 'B';
  } else if (issuer === 'MONOTRIBUTO' || issuer === 'EXENTO') {
    voucherClass = 'C';
  } else {
    return { blocked: true, reason: `Condicion fiscal del emisor no reconocida: ${issuer}.` };
  }

  const variant: VoucherVariant = requestedVariant ?? 'STANDARD';

  if (variant !== 'STANDARD' && voucherClass !== 'A') {
    return {
      blocked: true,
      reason: `La variante ${variant} solo es valida para comprobantes clase A (emisor Responsable Inscripto con receptor Responsable Inscripto).`
    };
  }

  return { voucherClass, voucherVariant: variant };
};

export class FiscalPolicyService {
  resolve(input: ResolveFiscalPolicyInput): FiscalResolution {
    if (input.provider !== 'ARCA') {
      return { mode: 'INTERNAL_ONLY', reason: 'Proveedor fiscal no habilitado.' };
    }

    if (input.fiscalMode === 'DESHABILITADA') {
      return { mode: 'INTERNAL_ONLY', reason: 'Facturacion fiscal deshabilitada.' };
    }

    if (!input.issuerFiscalCondition) {
      return { mode: 'INTERNAL_ONLY', reason: 'Condicion fiscal del emisor faltante.' };
    }

    const classResult = resolveClassAndVariant(
      input.issuerFiscalCondition,
      input.receiverFiscalCondition,
      input.voucherVariant
    );

    if ('blocked' in classResult) {
      return { mode: 'INTERNAL_ONLY', reason: classResult.reason };
    }

    const { voucherClass, voucherVariant } = classResult;
    const concept = resolveConcept(input.operationKind);
    const comprobanteTipo = getCbteTipo(voucherClass, voucherVariant, input.voucherKind);

    const requiresReceiverDoc = voucherClass === 'A';
    const requiresServiceDates = concept === 2 || concept === 3;
    const requiresAssociatedVoucher = input.voucherKind === 'CREDIT_NOTE';

    return {
      mode: 'ISSUE_FISCAL',
      voucherKind: input.voucherKind,
      voucherClass,
      voucherVariant,
      comprobanteTipo,
      concept,
      requiresReceiverDoc,
      requiresServiceDates,
      requiresAssociatedVoucher
    };
  }
}
