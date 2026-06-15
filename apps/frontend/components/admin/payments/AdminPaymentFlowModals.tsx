import { X } from 'lucide-react';
import type { PointerEvent, ReactNode } from 'react';
import { ADMIN_Z_INDEX } from '../../../utils/adminZIndex';

type PaymentSummaryRow = {
  label: string;
  value: string;
};

type PaymentConceptRow = {
  id: string;
  label: string;
  value: string;
};

type BackdropHandlers = {
  onBackdropPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onBackdropPointerUp: (event: PointerEvent<HTMLElement>) => void;
};

type AdminPaymentPreconfirmModalProps = BackdropHandlers & {
  title?: string;
  subtitle?: string;
  summaryTitle?: string;
  methodLabel?: string;
  methodValue: string;
  summaryRows: PaymentSummaryRow[];
  conceptTitle?: string;
  conceptRows?: PaymentConceptRow[];
  showConcepts?: boolean;
  backLabel?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  onBack: () => void;
  onClose: () => void;
  onConfirm: () => void;
};

type AdminPaymentResultModalProps = BackdropHandlers & {
  title: string;
  detail: string;
  variant: 'success' | 'error' | 'partial';
  summaryRows: PaymentSummaryRow[];
  conceptTitle?: string;
  conceptRows?: PaymentConceptRow[];
  closeLabel?: string;
  retryLabel?: string;
  onClose: () => void;
  onRetry?: (() => void) | null;
};

type AdminPaymentFormModalProps = BackdropHandlers & {
  title: string;
  subtitle: string;
  onClose: () => void;
  bodyClassName?: string;
  children: ReactNode;
  footer?: ReactNode;
};

const headerColorByVariant: Record<AdminPaymentResultModalProps['variant'], string> = {
  success: 'text-p-positive',
  partial: 'text-p-warning',
  error: 'text-p-error',
};

export function AdminPaymentFormModal({
  title,
  subtitle,
  onClose,
  onBackdropPointerDown,
  onBackdropPointerUp,
  bodyClassName = 'space-y-3 overflow-hidden px-4 py-3',
  children,
  footer,
}: AdminPaymentFormModalProps) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 bg-[var(--overlay)]"
      style={{ zIndex: ADMIN_Z_INDEX.modal }}
      onPointerDown={onBackdropPointerDown}
      onPointerUp={onBackdropPointerUp}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-[700px] flex-col overflow-hidden rounded-2xl border border-p-border bg-p-surface shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
          <div className="flex items-center justify-between border-b border-p-border px-4 py-3">
            <div>
              <p className="text-[18px] font-semibold text-p-text">{title}</p>
              <p className="text-[12px] text-p-text-secondary">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-full text-p-text-muted grid place-items-center hover:bg-p-surface-2"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
          <div className={bodyClassName}>{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-p-border px-4 py-3">{footer}</div>
          ) : null}
        </div>
    </div>
  );
}

export function AdminPaymentPreconfirmModal({
  title = 'Confirmar cobro',
  subtitle = 'Revisa estos datos antes de confirmar.',
  summaryTitle = 'Resumen final',
  methodLabel = 'Metodo',
  methodValue,
  summaryRows,
  conceptTitle = 'Conceptos que cubre',
  conceptRows = [],
  showConcepts = true,
  backLabel = 'Editar cobro',
  confirmLabel = 'Confirmar cobro',
  confirmDisabled = false,
  onBack,
  onClose,
  onConfirm,
  onBackdropPointerDown,
  onBackdropPointerUp,
}: AdminPaymentPreconfirmModalProps) {
  return (
    <div
      className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center p-4"
      style={{ zIndex: ADMIN_Z_INDEX.modalStacked }}
      onPointerDown={onBackdropPointerDown}
      onPointerUp={onBackdropPointerUp}
    >
      <div
        className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
          <div>
            <h3 className="text-[22px] font-bold tracking-[-0.01em] text-p-text">{title}</h3>
            <p className="mt-1 text-[12px] text-p-text-muted">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="rounded-lg border border-p-border bg-p-surface">
            <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
              {summaryTitle}
            </div>
            <div className="divide-y divide-p-border text-[13px]">
              {summaryRows.map((row) => (
                <div key={`summary-row-${row.label}`} className="flex items-center justify-between px-3 py-2">
                  <span className="text-p-text-muted">{row.label}</span>
                  <strong className="text-p-text">{row.value}</strong>
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-p-text-muted">{methodLabel}</span>
                <strong className="text-p-text">{methodValue}</strong>
              </div>
            </div>
          </div>
          {showConcepts && (
            <div className="rounded-lg border border-p-border bg-p-surface">
              <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                {conceptTitle}
              </div>
              {conceptRows.length === 0 ? (
                <p className="px-3 py-3 text-[12px] text-p-text-muted">No hay conceptos seleccionados.</p>
              ) : (
                <div className="max-h-44 overflow-auto divide-y divide-p-border">
                  {conceptRows.map((row) => (
                    <div key={row.id} className="flex items-center justify-between px-3 py-2 text-[12px] text-p-text-secondary">
                      <span className="truncate pr-2">{row.label}</span>
                      <strong className="text-p-text">{row.value}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onBack}
              className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2"
            >
              {backLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="h-10 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900 disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminPaymentResultModal({
  title,
  detail,
  variant,
  summaryRows,
  conceptTitle = 'Conceptos aplicados',
  conceptRows = [],
  closeLabel = 'Entendido',
  retryLabel = 'Reintentar',
  onClose,
  onRetry,
  onBackdropPointerDown,
  onBackdropPointerUp,
}: AdminPaymentResultModalProps) {
  return (
    <div
      className="fixed inset-0 bg-[var(--overlay)] flex items-center justify-center p-4"
      style={{ zIndex: ADMIN_Z_INDEX.modalStacked }}
      onPointerDown={onBackdropPointerDown}
      onPointerUp={onBackdropPointerUp}
    >
      <div
        className="w-full max-w-[560px] rounded-2xl border border-p-border bg-p-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-p-border">
          <h3 className={`text-[22px] font-bold tracking-[-0.01em] ${headerColorByVariant[variant]}`}>
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full border border-p-border grid place-items-center text-p-text-muted hover:bg-p-surface-2"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-[14px] text-p-text-secondary">{detail}</p>
          <div className="grid grid-cols-2 gap-3">
            {summaryRows.map((row) => (
              <div
                key={`result-row-${row.label}`}
                className="rounded-lg bg-p-surface-2 px-3 py-2 text-xs text-p-text-secondary flex justify-between"
              >
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
          {conceptRows.length > 0 && (
            <div className="rounded-lg border border-p-border bg-p-surface">
              <div className="border-b border-p-border px-3 py-2 text-[12px] font-semibold text-p-text-secondary">
                {conceptTitle}
              </div>
              <div className="max-h-44 overflow-auto divide-y divide-p-border">
                {conceptRows.map((row) => (
                  <div key={row.id} className="flex items-center justify-between px-3 py-2 text-[12px] text-p-text-secondary">
                    <span className="truncate pr-2">{row.label}</span>
                    <strong className="text-p-text">{row.value}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-p-border bg-p-surface px-4 text-sm font-semibold text-p-text-secondary hover:bg-p-surface-2"
            >
              {closeLabel}
            </button>
            {onRetry && variant !== 'success' && (
              <button
                type="button"
                onClick={onRetry}
                className="h-10 rounded-xl bg-ink-900 px-5 text-ink-50 text-sm font-bold hover:bg-ink-900"
              >
                {retryLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
