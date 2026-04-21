import type { RefundContext, RefundDraft } from './refund.types';

const REFUND_DEFAULTS_BY_CONTEXT: Record<RefundContext, Pick<RefundDraft, 'executeNow' | 'reasonType'>> = {
  ACCOUNT_MANUAL: {
    executeNow: false,
    reasonType: 'OTHER'
  },
  BOOKING_CANCELLATION: {
    executeNow: true,
    reasonType: 'FULL'
  }
};

export function buildDefaultRefundDraft(context: RefundContext, maxAmount: number): RefundDraft {
  const defaults = REFUND_DEFAULTS_BY_CONTEXT[context];
  const safeAmount = Number.isFinite(maxAmount) ? Math.max(0, maxAmount) : 0;
  return {
    amountInput: String(Number(safeAmount.toFixed(2))),
    executeNow: defaults.executeNow,
    reasonType: defaults.reasonType,
    executionNotes: ''
  };
}
