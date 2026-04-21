export function validateRefundAmountInput(amountInput: string, maxAmount: number): { amount?: number; error?: string } {
  const parsedAmount = Number(amountInput);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return { error: 'Monto invalido' };
  }

  const safeMax = Number.isFinite(maxAmount) ? Math.max(0, maxAmount) : 0;
  if (parsedAmount > safeMax + 0.009) {
    return { error: 'El monto no puede superar el pago original' };
  }

  return { amount: Number(parsedAmount.toFixed(2)) };
}
