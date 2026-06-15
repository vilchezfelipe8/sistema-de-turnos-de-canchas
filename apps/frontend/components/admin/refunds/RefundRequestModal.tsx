import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { RefundDraft, RefundReasonType } from '../../../modules/refunds/refund.types';
import { REFUND_REASON_OPTIONS } from '../../../modules/refunds/refund.constants';
import { formatPaymentCode } from '../../../utils/displayCode';
import { ADMIN_Z_INDEX_CLASS } from '../../../utils/adminZIndex';

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
  title = 'Gestión de devolución',
  paymentId,
  maxAmount,
  draft,
  submitting = false,
  closeLabel = 'Cancelar',
  submitLabel = 'Confirmar devolucion',
  zIndexClass = ADMIN_Z_INDEX_CLASS.modalCritical,
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
        className="w-full max-w-xl bg-ink-50 border-4 border-white/70 rounded-[2rem] shadow-2xl p-5 text-ink-900 space-y-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-900/50">Gestión de cobros</p>
            <h3 className="text-2xl font-black uppercase italic tracking-tight">{title}</h3>
            {paymentId ? (
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-900/60 mt-1">
                Pago: {formatPaymentCode(paymentId)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            title="Cerrar"
            className="bg-p-error-bg p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-p-error hover:text-ink-50 hover:bg-p-error border border-p-error disabled:opacity-60 disabled:hover:scale-100"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/60 bg-p-surface/40 p-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-ink-900/60 mb-1.5">Monto a devolver</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={draft.amountInput}
              onChange={(e) => setDraft({ amountInput: e.target.value })}
              className="w-full h-12 bg-p-surface border-2 border-lima-900/10 focus:border-lima-300 rounded-xl px-4 text-sm font-bold text-ink-900 outline-none transition-all shadow-sm"
            />
            <p className="text-[11px] text-ink-900/60 mt-1">Maximo: ${Number(maxAmount || 0).toLocaleString()}</p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-ink-900/60 mb-1.5">Motivo</label>
            <select
              value={draft.reasonType}
              onChange={(e) => setDraft({ reasonType: e.target.value as RefundReasonType })}
              className="w-full h-12 bg-p-surface border-2 border-lima-900/10 focus:border-lima-300 rounded-xl px-4 text-sm font-bold text-ink-900 outline-none transition-all shadow-sm"
            >
              {REFUND_REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase tracking-[0.2em] text-ink-900/60 mb-1.5">Nota operativa</label>
            <textarea
              value={draft.executionNotes}
              onChange={(e) => setDraft({ executionNotes: e.target.value })}
              rows={3}
              maxLength={500}
              className="w-full border-2 border-lima-900/10 focus:border-lima-300 rounded-xl px-4 py-3 bg-p-surface resize-none text-sm font-semibold text-ink-900 outline-none transition-all"
              placeholder="Detalle interno"
            />
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-bold text-ink-900">
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
            className="h-12 rounded-xl border-2 border-lima-900/20 bg-p-surface text-ink-900 text-xs font-black uppercase tracking-widest shadow-sm hover:bg-lima-700/5 transition-all disabled:opacity-60"
          >
            {closeLabel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="h-12 rounded-xl bg-lima-700 text-ink-50 text-xs font-black uppercase tracking-widest shadow-lg shadow-lima-900/20 hover:bg-lima-300 hover:text-ink-900 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Enviando...' : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
