const toNumber = (value: unknown) => Number(value || 0);
const requireDefined = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
};

export const mapPaymentDto = (payment: any) => ({
  id: payment.id,
  displayCode: payment.displayCode ?? null,
  createdAt: payment.createdAt,
  amount: toNumber(payment.amount),
  method: payment.method,
  channel: requireDefined(payment.channel, 'Payment.channel es obligatorio'),
  collectorAccountLabel: payment.collectorAccountLabel ?? null,
  externalReference: payment.externalReference ?? null,
  payerParticipantRef: payment.payerParticipantRef ?? null,
  payerParticipantName: payment.payerParticipantName ?? null,
  coveredParticipantRef: payment.coveredParticipantRef ?? null,
  coveredParticipantName: payment.coveredParticipantName ?? null,
  source: payment.source,
  accountId: payment.accountId,
  cashShiftId: payment.cashShiftId ?? null,
  allocations: Array.isArray(payment.allocations)
    ? payment.allocations.map((allocation: any) => ({
        id: allocation.id,
        accountItemId: allocation.accountItemId,
        amount: toNumber(allocation.amount)
      }))
    : []
});


export const mapRefundDto = (refund: any) => ({
  id: refund.id,
  displayCode: refund.displayCode ?? null,
  createdAt: refund.createdAt,
  amount: toNumber(refund.amount),
  reason: refund.reason ?? null,
  reasonType: requireDefined(refund.reasonType, 'Refund.reasonType es obligatorio'),
  status: requireDefined(refund.status, 'Refund.status es obligatorio'),
  executionMethod: refund.executionMethod ?? null,
  paymentId: refund.paymentId,
  accountId: refund.accountId,
  clubId: refund.clubId,
  cashShiftId: refund.cashShiftId ?? null,
  createdByUserId: refund.createdByUserId ?? null,
  approvedAt: refund.approvedAt ?? null,
  approvedByUserId: refund.approvedByUserId ?? null,
  executedAt: refund.executedAt ?? null,
  executedByUserId: refund.executedByUserId ?? null,
  cancelledAt: refund.cancelledAt ?? null,
  cancelledByUserId: refund.cancelledByUserId ?? null,
  cancelReason: refund.cancelReason ?? null,
  executionReference: refund.executionReference ?? null,
  executionNotes: refund.executionNotes ?? null,
  failedAt: refund.failedAt ?? null,
  failedReason: refund.failedReason ?? null,
  paymentChannel: refund.payment?.channel ?? null
});

export const mapAccountItemDto = (item: any) => ({
  id: item.id,
  accountId: item.accountId,
  type: item.type,
  description: item.description,
  quantity: item.quantity,
  unitPrice: toNumber(item.unitPrice),
  total: toNumber(item.total),
  createdAt: item.createdAt,
  discounts: Array.isArray(item.discounts)
    ? item.discounts.map((discount: any) => ({
        id: discount.id,
        policyId: discount.policyId,
        policyName: discount.policy?.name ?? null,
        scope: discount.scope,
        amountType: discount.amountType,
        amountValue: toNumber(discount.amountValue),
        baseAmount: toNumber(discount.baseAmount),
        discountAmount: toNumber(discount.discountAmount),
        finalAmount: toNumber(discount.finalAmount),
        createdAt: discount.createdAt
      }))
    : []
});

export const mapAccountDto = (account: any) => ({
  id: account.id,
  displayCode: account.displayCode ?? null,
  clubId: account.clubId,
  sourceType: account.sourceType,
  sourceId: account.sourceId,
  status: account.status,
  totalAmount: toNumber(account.totalAmount),
  paidAmount: toNumber(account.paidAmount),
  createdAt: account.createdAt,
  closedAt: account.closedAt ?? null,
  client: account.client
    ? { id: account.client.id, name: account.client.name, phone: account.client.phone ?? null, email: account.client.email ?? null }
    : null
});

export const mapLedgerEntryDto = (entry: any) => ({
  id: entry.id,
  clubId: entry.clubId,
  type: entry.type,
  referenceType: entry.referenceType,
  referenceId: entry.referenceId,
  accountId: entry.accountId ?? null,
  accountItemId: entry.accountItemId ?? null,
  paymentId: entry.paymentId ?? null,
  amount: toNumber(entry.amount),
  direction: entry.direction,
  description: entry.description,
  createdByUserId: entry.createdByUserId ?? null,
  createdAt: entry.createdAt
});

export const mapCashMovementDto = (movement: any) => ({
  id: movement.id,
  type: movement.type,
  method: movement.method,
  concept: movement.concept,
  amount: toNumber(movement.amount),
  clubId: movement.clubId,
  paymentId: movement.paymentId ?? null,
  cashShiftId: movement.cashShiftId ?? null,
  createdByUserId: movement.createdByUserId ?? null,
  createdAt: movement.createdAt
});

export const mapCashShiftDto = (shift: any) => ({
  id: shift.id,
  cashRegisterId: shift.cashRegisterId,
  openedByUserId: shift.openedByUserId,
  openedAt: shift.openedAt,
  closedAt: shift.closedAt ?? null,
  openingAmount: toNumber(shift.openingAmount),
  expectedCash: shift.expectedCash == null ? null : toNumber(shift.expectedCash),
  countedCash: shift.countedCash == null ? null : toNumber(shift.countedCash),
  difference: shift.difference == null ? null : toNumber(shift.difference),
  status: shift.status,
  cashRegister: shift.cashRegister
    ? {
        id: shift.cashRegister.id,
        clubId: shift.cashRegister.clubId,
        name: shift.cashRegister.name,
        location: shift.cashRegister.location ?? null,
        createdAt: shift.cashRegister.createdAt
      }
    : undefined,
  openAccountsSummary: shift.openAccountsSummary
    ? {
        openAccounts: Number(shift.openAccountsSummary.openAccounts || 0),
        openAccountsWithPending: Number(shift.openAccountsSummary.openAccountsWithPending || 0),
        pendingAmount: toNumber(shift.openAccountsSummary.pendingAmount)
      }
    : undefined,
  closePolicy: shift.closePolicy
    ? {
        strict: Boolean(shift.closePolicy.strict)
      }
    : undefined,
  movements: Array.isArray(shift.movements) ? shift.movements.map(mapCashMovementDto) : undefined,
  payments: Array.isArray(shift.payments) ? shift.payments.map(mapPaymentDto) : undefined
});
