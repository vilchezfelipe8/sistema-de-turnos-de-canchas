import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { RefundDraft, RefundReasonType } from '../../../modules/refunds/refund.types';
import { REFUND_REASON_OPTIONS } from '../../../modules/refunds/refund.constants';
import { formatPaymentCode } from '../../../utils/displayCode';

type RefundRequestModalProps = {
  show: boolean;
  title?: string;
  paymentId?: string;
  maxAmount: number;
  draft: RefundDraft;
  submitting?: boolean;
  closeLabel?: string;
  submitLabel?: string;
  zIndexClass?: string;
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
  zIndexClass = 'z-[2147483400]',
  onClose,
  onSubmit,
  onChangeDraft
}: RefundRequestModalProps) {
  if (!show) return null;
  if (typeof document === 'undefined') return null;

  const setDraft = (patch: Partial<RefundDraft>) => {
    onChangeDraft({ ...draft, ...patch });
  };

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} bg-black/60 flex items-center justify-center p-4`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#EBE1D8] border-4 border-white/70 rounded-[2rem] shadow-2xl p-5 text-[#347048] space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/50">Gestion de cobros</p>
            <h3 className="text-2xl font-black uppercase italic tracking-tight">{title}</h3>
            {paymentId ? (
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mt-1">
                Pago: {formatPaymentCode(paymentId)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            title="Cerrar"
            className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100 disabled:opacity-60 disabled:hover:scale-100"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/60 bg-white/40 p-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-1.5">Monto a devolver</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.amountInput}
              onChange={(e) => setDraft({ amountInput: e.target.value })}
              className="w-full h-12 bg-white border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-xl px-4 text-sm font-bold text-[#347048] outline-none transition-all shadow-sm"
            />
            <p className="text-[11px] text-[#347048]/60 mt-1">Maximo: ${Number(maxAmount || 0).toLocaleString()}</p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-1.5">Motivo</label>
            <select
              value={draft.reasonType}
              onChange={(e) => setDraft({ reasonType: e.target.value as RefundReasonType })}
              className="w-full h-12 bg-white border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-xl px-4 text-sm font-bold text-[#347048] outline-none transition-all shadow-sm"
            >
              {REFUND_REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-1.5">Nota operativa</label>
            <textarea
              value={draft.executionNotes}
              onChange={(e) => setDraft({ executionNotes: e.target.value })}
              rows={3}
              maxLength={500}
              className="w-full border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-xl px-4 py-3 bg-white resize-none text-sm font-semibold text-[#347048] outline-none transition-all"
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="h-12 rounded-xl border-2 border-[#347048]/20 bg-white text-[#347048] text-xs font-black uppercase tracking-widest shadow-sm hover:bg-[#347048]/5 transition-all disabled:opacity-60"
          >
            {closeLabel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="h-12 rounded-xl bg-[#347048] text-[#EBE1D8] text-xs font-black uppercase tracking-widest shadow-lg shadow-[#347048]/20 hover:bg-[#B9CF32] hover:text-[#347048] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Enviando...' : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
