import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { RefundRecord, RefundStatus } from '../../modules/refunds/refund.types';
import { searchRefunds, refundActions } from '../../modules/refunds/refund.facade';
import { formatRefundExecutionMethod, formatRefundStatus } from '../../modules/refunds/refund.constants';
import RefundList from './refunds/RefundList';
import RefundLifecycleActions from './refunds/RefundLifecycleActions';
import { formatAccountCode, formatPaymentCode, formatRefundCode } from '../../utils/displayCode';

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
    <div className="rounded-xl border border-[#347048]/10 bg-white px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/55">{label}</p>
      <p className={`mt-1 text-sm font-bold ${mono ? 'font-mono text-[12px] break-all' : ''}`}>{value || '-'}</p>
    </div>
  );
}

function DetailBlock({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-[#347048]/10 bg-white px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/55">{label}</p>
      <p className={`mt-1 text-sm font-semibold whitespace-pre-wrap break-words ${mono ? 'font-mono text-[12px]' : ''}`}>
        {value && value.trim() ? value : '-'}
      </p>
    </div>
  );
}

export default function AdminTabRefunds() {
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [selectedRefundId, setSelectedRefundId] = useState<string | null>(null);

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
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar devoluciones');
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

  const runAction = async (refundId: string, action: () => Promise<any>) => {
    try {
      setActionBusyId(refundId);
      await action();
      await load();
    } catch (err: any) {
      setError(err?.message || 'No se pudo procesar la devolucion');
    } finally {
      setActionBusyId(null);
    }
  };

  const onApprove = (refund: RefundRecord, executeNow: boolean) => {
    const ok = window.confirm(executeNow ? '¿Aprobar y ejecutar esta devolución?' : '¿Aprobar esta devolución?');
    if (!ok) return;
    runAction(refund.id, () => refundActions.approve(refund.id, executeNow));
  };

  const onExecute = (refund: RefundRecord) => {
    if (!window.confirm('¿Ejecutar esta devolución?')) return;
    runAction(refund.id, () => refundActions.execute(refund.id));
  };

  const onRetry = (refund: RefundRecord, executeNow: boolean) => {
    if (!window.confirm('¿Reintentar esta devolución?')) return;
    runAction(refund.id, () => refundActions.retry(refund.id, executeNow));
  };

  const onFail = (refund: RefundRecord) => {
    if (!window.confirm('¿Marcar esta devolución como fallida?')) return;
    runAction(refund.id, () => refundActions.fail(refund.id));
  };

  const onCancel = (refund: RefundRecord) => {
    if (!window.confirm('¿Cancelar esta devolución?')) return;
    runAction(refund.id, () => refundActions.cancel(refund.id));
  };

  return (
    <div className="density-compact bg-[#EBE1D8] border-4 border-white/60 rounded-[1.5rem] p-4 md:p-5 shadow-2xl shadow-[#347048]/25 text-[#347048] space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-black uppercase italic tracking-tight text-[#347048]">Bandeja de devoluciones</h2>
        <button
          type="button"
          onClick={load}
          className="h-9 px-3 rounded-lg border border-[#347048]/20 bg-white text-[10px] font-black uppercase tracking-widest text-[#347048] hover:border-[#B9CF32] shadow-sm hover:shadow-md transition-all"
        >
          Recargar
        </button>
      </div>

      <div className="rounded-2xl border border-[#347048]/15 bg-white/80 p-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | RefundStatus)}
            className="compact-field h-9 border border-[#347048]/20 rounded-xl px-3 bg-white text-sm font-semibold"
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
            className="compact-field h-9 border border-[#347048]/20 rounded-xl px-3 bg-white text-sm font-semibold placeholder:text-[#347048]/45"
          />
          <input
            value={accountIdFilter}
            onChange={(e) => setAccountIdFilter(e.target.value)}
            placeholder="Filtrar por cuenta"
            className="compact-field h-9 border border-[#347048]/20 rounded-xl px-3 bg-white text-sm font-semibold placeholder:text-[#347048]/45"
          />
          <button
            type="button"
            onClick={() => {
              setStatusFilter('ALL');
              setPaymentIdFilter('');
              setAccountIdFilter('');
            }}
            disabled={!hasActiveFilters}
            className="compact-field h-9 rounded-xl border border-[#347048]/20 bg-[#EBE1D8] text-xs font-black uppercase tracking-wide disabled:opacity-40"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</div> : null}

      <RefundList
        refunds={refunds}
        loading={loading}
        emptyText="No hay devoluciones para los filtros seleccionados."
        maxHeightClass="max-h-[76vh]"
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

      {mounted && selectedRefund && createPortal(
        <div
          className="fixed inset-0 z-[2147483400] flex items-center justify-center bg-black/60 p-4"
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
            className="density-compact w-full max-w-2xl bg-[#EBE1D8] border-4 border-white/70 rounded-[1.5rem] shadow-2xl text-[#347048] max-h-[90vh] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-4 py-4 border-b border-[#347048]/10 bg-white/60 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/50">Gestion de devoluciones</p>
                <h3 className="compact-title font-black uppercase italic tracking-tight">Detalle de devolución</h3>
                <p className="text-[11px] font-black uppercase tracking-widest text-[#347048]/60 mt-1">
                  {formatRefundStatus(selectedRefund.status)} · {formatMoney(selectedRefund.amount)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRefundId(null)}
                title="Cerrar"
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto max-h-[calc(90vh-80px)]">
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

              <div className="rounded-xl border border-[#347048]/10 bg-[#f7f4ef] px-3 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/55">Datos técnicos</p>
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
    </div>
  );
}
