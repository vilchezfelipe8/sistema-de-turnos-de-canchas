import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefundRecord, RefundStatus } from '../../modules/refunds/refund.types';
import { searchRefunds, refundActions } from '../../modules/refunds/refund.facade';
import RefundList from './refunds/RefundList';
import RefundLifecycleActions from './refunds/RefundLifecycleActions';

const STATUS_OPTIONS: Array<{ value: 'ALL' | RefundStatus; label: string }> = [
  { value: 'ALL', label: 'Todos' },
  { value: 'REQUESTED', label: 'Solicitada' },
  { value: 'APPROVED', label: 'Aprobada' },
  { value: 'READY_TO_EXECUTE', label: 'Lista para ejecutar' },
  { value: 'EXECUTED', label: 'Ejecutada' },
  { value: 'FAILED', label: 'Fallida' },
  { value: 'CANCELLED', label: 'Cancelada' }
];

export default function AdminTabRefunds() {
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState<'ALL' | RefundStatus>('ALL');
  const [paymentIdFilter, setPaymentIdFilter] = useState('');
  const [accountIdFilter, setAccountIdFilter] = useState('');

  const hasActiveFilters = useMemo(
    () => statusFilter !== 'ALL' || Boolean(paymentIdFilter.trim()) || Boolean(accountIdFilter.trim()),
    [statusFilter, paymentIdFilter, accountIdFilter]
  );

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
    const ok = window.confirm(executeNow ? 'Aprobar y ejecutar esta devolucion?' : 'Aprobar esta devolucion?');
    if (!ok) return;
    runAction(refund.id, () => refundActions.approve(refund.id, executeNow));
  };

  const onExecute = (refund: RefundRecord) => {
    if (!window.confirm('Ejecutar esta devolucion?')) return;
    runAction(refund.id, () => refundActions.execute(refund.id));
  };

  const onRetry = (refund: RefundRecord, executeNow: boolean) => {
    if (!window.confirm('Reintentar esta devolucion?')) return;
    runAction(refund.id, () => refundActions.retry(refund.id, executeNow));
  };

  const onFail = (refund: RefundRecord) => {
    if (!window.confirm('Marcar esta devolucion como fallida?')) return;
    runAction(refund.id, () => refundActions.fail(refund.id));
  };

  const onCancel = (refund: RefundRecord) => {
    if (!window.confirm('Cancelar esta devolucion?')) return;
    runAction(refund.id, () => refundActions.cancel(refund.id));
  };

  return (
    <div className="bg-[#EBE1D8] border-4 border-white/60 rounded-[2rem] p-6 md:p-8 shadow-2xl shadow-[#347048]/25 text-[#347048] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase italic tracking-tight">Bandeja de devoluciones</h2>
          <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60 mt-1">Solicitudes de cuentas y turnos en un solo flujo.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="h-10 px-4 rounded-xl border border-[#347048]/20 bg-white text-xs font-black uppercase tracking-wide hover:border-[#347048]/35 transition-colors"
        >
          Recargar
        </button>
      </div>

      <div className="rounded-2xl border border-[#347048]/15 bg-white/80 p-3 md:p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'ALL' | RefundStatus)}
          className="h-10 border border-[#347048]/20 rounded-xl px-3 bg-white text-sm font-semibold"
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
          className="h-10 border border-[#347048]/20 rounded-xl px-3 bg-white text-sm font-semibold placeholder:text-[#347048]/45"
        />
        <input
          value={accountIdFilter}
          onChange={(e) => setAccountIdFilter(e.target.value)}
          placeholder="Filtrar por cuenta"
          className="h-10 border border-[#347048]/20 rounded-xl px-3 bg-white text-sm font-semibold placeholder:text-[#347048]/45"
        />
        <button
          type="button"
          onClick={() => {
            setStatusFilter('ALL');
            setPaymentIdFilter('');
            setAccountIdFilter('');
          }}
          disabled={!hasActiveFilters}
          className="h-10 rounded-xl border border-[#347048]/20 bg-[#EBE1D8] text-xs font-black uppercase tracking-wide disabled:opacity-40"
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
        maxHeightClass="max-h-[65vh]"
        actionBusyId={actionBusyId}
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
    </div>
  );
}
