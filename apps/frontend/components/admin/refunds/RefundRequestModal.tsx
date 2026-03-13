import React from 'react';
import type { RefundDraft, RefundReasonType } from '../../../modules/refunds/refund.types';
import { REFUND_REASON_OPTIONS } from '../../../modules/refunds/refund.constants';

type RefundRequestModalProps = {
  show: boolean;
  title?: string;
  paymentId?: string;
  maxAmount: number;
  draft: RefundDraft;
  submitting?: boolean;
  closeLabel?: string;
  submitLabel?: string;
  onClose: () => void;
  onSubmit: () => void;
  onChangeDraft: (next: RefundDraft) => void;
};

export default function RefundRequestModal({
  show,
  title = 'Gestion de devolucion',
  paymentId,
  maxAmount,
  draft,
  submitting = false,
  closeLabel = 'Cancelar',
  submitLabel = 'Confirmar devolucion',
  onClose,
  onSubmit,
  onChangeDraft
}: RefundRequestModalProps) {
  if (!show) return null;

  const setDraft = (patch: Partial<RefundDraft>) => {
    onChangeDraft({ ...draft, ...patch });
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#1f3f2b]/65 backdrop-blur-[2px] flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#EBE1D8] border-4 border-white/70 rounded-[1.5rem] shadow-2xl shadow-[#183022]/35 p-6 text-[#347048] space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black uppercase italic tracking-tight">{title}</h3>
            {paymentId ? (
              <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mt-1">Pago: {paymentId}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-9 px-3 rounded-lg border border-[#347048]/20 bg-white text-xs font-black uppercase tracking-wide"
          >
            Cerrar
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-[#347048]/10 bg-white/70 p-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Monto</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.amountInput}
              onChange={(e) => setDraft({ amountInput: e.target.value })}
              className="w-full h-10 border border-[#347048]/20 rounded-lg px-3 bg-white text-sm font-semibold"
            />
            <p className="text-[11px] text-[#347048]/60 mt-1">Maximo: ${Number(maxAmount || 0).toLocaleString()}</p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Tipo</label>
            <select
              value={draft.reasonType}
              onChange={(e) => setDraft({ reasonType: e.target.value as RefundReasonType })}
              className="w-full h-10 border border-[#347048]/20 rounded-lg px-3 bg-white text-sm font-semibold"
            >
              {REFUND_REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Nota operativa</label>
            <textarea
              value={draft.executionNotes}
              onChange={(e) => setDraft({ executionNotes: e.target.value })}
              rows={3}
              maxLength={500}
              className="w-full border border-[#347048]/20 rounded-lg px-3 py-2 bg-white resize-none text-sm"
              placeholder="Detalle interno"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-bold text-[#347048]">
            <input
              type="checkbox"
              checked={draft.executeNow}
              onChange={(e) => setDraft({ executeNow: e.target.checked })}
            />
            Ejecutar ahora
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-10 rounded-lg border border-[#347048]/20 bg-white text-xs font-black uppercase tracking-wide"
          >
            {closeLabel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="h-10 rounded-lg bg-[#347048] text-[#EBE1D8] text-xs font-black uppercase tracking-wide disabled:opacity-50"
          >
            {submitting ? 'Enviando...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
