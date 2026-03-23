import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, X } from 'lucide-react';

export interface PaymentCalculatorItem {
  id?: string | number;
  tempId?: string;
  productName: string;
  quantity: number;
  price: number;
}

export type PaymentCalculatorResult = {
  method: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER';
  channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
  amount: number;
  courtAmount: number;
  paidItemIds: number[];
  selectedItemKeys: Array<string | number>;
  itemAllocations: Array<{ key: string | number; amount: number }>;
};

type PaymentMethodOption = 'CASH' | 'CARD' | 'TRANSFER_BANK' | 'TRANSFER_WALLET';

export interface PaymentCalculatorProps {
  courtPending: number;
  courtBaseTotal?: number;
  courtBreakdown?: {
    baseAmount: number;
    lightsExtraAmount: number;
    totalAmount: number;
    lightsFromHour?: string | null;
  };
  cartItems: PaymentCalculatorItem[];
  alreadyPaid: number;
  grandTotal: number;
  onClose: () => void;
  onConfirm: (result: PaymentCalculatorResult) => Promise<void>;
  submitting?: boolean;
  zIndexClass?: string;
}

export default function PaymentCalculator({
  courtPending,
  courtBaseTotal,
  courtBreakdown,
  cartItems,
  alreadyPaid,
  grandTotal,
  onClose,
  onConfirm,
  submitting = false,
  zIndexClass = 'z-[2147483300]'
}: PaymentCalculatorProps) {
  const formatItemLabel = (item: PaymentCalculatorItem) => {
    const rawName = String(item.productName || '').trim();
    if (/^\d+\s*x\s+/i.test(rawName)) return rawName;
    const qty = Number(item.quantity || 0);
    return qty > 0 ? `${qty}x ${rawName}` : rawName;
  };

  const isApprox = (a: number, b: number) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.01;
  const backdropRef = useRef<boolean>(false);
  const initializedSelectionRef = useRef<boolean>(false);
  const [mounted, setMounted] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number | string>('');
  const [itemAllocations, setItemAllocations] = useState<Record<string, number>>({});
  const [courtPortion, setCourtPortion] = useState<number>(0);
  const [validationError, setValidationError] = useState('');
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<PaymentMethodOption | ''>('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastRegisteredPayment, setLastRegisteredPayment] = useState<{
    amount: number;
    methodLabel: string;
    concepts: string[];
  } | null>(null);

  const safeCourtPending = Math.max(0, Number(courtPending || 0));
  const safeCourtBaseTotal = Math.max(0, Number(courtBaseTotal ?? courtPending ?? 0));
  const hasCourtBreakdown =
    Boolean(courtBreakdown) &&
    Number.isFinite(Number(courtBreakdown?.totalAmount || 0)) &&
    Number(courtBreakdown?.totalAmount || 0) > 0;
  const breakdownBase = hasCourtBreakdown ? Number(courtBreakdown?.baseAmount || 0) : 0;
  const breakdownLights = hasCourtBreakdown ? Number(courtBreakdown?.lightsExtraAmount || 0) : 0;
  const breakdownTotal = hasCourtBreakdown ? Number(courtBreakdown?.totalAmount || 0) : 0;
  const breakdownFromHour = hasCourtBreakdown && courtBreakdown?.lightsFromHour ? String(courtBreakdown.lightsFromHour) : null;
  const quarterBase = safeCourtBaseTotal / 4;
  const halfBase = safeCourtBaseTotal / 2;
  const canSelectQuarter = quarterBase <= safeCourtPending + 0.01;
  const canSelectHalf = halfBase <= safeCourtPending + 0.01;
  const finalPending = Math.max(0, Number(grandTotal || 0) - Number(alreadyPaid || 0));

  const selectedProductsTotal = useMemo(() => {
    return cartItems.reduce((sum, item) => {
      const itemKey = String(item.tempId || item.id || '');
      const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
      const allocated = Number(itemAllocations[itemKey] || 0);
      return sum + Math.max(0, Math.min(itemTotal, allocated));
    }, 0);
  }, [cartItems, itemAllocations]);

  const selectedTotal = (Number(courtPortion) || 0) + selectedProductsTotal;
  const amountEntered = Number(paymentAmount) || 0;
  const amountDiff = Math.abs(amountEntered - selectedTotal);
  const hasSelection = selectedTotal > 0;
  const hasAmountMismatch = hasSelection && amountDiff > 0.01;

  const conceptBreakdown = useMemo(() => {
    const rows: Array<{
      key: string;
      label: string;
      total: number;
      paidNow: number;
      debtAfter: number;
      isSelected: boolean;
    }> = [];

    if (safeCourtPending > 0) {
      const selectedCourt = Math.max(0, Number(courtPortion) || 0);
      const paidNow = Math.min(selectedCourt, safeCourtPending);
      rows.push({
        key: 'court',
        label: 'Cancha',
        total: safeCourtPending,
        paidNow,
        debtAfter: Math.max(0, safeCourtPending - paidNow),
        isSelected: paidNow > 0
      });
    }

    for (const item of cartItems) {
      const itemKey = item.tempId || item.id || `${item.productName}-${item.quantity}`;
      const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
      const allocated = Number(itemAllocations[String(itemKey)] || 0);
      const paidNow = Math.max(0, Math.min(itemTotal, allocated));
      rows.push({
        key: String(itemKey),
        label: formatItemLabel(item),
        total: itemTotal,
        paidNow,
        debtAfter: Math.max(0, itemTotal - paidNow),
        isSelected: paidNow > 0
      });
    }

    return rows;
  }, [cartItems, courtPortion, safeCourtPending, itemAllocations]);

  const summaryPaidNow = conceptBreakdown.reduce((sum, row) => sum + row.paidNow, 0);
  const summaryDebtAfter = conceptBreakdown.reduce((sum, row) => sum + row.debtAfter, 0);
  const unassignedAmount = Math.max(0, amountEntered - selectedTotal);
  const selectedConceptLabels = conceptBreakdown
    .filter((row) => row.paidNow > 0.009)
    .map((row) => row.label);
  const selectedConceptsSummary =
    selectedConceptLabels.length > 0 ? selectedConceptLabels.join(', ') : 'Sin conceptos seleccionados';

  const selectedMethodLabel = useMemo(() => {
    if (selectedPaymentOption === 'CASH') return 'Efectivo';
    if (selectedPaymentOption === 'CARD') return 'Tarjeta';
    if (selectedPaymentOption === 'TRANSFER_BANK') return 'Transferencia bancaria';
    if (selectedPaymentOption === 'TRANSFER_WALLET') return 'QR / Billetera virtual';
    return 'Sin seleccionar';
  }, [selectedPaymentOption]);

  const canConfirmPayment =
    !submitting &&
    amountEntered > 0 &&
    hasSelection &&
    !hasAmountMismatch &&
    Boolean(selectedPaymentOption);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (initializedSelectionRef.current) return;

    const productAllocations: Record<string, number> = {};
    let productsTotal = 0;
    for (const item of cartItems) {
      const itemKey = String(item.tempId || item.id || '');
      const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
      productAllocations[itemKey] = itemTotal;
      productsTotal += itemTotal;
    }
    const defaultTotal = safeCourtPending + productsTotal;

    setCourtPortion(safeCourtPending);
    setItemAllocations(productAllocations);
    setPaymentAmount(defaultTotal > 0 ? defaultTotal.toString() : '');

    initializedSelectionRef.current = true;
  }, [cartItems, safeCourtPending]);

  useEffect(() => {
    if (selectedTotal > 0) {
      setPaymentAmount(selectedTotal.toString());
    } else {
      setPaymentAmount('');
    }
    setValidationError('');
  }, [selectedTotal]);

  useEffect(() => {
    setPaymentAmount('');
    setItemAllocations({});
    setCourtPortion(0);
  }, [finalPending]);

  const handleSelectAll = () => {
    const nextAllocations: Record<string, number> = {};
    let productsTotal = 0;
    for (const item of cartItems) {
      const key = String(item.tempId || item.id || '');
      const total = Number(item.price || 0) * Number(item.quantity || 0);
      nextAllocations[key] = total;
      productsTotal += total;
    }
    setCourtPortion(safeCourtPending);
    setItemAllocations(nextAllocations);
    setPaymentAmount((safeCourtPending + productsTotal).toString());
  };

  const handleClearSelection = () => {
    setCourtPortion(0);
    setItemAllocations({});
    setPaymentAmount('');
  };

  const buildPaymentPayload = (): PaymentCalculatorResult | null => {
    if (submitting) return null;
    if (!amountEntered || amountEntered <= 0) {
      setValidationError('Ingresá un monto válido para registrar el pago.');
      return null;
    }
    if (!hasSelection) {
      setValidationError('Seleccioná al menos un concepto para cobrar.');
      return null;
    }
    if (hasAmountMismatch) {
      setValidationError('El monto debe coincidir exactamente con lo seleccionado.');
      return null;
    }
    if (!selectedPaymentOption) {
      setValidationError('Seleccioná el medio de pago antes de confirmar.');
      return null;
    }

    const selectedAllocations = cartItems
      .map((item) => {
        const key = item.tempId || item.id || '';
        const total = Number(item.price || 0) * Number(item.quantity || 0);
        const rawAllocated = Number(itemAllocations[String(key)] || 0);
        const amount = Math.max(0, Math.min(total, rawAllocated));
        return { key, amount };
      })
      .filter((entry) => Number(entry.amount) > 0.009);

    const selectedKeys = selectedAllocations.map((entry) => entry.key);
    const numericItemIds = Array.from(
      new Set(
        selectedKeys
          .map((key) => (typeof key === 'number' ? key : null))
          .filter((value): value is number => value !== null)
      )
    );

    const method: PaymentCalculatorResult['method'] =
      selectedPaymentOption === 'TRANSFER_BANK' || selectedPaymentOption === 'TRANSFER_WALLET'
        ? 'TRANSFER'
        : selectedPaymentOption;

    const channel: PaymentCalculatorResult['channel'] | undefined =
      selectedPaymentOption === 'TRANSFER_BANK'
        ? 'BANK_ACCOUNT'
        : selectedPaymentOption === 'TRANSFER_WALLET'
          ? 'VIRTUAL_WALLET'
          : undefined;

    setValidationError('');

    return {
      method,
      channel,
      amount: amountEntered,
      courtAmount: Number(courtPortion) || 0,
      paidItemIds: numericItemIds,
      selectedItemKeys: selectedKeys,
      itemAllocations: selectedAllocations
    };
  };

  const handleOpenConfirmModal = () => {
    const payload = buildPaymentPayload();
    if (!payload) return;
    setShowConfirmModal(true);
  };

  const handleSubmitPayment = async () => {
    const payload = buildPaymentPayload();
    if (!payload) return;

    await onConfirm(payload);
    setShowConfirmModal(false);
    setLastRegisteredPayment({
      amount: Number(payload.amount || 0),
      methodLabel: selectedMethodLabel,
      concepts: selectedConceptLabels
    });
    setShowSuccessModal(true);
  };

  const modal = (
    <div
      className={`fixed inset-0 bg-[#347048]/60 flex items-center justify-center ${zIndexClass} p-4 animate-in fade-in duration-200`}
      onMouseDown={(event) => {
        backdropRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        const startedOnBackdrop = backdropRef.current;
        backdropRef.current = false;
        if (!submitting && startedOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="bg-[#EBE1D8] border-4 border-white rounded-[2rem] shadow-2xl shadow-[#347048]/30 w-full max-w-2xl lg:max-w-3xl max-h-[88vh] overflow-hidden relative flex flex-col text-[#347048]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
          <div className="sticky top-0 z-20 bg-[#EBE1D8] border-b border-[#347048]/10 px-6 sm:px-7 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-black mb-1 uppercase tracking-tight italic text-[#347048]">Registrar pago</h3>
                <p className="text-[#347048]/60 text-[10px] font-black uppercase tracking-[0.2em]">
                  Saldo pendiente: <span className="text-[#347048] font-black text-sm">${finalPending.toLocaleString()}</span>
                </p>
              </div>
              <button
                onClick={onClose}
                disabled={submitting}
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100 shrink-0"
                title="Cerrar ventana"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>
          </div>

        <div className="px-6 sm:px-7 py-6 sm:py-7">

        <div className="bg-white border-2 border-[#B9CF32]/20 rounded-[1.25rem] p-4 mb-5 shadow-sm">
          <div className="flex justify-between items-center mb-3 border-b border-[#347048]/10 pb-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#347048]/70">Qué vas a cobrar</p>
            <div className="flex gap-2">
              <button type="button" onClick={handleSelectAll} disabled={submitting} className="text-[9px] font-black uppercase tracking-widest text-[#347048] bg-[#B9CF32]/30 border border-[#B9CF32]/40 px-2.5 py-1 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">
                Todo
              </button>
              <button type="button" onClick={handleClearSelection} disabled={submitting} className="text-[9px] font-black uppercase tracking-widest text-red-500 bg-red-50 border border-red-100 px-2.5 py-1 rounded-md disabled:opacity-50 disabled:cursor-not-allowed">
                Nada
              </button>
            </div>
          </div>

          <div className="space-y-3 max-h-44 overflow-y-auto custom-scrollbar">
            {safeCourtPending > 0 && (
              <div className="p-3 bg-[#347048]/5 rounded-xl border border-[#347048]/10">
                <div className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2">Alquiler de cancha</div>
                {hasCourtBreakdown ? (
                  <div className="mb-3 rounded-lg border border-[#347048]/10 bg-white/70 px-2 py-2 text-[10px] font-black uppercase tracking-widest">
                    <div className="flex items-center justify-between text-[#347048]/70">
                      <span>Cancha base</span>
                      <span>${breakdownBase.toLocaleString()}</span>
                    </div>
                    <div className={`mt-1 flex items-center justify-between ${breakdownLights > 0.009 ? 'text-amber-700' : 'text-[#347048]/55'}`}>
                      <span>Recargo luces</span>
                      <span>
                        {breakdownLights > 0.009 ? `+$${breakdownLights.toLocaleString()}` : '$0'}
                        {breakdownFromHour ? ` (desde ${breakdownFromHour})` : ''}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[#347048]">
                      <span>Total cancha</span>
                      <span>${breakdownTotal.toLocaleString()}</span>
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setCourtPortion(quarterBase)}
                    disabled={!canSelectQuarter || submitting}
                    className={`flex justify-center items-center p-2 rounded-lg border transition-all ${
                    !canSelectQuarter
                      ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                      : isApprox(courtPortion, quarterBase)
                        ? 'bg-[#B9CF32]/25 border-[#B9CF32] text-[#347048] cursor-pointer'
                        : 'bg-white border-[#347048]/15 text-[#347048]/60 hover:border-[#B9CF32]/50 cursor-pointer'
                  }`}>
                    <span className="text-xs font-bold">1/4 (${quarterBase.toLocaleString()})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCourtPortion(halfBase)}
                    disabled={!canSelectHalf || submitting}
                    className={`flex justify-center items-center p-2 rounded-lg border transition-all ${
                    !canSelectHalf
                      ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                      : isApprox(courtPortion, halfBase)
                        ? 'bg-[#B9CF32]/25 border-[#B9CF32] text-[#347048] cursor-pointer'
                        : 'bg-white border-[#347048]/15 text-[#347048]/60 hover:border-[#B9CF32]/50 cursor-pointer'
                  }`}>
                    <span className="text-xs font-bold">1/2 (${halfBase.toLocaleString()})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCourtPortion(safeCourtPending)}
                    disabled={submitting}
                    className={`flex justify-center items-center p-2 rounded-lg border transition-all ${
                      isApprox(courtPortion, safeCourtPending)
                        ? 'bg-[#B9CF32]/25 border-[#B9CF32] text-[#347048]'
                        : 'bg-white border-[#347048]/15 text-[#347048]/60 hover:border-[#B9CF32]/50'
                    }`}
                  >
                    <span className="text-xs font-bold">Saldo (${safeCourtPending.toLocaleString()})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCourtPortion(0)}
                    disabled={submitting}
                    className={`flex justify-center items-center p-2 rounded-lg border transition-all ${
                      isApprox(courtPortion, 0)
                        ? 'bg-[#B9CF32]/25 border-[#B9CF32] text-[#347048]'
                        : 'bg-white border-[#347048]/15 text-[#347048]/60 hover:border-[#B9CF32]/50'
                    }`}
                  >
                    <span className="text-xs font-bold">Nada</span>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Monto libre</span>
                  <input
                    type="number"
                    min={0}
                    max={safeCourtPending}
                    step="0.01"
                    value={courtPortion > 0 ? courtPortion : ''}
                    disabled={submitting}
                    onChange={(event) => {
                      const parsed = Number(event.target.value || 0);
                      const clamped = Number.isFinite(parsed)
                        ? Math.max(0, Math.min(safeCourtPending, parsed))
                        : 0;
                      setCourtPortion(clamped);
                    }}
                    className="w-28 bg-white border border-[#347048]/20 rounded-md px-2 py-1 text-xs font-black text-right"
                    placeholder="0"
                  />
                  <span className="text-[10px] font-black text-[#347048]/60">de ${safeCourtPending.toLocaleString()}</span>
                </div>
              </div>
            )}

            {cartItems.length > 0 && (
              <div className="p-3 bg-[#347048]/5 rounded-xl border border-[#347048]/10">
                <div className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2">Consumos extras</div>
                <div className="space-y-2">
                  {cartItems.map((item) => {
                    const itemKey = item.tempId || item.id || `${item.productName}-${item.quantity}`;
                    const allocatedAmount = Number(itemAllocations[String(itemKey)] || 0);
                    const isSelected = allocatedAmount > 0.009;
                    const itemTotal = Number(item.price || 0) * Number(item.quantity || 0);
                    return (
                      <label key={itemKey} className={`flex justify-between items-center p-2 rounded-lg border cursor-pointer transition-all ${isSelected ? 'bg-[#926699]/10 border-[#926699]/30 text-[#926699]' : 'bg-white border-[#347048]/15 text-[#347048]/60 hover:border-[#926699]/30'}`}>
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded text-[#926699] focus:ring-[#926699] border-gray-300"
                            checked={isSelected}
                            disabled={submitting}
                            onChange={(event) => {
                              setItemAllocations((prev) => ({
                                ...prev,
                                [String(itemKey)]: event.target.checked ? itemTotal : 0
                              }));
                            }}
                          />
                          <span className="text-sm font-bold leading-tight">
                            {formatItemLabel(item)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            max={itemTotal}
                            step="0.01"
                            value={allocatedAmount > 0 ? allocatedAmount : ''}
                            disabled={submitting}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => {
                              const parsed = Number(event.target.value || 0);
                              const clamped = Number.isFinite(parsed)
                                ? Math.max(0, Math.min(itemTotal, parsed))
                                : 0;
                              setItemAllocations((prev) => ({
                                ...prev,
                                [String(itemKey)]: clamped
                              }));
                            }}
                            className="w-24 bg-white border border-[#926699]/30 rounded-md px-2 py-1 text-xs font-black text-right"
                            placeholder="0"
                          />
                          <span className="text-[11px] font-black min-w-[72px] text-right">${itemTotal.toLocaleString()}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mb-5">
          <label className="text-[10px] font-black uppercase tracking-widest text-[#926699] ml-2 block mb-2">¿Cuánto ingresa ahora?</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-[#347048]/40">$</span>
            <input
              type="number"
              value={paymentAmount}
              disabled={submitting}
              onChange={(event) => setPaymentAmount(event.target.value)}
              onWheel={(event) => {
                event.currentTarget.blur();
              }}
              className="w-full bg-white border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-2xl py-3.5 pl-10 pr-4 text-3xl font-black text-[#347048] outline-none transition-all shadow-sm italic"
              placeholder="0"
              autoFocus
            />
          </div>
          <div className="flex justify-between mt-2 text-[10px] font-black uppercase tracking-widest">
            <span className="text-[#347048]/50">Seleccionado: ${selectedTotal.toLocaleString()}</span>
            <button
              type="button"
              onClick={() => {
                setPaymentAmount(finalPending);
                handleSelectAll();
              }}
              disabled={submitting}
              className="text-[#347048]/40 hover:text-[#926699] transition-colors"
            >
              Completar total
            </button>
          </div>
          {validationError && (
            <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              {validationError}
            </p>
          )}
        </div>

        <div className="mb-5 bg-white border-2 border-[#347048]/10 rounded-[1.25rem] p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Cierre estimado</p>
          </div>
          <div className="grid grid-cols-12 gap-2 items-center mb-2 text-[10px] font-black uppercase tracking-widest">
            <span className="col-span-5 text-transparent select-none">.</span>
            <span className="col-span-3 text-right text-emerald-600">Pagado</span>
            <span className="col-span-4 text-right text-[#926699]">Deuda</span>
          </div>
          <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
            {conceptBreakdown.map((row) => (
              <div key={row.key} className={`grid grid-cols-12 gap-2 items-center text-[11px] ${row.isSelected ? 'text-[#347048]' : 'text-[#347048]/60'}`}>
                <span className="col-span-5 font-black truncate">{row.label}</span>
                <span className="col-span-3 text-right font-black text-emerald-600">${row.paidNow.toLocaleString()}</span>
                <span className="col-span-4 text-right font-black text-[#926699]">${row.debtAfter.toLocaleString()}</span>
              </div>
            ))}
            {unassignedAmount > 0.01 && (
              <div className="grid grid-cols-12 gap-2 items-center text-[11px] text-amber-700">
                <span className="col-span-5 font-black truncate">Pago sin asignar</span>
                <span className="col-span-7 text-right font-black">${unassignedAmount.toLocaleString()}</span>
              </div>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-[#347048]/10 grid grid-cols-12 gap-2 text-[11px] font-black">
            <span className="col-span-5 text-[#347048]/70 uppercase tracking-widest">Totales</span>
            <span className="col-span-3 text-right text-emerald-600">${summaryPaidNow.toLocaleString()}</span>
            <span className="col-span-4 text-right text-[#926699]">${summaryDebtAfter.toLocaleString()}</span>
          </div>
        </div>

        <div className="mb-2 space-y-4">
          <div className="bg-white border-2 border-[#347048]/10 rounded-[1.25rem] p-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 block mb-2">
              Medio de pago
            </label>
            <select
              value={selectedPaymentOption}
              disabled={submitting}
              onChange={(event) => {
                setSelectedPaymentOption(event.target.value as PaymentMethodOption);
                setValidationError('');
              }}
              className="w-full rounded-xl border-2 border-[#347048]/15 bg-[#EBE1D8] px-3 py-3 text-sm font-black text-[#347048] outline-none focus:border-[#B9CF32]"
            >
              <option value="">Seleccionar medio de pago</option>
              <option value="CASH">Efectivo</option>
              <option value="TRANSFER_BANK">Transferencia bancaria</option>
              <option value="TRANSFER_WALLET">QR / Billetera virtual</option>
              <option value="CARD">Tarjeta</option>
            </select>
          </div>

          <div className="bg-[#347048]/5 border border-[#347048]/15 rounded-[1.25rem] p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#347048]/70 mb-2">
              Confirmación previa
            </p>
            <div className="space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="font-black text-[#347048]/70">Monto a registrar</span>
                <span className="font-black text-[#347048]">${amountEntered.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-black text-[#347048]/70">Medio elegido</span>
                <span className="font-black text-[#347048]">{selectedMethodLabel}</span>
              </div>
              <div className="pt-1">
                <span className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Conceptos</span>
                <p className="text-[12px] font-bold text-[#347048]">{selectedConceptsSummary}</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenConfirmModal}
            disabled={!canConfirmPayment}
            className="w-full py-4 rounded-2xl bg-[#347048] text-[#EBE1D8] font-black uppercase tracking-widest text-xs transition-all hover:bg-[#2d5f3d] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirmar pago
          </button>
        </div>
        </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="w-full mt-3 mb-6 px-6 sm:px-7 text-[#347048]/40 hover:text-[#347048] text-[10px] font-black uppercase tracking-widest hover:underline transition-all"
        >
          Cancelar operación
        </button>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 z-[2147483500] bg-[#347048]/60 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md max-h-[92vh] bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[#347048]/10 flex justify-between items-center bg-[#EBE1D8]">
              <h4 className="text-2xl font-black uppercase italic tracking-tighter text-[#347048]">
                Confirmar pago
              </h4>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={submitting}
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100 disabled:opacity-50"
                title="Cerrar ventana"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>
            <div className="p-6 sm:p-8 bg-white/40 flex-1 min-h-0 flex flex-col gap-5 overflow-y-auto text-[#347048]">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#347048]/70">¿Registramos este pago?</p>
              <div className="space-y-2 text-sm font-bold">
                <div className="flex items-center justify-between">
                  <span className="text-[#347048]/70">Monto</span>
                  <span>${amountEntered.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#347048]/70">Medio</span>
                  <span>{selectedMethodLabel}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-widest font-black text-[#347048]/60 mb-1">Conceptos</span>
                  <p className="text-[12px] font-bold">{selectedConceptsSummary}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowConfirmModal(false)}
                  className="h-11 rounded-xl border-2 border-[#347048]/20 text-[#347048]/80 hover:text-[#347048] hover:bg-white font-black uppercase text-[10px] tracking-widest transition-all"
                >
                  Volver
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmitPayment}
                  className="h-11 rounded-xl bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] font-black uppercase text-[10px] tracking-widest transition-all disabled:opacity-60"
                >
                  {submitting ? 'Registrando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSuccessModal && lastRegisteredPayment && (
        <div className="fixed inset-0 z-[2147483500] bg-[#347048]/60 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md max-h-[92vh] bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-[#347048]/10 flex justify-between items-center bg-[#EBE1D8]">
              <h4 className="text-2xl font-black uppercase italic tracking-tighter text-[#347048] flex items-center gap-3">
                <CheckCircle2 size={26} strokeWidth={2.8} className="text-[#B9CF32]" />
                Pago registrado
              </h4>
              <button
                type="button"
                onClick={() => {
                  setShowSuccessModal(false);
                  onClose();
                }}
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                title="Cerrar ventana"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>
            <div className="p-6 sm:p-8 bg-white/40 flex-1 min-h-0 flex flex-col gap-5 overflow-y-auto text-[#347048]">
              <div className="space-y-2 text-sm font-bold">
                <div className="flex items-center justify-between">
                  <span className="text-[#347048]/70">Monto</span>
                  <span>${Number(lastRegisteredPayment.amount || 0).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#347048]/70">Medio</span>
                  <span>{lastRegisteredPayment.methodLabel}</span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase tracking-widest font-black text-[#347048]/60 mb-1">Conceptos registrados</span>
                  <p className="text-[12px] font-bold">{lastRegisteredPayment.concepts.join(', ') || 'Sin detalle'}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowSuccessModal(false);
                    onClose();
                  }}
                  className="h-11 rounded-xl bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] font-black uppercase text-[10px] tracking-widest transition-all"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
