import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { RefundRecord, RefundStatus } from '../../modules/refunds/refund.types';
import { searchRefunds, refundActions } from '../../modules/refunds/refund.facade';
import { formatRefundExecutionMethod, formatRefundStatus } from '../../modules/refunds/refund.constants';
import RefundList from './refunds/RefundList';
import RefundLifecycleActions from './refunds/RefundLifecycleActions';
import { formatAccountCode, formatPaymentCode, formatRefundCode } from '../../utils/displayCode';
import { AdminPageHeader, AdminPanel } from './ui';
import AdminAppModal from './ui/AdminAppModal';
import { AdminFeedbackBanner } from './ui/AdminFeedback';
import { extractErrorMessage } from '../../utils/uiError';
import { showAdminToast } from '../../utils/adminToast';
import { ADMIN_Z_INDEX } from '../../utils/adminZIndex';

const STATUS_OPTIONS: Array<{ value: 'ALL' | RefundStatus; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'REQUESTED', label: 'Solicitada' },
  { value: 'APPROVED', label: 'Aprobada' },
  { value: 'READY_TO_EXECUTE', label: 'Lista para ejecutar' },
  { value: 'EXECUTED', label: 'Ejecutada' },
  { value: 'FAILED', label: 'Fallida' },
  { value: 'CANCELLED', label: 'Cancelada' }
];

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString()}`;

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-p-border bg-p-surface px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-p-text-muted">{label}</p>
      <p className={`mt-1 text-sm font-bold text-p-text ${mono ? 'font-mono text-[12px] break-all' : ''}`}>{value || '-'}</p>
    </div>
  );
}

function DetailBlock({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-p-border bg-p-surface px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-p-text-muted">{label}</p>
      <p className={`mt-1 text-sm font-semibold whitespace-pre-wrap break-words text-p-text ${mono ? 'font-mono text-[12px]' : ''}`}>
        {value && value.trim() ? value : '-'}
      </p>
    </div>
  );
}

type RefundActionConfig = {
  refundId: string;
  title: string;
  description: string;
  confirmText: string;
  successMessage: string;
  isWarning?: boolean;
  execute: () => Promise<unknown>;
};

export default function AdminTabRefunds() {
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [selectedRefundId, setSelectedRefundId] = useState<string | null>(null);

  // Confirmación modal
  const [pendingAction, setPendingAction] = useState<RefundActionConfig | null>(null);
  const [actionConfirming, setActionConfirming] = useState(false);
  const [actionConfirmError, setActionConfirmError] = useState('');

  const [statusFilter, setStatusFilter] = useState<'ALL' | RefundStatus>('ALL');
  const [paymentIdFilter, setPaymentIdFilter] = useState('');
  const [accountIdFilter, setAccountIdFilter] = useState('');

  const detailBackdropMouseDownRef = useRef(false);

  const hasActiveFilters = useMemo(
    () => statusFilter !== 'ALL' || Boolean(paymentIdFilter.trim()) || Boolean(accountIdFilter.trim()),
    [statusFilter, paymentIdFilter, accountIdFilter]
  );

  const selectedRefund = useMemo(
    () => refunds.find((refund) => refund.id === selectedRefundId) || null,
    [refunds, selectedRefundId]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await searchRefunds({
        take: 200,
        status: statusFilter === 'ALL' ? undefined : [statusFilter],
        paymentId: paymentIdFilter.trim() || undefined,
        accountId: accountIdFilter.trim() || undefined
      });
      setRefunds(data);
    } catch (err) {
      setError(extractErrorMessage(err, 'No se pudieron cargar las devoluciones. Recargá la página.'));
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, paymentIdFilter, accountIdFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedRefundId) return;
    const stillExists = refunds.some((refund) => refund.id === selectedRefundId);
    if (!stillExists) setSelectedRefundId(null);
  }, [refunds, selectedRefundId]);

  // Ejecuta la acción pendiente confirmada por el modal
  const handleConfirmAction = useCallback(async () => {
    if (!pendingAction || actionConfirming) return;
    setActionConfirming(true);
    setActionConfirmError('');
    setActionBusyId(pendingAction.refundId);
    try {
      await pendingAction.execute();
      const msg = pendingAction.successMessage;
      setPendingAction(null);
      await load();
      showAdminToast(msg);
    } catch (err) {
      setActionConfirmError(extractErrorMessage(err, 'No se pudo procesar la devolución. Intentá nuevamente.'));
    } finally {
      setActionConfirming(false);
      setActionBusyId(null);
    }
  }, [pendingAction, actionConfirming, load]);

  const closePendingAction = useCallback(() => {
    if (actionConfirming) return;
    setPendingAction(null);
    setActionConfirmError('');
  }, [actionConfirming]);

  // Builders de cada acción — usan el modal del sistema.
  const onApprove = useCallback((refund: RefundRecord, executeNow: boolean) => {
    setPendingAction({
      refundId: refund.id,
      title: '¿Aprobar esta devolución?',
      description: executeNow
        ? 'Vas a aprobar y ejecutar la devolución en un solo paso.'
        : 'Vas a marcar esta solicitud como aprobada para continuar con el proceso.',
      confirmText: executeNow ? 'Aprobar y ejecutar' : 'Aprobar devolución',
      successMessage: 'Devolución aprobada.',
      execute: () => refundActions.approve(refund.id, executeNow),
    });
  }, []);

  const onExecute = useCallback((refund: RefundRecord) => {
    setPendingAction({
      refundId: refund.id,
      title: '¿Registrar la devolución como ejecutada?',
      description: 'Confirmá solo si el dinero ya fue devuelto o el ajuste fue realizado.',
      confirmText: 'Registrar como ejecutada',
      successMessage: 'Devolución registrada como ejecutada.',
      execute: () => refundActions.execute(refund.id),
    });
  }, []);

  const onRetry = useCallback((refund: RefundRecord, executeNow: boolean) => {
    setPendingAction({
      refundId: refund.id,
      title: '¿Reintentar esta devolución?',
      description: 'El sistema volverá a intentar procesar la operación.',
      confirmText: 'Reintentar devolución',
      successMessage: 'Devolución reintentada.',
      execute: () => refundActions.retry(refund.id, executeNow),
    });
  }, []);

  const onFail = useCallback((refund: RefundRecord) => {
    setPendingAction({
      refundId: refund.id,
      title: '¿Marcar esta devolución como fallida?',
      description: 'Esta acción dejará registrada la devolución como no completada.',
      confirmText: 'Marcar como fallida',
      successMessage: 'Devolución marcada como fallida.',
      isWarning: true,
      execute: () => refundActions.fail(refund.id),
    });
  }, []);

  const onCancel = useCallback((refund: RefundRecord) => {
    setPendingAction({
      refundId: refund.id,
      title: '¿Cancelar esta devolución?',
      description: 'La solicitud quedará cancelada y no se procesará.',
      confirmText: 'Cancelar devolución',
      successMessage: 'Devolución cancelada.',
      isWarning: true,
      execute: () => refundActions.cancel(refund.id),
    });
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1380px] flex-col gap-4">
      <AdminPageHeader
        eyebrow="Caja"
        title="Devoluciones"
        description="Solicitudes de cuentas y reservas en un flujo auditable."
        actions={
          <button
            type="button"
            onClick={load}
            className="h-10 rounded-lg border border-p-border bg-p-surface px-4 text-xs font-bold uppercase tracking-[0.14em] text-p-text-secondary transition hover:bg-p-surface-2"
          >
            Recargar
          </button>
        }
      />

      <AdminPanel>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | RefundStatus)}
            className="h-10 rounded-lg border border-p-border bg-p-surface px-3 text-sm font-semibold text-p-text outline-none focus:border-p-accent focus:ring-3 focus:ring-lima-300/30"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Estado: {opt.label}
              </option>
            ))}
          </select>
          <input
            value={paymentIdFilter}
            onChange={(e) => setPaymentIdFilter(e.target.value)}
            placeholder="Filtrar por pago"
            className="h-10 rounded-lg border border-p-border bg-p-surface px-3 text-sm font-semibold text-p-text placeholder:text-p-text-muted outline-none focus:border-p-accent focus:ring-3 focus:ring-lima-300/30"
          />
          <input
            value={accountIdFilter}
            onChange={(e) => setAccountIdFilter(e.target.value)}
            placeholder="Filtrar por cuenta"
            className="h-10 rounded-lg border border-p-border bg-p-surface px-3 text-sm font-semibold text-p-text placeholder:text-p-text-muted outline-none focus:border-p-accent focus:ring-3 focus:ring-lima-300/30"
          />
          <button
            type="button"
            onClick={() => {
              setStatusFilter('ALL');
              setPaymentIdFilter('');
              setAccountIdFilter('');
            }}
            disabled={!hasActiveFilters}
            className="h-10 rounded-lg border border-p-border bg-p-surface-2 text-xs font-bold uppercase tracking-[0.14em] text-p-text-secondary disabled:opacity-40"
          >
            Limpiar filtros
          </button>
        </div>
      </AdminPanel>

      {error ? <AdminFeedbackBanner tone="error">{error}</AdminFeedbackBanner> : null}

      <AdminPanel title="Bandeja" description={`${refunds.length} devoluciones encontradas.`}>
        <RefundList
          refunds={refunds}
          loading={loading}
          emptyText="No hay devoluciones para los filtros seleccionados."
          maxHeightClass="max-h-[65vh]"
          actionBusyId={actionBusyId}
          selectedRefundId={selectedRefundId}
          onSelectRefund={(refund) => setSelectedRefundId(refund.id)}
          renderActions={(refund, isBusy) => (
            <RefundLifecycleActions
              status={refund.status}
              disabled={isBusy}
              handlers={{
                onApprove: (executeNow) => onApprove(refund, executeNow),
                onExecute: () => onExecute(refund),
                onRetry: (executeNow) => onRetry(refund, executeNow),
                onFail: () => onFail(refund),
                onCancel: () => onCancel(refund)
              }}
            />
          )}
        />
      </AdminPanel>

      {mounted && selectedRefund && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/60 p-4"
          style={{ zIndex: ADMIN_Z_INDEX.modalCritical }}
          onMouseDown={(event) => {
            detailBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onTouchStart={(event) => {
            detailBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            const startedOnBackdrop = detailBackdropMouseDownRef.current;
            detailBackdropMouseDownRef.current = false;
            if (startedOnBackdrop && event.target === event.currentTarget) {
              setSelectedRefundId(null);
            }
          }}
        >
          <div
            className="w-full max-w-2xl bg-ink-50 border-4 border-white/70 rounded-[2rem] shadow-2xl text-ink-900 max-h-[90vh] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-lima-900/10 bg-p-surface/60 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-ink-900/50">Gestión de devoluciones</p>
                <h3 className="text-2xl font-black uppercase italic tracking-tight">Detalle de devolución</h3>
                <p className="text-[11px] font-black uppercase tracking-widest text-ink-900/60 mt-1">
                  {formatRefundStatus(selectedRefund.status)} · {formatMoney(selectedRefund.amount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRefundId(null)}
                title="Cerrar"
                className="bg-p-error-bg p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-p-error hover:text-ink-50 hover:bg-p-error border border-p-error"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-88px)]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <DetailItem label="Código devolución" value={formatRefundCode(selectedRefund.id, (selectedRefund as any)?.displayCode)} />
                <DetailItem label="Estado" value={formatRefundStatus(selectedRefund.status)} />
                <DetailItem label="Monto" value={formatMoney(selectedRefund.amount)} />
                <DetailItem label="Tipo motivo" value={selectedRefund.reasonType || '-'} />
                <DetailItem
                  label="Método ejecución"
                  value={formatRefundExecutionMethod(selectedRefund.executionMethod, (selectedRefund as any)?.paymentChannel) || 'Sin método'}
                />
                <DetailItem label="Turno caja" value={selectedRefund.cashShiftId || '-'} mono />
                <DetailItem label="Código pago" value={selectedRefund.paymentId ? formatPaymentCode(selectedRefund.paymentId) : '-'} />
                <DetailItem label="Código cuenta" value={selectedRefund.accountId ? formatAccountCode(selectedRefund.accountId) : '-'} />
                <DetailItem label="Creada" value={formatDateTime(selectedRefund.createdAt)} />
                <DetailItem label="Aprobada" value={formatDateTime(selectedRefund.approvedAt)} />
                <DetailItem label="Ejecutada" value={formatDateTime(selectedRefund.executedAt)} />
                <DetailItem label="Cancelada" value={formatDateTime(selectedRefund.cancelledAt)} />
                <DetailItem label="Fallida" value={formatDateTime(selectedRefund.failedAt)} />
                <DetailItem label="Creada por" value={selectedRefund.createdByUserId != null ? String(selectedRefund.createdByUserId) : '-'} />
                <DetailItem label="Aprobada por" value={selectedRefund.approvedByUserId != null ? String(selectedRefund.approvedByUserId) : '-'} />
                <DetailItem label="Ejecutada por" value={selectedRefund.executedByUserId != null ? String(selectedRefund.executedByUserId) : '-'} />
                <DetailItem label="Cancelada por" value={selectedRefund.cancelledByUserId != null ? String(selectedRefund.cancelledByUserId) : '-'} />
              </div>

              <div className="rounded-xl border border-lima-900/10 bg-p-surface-2 px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-ink-900/55">Datos técnicos</p>
                <p className="mt-1 text-[12px] font-mono break-all">refundId: {selectedRefund.id}</p>
                <p className="text-[12px] font-mono break-all">paymentId: {selectedRefund.paymentId || '-'}</p>
                <p className="text-[12px] font-mono break-all">accountId: {selectedRefund.accountId || '-'}</p>
              </div>

              <DetailBlock label="Motivo" value={selectedRefund.reason} />
              <DetailBlock label="Notas de ejecución" value={selectedRefund.executionNotes} />
              <DetailBlock label="Referencia de ejecución" value={selectedRefund.executionReference} mono />
              <DetailBlock label="Razón de cancelación" value={selectedRefund.cancelReason} />
              <DetailBlock label="Razón de fallo" value={selectedRefund.failedReason} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Modal de confirmación para acciones de devolución */}
      <AdminAppModal
        show={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        message={
          <>
            <p>{pendingAction?.description}</p>
            {actionConfirmError && (
              <AdminFeedbackBanner tone="error" compact className="mt-3">
                {actionConfirmError}
              </AdminFeedbackBanner>
            )}
          </>
        }
        confirmText={actionConfirming ? 'Procesando...' : (pendingAction?.confirmText ?? 'Confirmar')}
        cancelText="Cancelar"
        confirmDisabled={actionConfirming}
        isWarning={pendingAction?.isWarning ?? false}
        closeOnBackdrop={!actionConfirming}
        closeOnEscape={!actionConfirming}
        onClose={closePendingAction}
        onConfirm={() => { void handleConfirmAction(); }}
      />
    </div>
  );
}
