import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import AdminLayout from '../../components/AdminLayout';
import { addAccountItem, closeAccount, getAccountById, listAccounts, openAccount, registerPayment, type PaymentMethod, type PaymentSource } from '../../services/AccountService';
import { listRefunds, requestPaymentRefund, type RefundRecord } from '../../services/PaymentService';

type AccountRow = {
  id: string;
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
  sourceId: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt?: string | null;
};

export default function AdminAccountsPage() {
  const [openAccounts, setOpenAccounts] = useState<AccountRow[]>([]);
  const [closedAccounts, setClosedAccounts] = useState<AccountRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [newItem, setNewItem] = useState<{ description: string; quantity: number; unitPrice: number; type: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT' }>({ description: '', quantity: 1, unitPrice: 0, type: 'PRODUCT' });
  const [payment, setPayment] = useState<{ amount: number; method: PaymentMethod; source: PaymentSource }>({ amount: 0, method: 'CASH', source: 'POS' });
  const [splitPayments, setSplitPayments] = useState<Array<{ amount: number; method: PaymentMethod; source: PaymentSource }>>([{ amount: 0, method: 'CASH', source: 'POS' }]);
  const [newAccount, setNewAccount] = useState({ sourceType: 'MANUAL' as const, sourceId: '' });
  const [itemAllocationDraft, setItemAllocationDraft] = useState<Record<string, number>>({});
  const [refunds, setRefunds] = useState<RefundRecord[]>([]);
  const [loadingRefunds, setLoadingRefunds] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundPaymentMaxAmount, setRefundPaymentMaxAmount] = useState(0);
  const [refundAmountInput, setRefundAmountInput] = useState('');
  const [refundReasonType, setRefundReasonType] = useState<'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER'>('OTHER');
  const [refundExecutionNotes, setRefundExecutionNotes] = useState('');
  const [refundExecuteNow, setRefundExecuteNow] = useState(false);
  const [submittingRefund, setSubmittingRefund] = useState(false);

  const refreshLists = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [opens, closeds] = await Promise.all([
        listAccounts({ status: 'OPEN' }),
        listAccounts({ status: 'CLOSED' })
      ]);
      setOpenAccounts(opens);
      setClosedAccounts(closeds);
      if (!selectedId && opens.length > 0) {
        setSelectedId(opens[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Error al cargar cuentas');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const data = await getAccountById(id);
      setDetail(data);
      setPayment((prev) => ({ ...prev, amount: Number(data.remaining || 0) }));
      setItemAllocationDraft({});
    } catch (err: any) {
      setError(err.message || 'Error al cargar detalle');
    }
  }, []);

  const loadRefunds = useCallback(async (accountId: string) => {
    if (!accountId) {
      setRefunds([]);
      return;
    }
    try {
      setLoadingRefunds(true);
      const data = await listRefunds({ accountId, take: 100 });
      setRefunds(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar devoluciones');
    } finally {
      setLoadingRefunds(false);
    }
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (selectedId) loadRefunds(selectedId);
  }, [selectedId, loadRefunds]);

  const totals = useMemo(() => ({
    open: openAccounts.length,
    closed: closedAccounts.length
  }), [openAccounts.length, closedAccounts.length]);

  const itemOutstandingMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!detail?.items) return map;

    const allocatedByItem = new Map<string, number>();
    for (const paymentEntry of detail?.payments || []) {
      for (const allocation of paymentEntry?.allocations || []) {
        const itemId = String(allocation?.accountItemId || '');
        if (!itemId) continue;
        const prev = Number(allocatedByItem.get(itemId) || 0);
        allocatedByItem.set(itemId, Number((prev + Number(allocation?.amount || 0)).toFixed(2)));
      }
    }

    for (const item of detail.items || []) {
      const itemId = String(item.id || '');
      if (!itemId) continue;
      const total = Number(item.total || 0);
      const allocated = Number(allocatedByItem.get(itemId) || 0);
      map.set(itemId, Math.max(0, Number((total - allocated).toFixed(2))));
    }

    return map;
  }, [detail]);

  const formatRefundStatus = (status?: string) => {
    switch (status) {
      case 'REQUESTED':
        return 'Solicitada';
      case 'APPROVED':
        return 'Aprobada';
      case 'READY_TO_EXECUTE':
        return 'Lista para ejecutar';
      case 'EXECUTED':
        return 'Ejecutada';
      case 'FAILED':
        return 'Fallida';
      case 'CANCELLED':
        return 'Cancelada';
      default:
        return status || '-';
    }
  };

  const openRefundModal = (paymentId: string, amount: number) => {
    setRefundPaymentId(paymentId);
    setRefundPaymentMaxAmount(amount);
    setRefundAmountInput(String(Number(amount.toFixed(2))));
    setRefundReasonType('OTHER');
    setRefundExecutionNotes('');
    setRefundExecuteNow(false);
    setShowRefundModal(true);
  };

  const closeRefundModal = () => {
    if (submittingRefund) return;
    setShowRefundModal(false);
  };

  const submitRefundModal = async () => {
    try {
      const parsedAmount = Number(refundAmountInput);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        throw new Error('Monto invalido');
      }
      if (parsedAmount > refundPaymentMaxAmount + 0.009) {
        throw new Error('El monto no puede superar el pago original');
      }
      if (!refundPaymentId) {
        throw new Error('Pago invalido');
      }

      setSubmittingRefund(true);
      await requestPaymentRefund(refundPaymentId, {
        amount: Number(parsedAmount.toFixed(2)),
        reasonType: refundReasonType,
        reason: 'Refund solicitado desde cuentas',
        executionMethod: 'CASH',
        executionNotes: refundExecutionNotes.trim() || undefined,
        executeNow: refundExecuteNow
      });
      await loadRefunds(selectedId);
      await loadDetail(selectedId);
      await refreshLists();
      setShowRefundModal(false);
    } catch (err: any) {
      setError(err.message || 'No se pudo solicitar refund');
    } finally {
      setSubmittingRefund(false);
    }
  };

  return (
    <AdminLayout>
      <Head>
        <title>Cuentas | Admin Panel</title>
      </Head>

      <div className="bg-[#EBE1D8] border-4 border-white/50 rounded-[2rem] p-8 shadow-2xl text-[#347048] space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-black uppercase italic">Cuentas</h1>
          <div className="text-xs font-black uppercase tracking-widest text-[#347048]/60">
            Abiertas: {totals.open} · Cerradas: {totals.closed}
          </div>
        </div>

        {error && <div className="text-sm font-bold text-red-600">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-[#347048]/10 bg-white p-4 space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60">Abrir cuenta</p>
            <select
              value={newAccount.sourceType}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, sourceType: e.target.value as any }))}
              className="w-full h-10 border rounded-lg px-3"
            >
              <option value="MANUAL">MANUAL</option>
              <option value="BAR">BAR</option>
              <option value="TABLE">TABLE</option>
              <option value="BOOKING">BOOKING</option>
            </select>
            <input
              value={newAccount.sourceId}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, sourceId: e.target.value }))}
              placeholder="Source ID"
              className="w-full h-10 border rounded-lg px-3"
            />
            <button
              onClick={async () => {
                await openAccount({
                  sourceType: newAccount.sourceType,
                  sourceId: newAccount.sourceId || `manual-${Date.now()}`
                });
                await refreshLists();
              }}
              className="w-full h-10 rounded-lg bg-[#347048] text-[#EBE1D8] font-black text-xs uppercase"
            >
              Crear
            </button>
          </div>

          <div className="rounded-2xl border border-[#347048]/10 bg-white p-4 lg:col-span-2">
            <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60 mb-3">Cuentas abiertas</p>
            <div className="space-y-2 max-h-44 overflow-y-auto">
              {openAccounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() => setSelectedId(account.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border ${selectedId === account.id ? 'bg-[#347048] text-[#EBE1D8] border-[#347048]' : 'bg-white border-[#347048]/20 text-[#347048]'}`}
                >
                  <div className="text-xs font-black uppercase tracking-wider">{account.sourceType} · {account.sourceId}</div>
                  <div className="text-xs">Estado: {account.status}</div>
                </button>
              ))}
              {openAccounts.length === 0 && <div className="text-xs font-bold text-[#347048]/50">No hay cuentas abiertas.</div>}
            </div>
          </div>
        </div>

        {detail && (
          <div className="rounded-2xl border border-[#347048]/10 bg-white p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm font-bold">
              <div>Total: ${Number(detail.total || 0).toLocaleString()}</div>
              <div>Pagado: ${Number(detail.paid || 0).toLocaleString()}</div>
              <div>Restante: ${Number(detail.remaining || 0).toLocaleString()}</div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input placeholder="Descripción" value={newItem.description} onChange={(e) => setNewItem((prev) => ({ ...prev, description: e.target.value }))} className="h-10 border rounded-lg px-3" />
              <input type="number" min={1} value={newItem.quantity} onChange={(e) => setNewItem((prev) => ({ ...prev, quantity: Number(e.target.value) }))} className="h-10 border rounded-lg px-3" />
              <input type="number" min={0} step="0.01" value={newItem.unitPrice} onChange={(e) => setNewItem((prev) => ({ ...prev, unitPrice: Number(e.target.value) }))} className="h-10 border rounded-lg px-3" />
              <select value={newItem.type} onChange={(e) => setNewItem((prev) => ({ ...prev, type: e.target.value as any }))} className="h-10 border rounded-lg px-3">
                <option value="PRODUCT">PRODUCT</option>
                <option value="BOOKING">BOOKING</option>
                <option value="SERVICE">SERVICE</option>
                <option value="ADJUSTMENT">ADJUSTMENT</option>
              </select>
              <button
                onClick={async () => {
                  await addAccountItem(selectedId, newItem);
                  setNewItem({ description: '', quantity: 1, unitPrice: 0, type: 'PRODUCT' });
                  await loadDetail(selectedId);
                  await refreshLists();
                }}
                className="h-10 rounded-lg bg-[#926699] text-[#EBE1D8] text-xs font-black uppercase md:col-span-4"
              >
                Agregar consumo
              </button>
            </div>

            <div className="rounded-xl border border-[#347048]/10 p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Items</p>
              <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                {(detail.items || []).map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between border border-[#347048]/10 rounded-lg px-2 py-1">
                    <span className="font-bold">{item.description} · {item.type}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[#347048]/70">Pendiente: ${Number(itemOutstandingMap.get(String(item.id)) || 0).toLocaleString()}</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        max={Number(itemOutstandingMap.get(String(item.id)) || 0)}
                        value={itemAllocationDraft[String(item.id)] > 0 ? itemAllocationDraft[String(item.id)] : ''}
                        onChange={(e) => {
                          const raw = Number(e.target.value || 0);
                          const max = Number(itemOutstandingMap.get(String(item.id)) || 0);
                          const next = Number.isFinite(raw) ? Math.max(0, Math.min(max, raw)) : 0;
                          setItemAllocationDraft((prev) => ({ ...prev, [String(item.id)]: next }));
                        }}
                        className="h-8 w-24 border rounded px-2 text-right"
                        placeholder="0"
                      />
                    </div>
                  </div>
                ))}
                {(!detail.items || detail.items.length === 0) && <div className="text-[#347048]/50">Sin items.</div>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input type="number" min={0} step="0.01" value={payment.amount} onChange={(e) => setPayment((prev) => ({ ...prev, amount: Number(e.target.value) }))} className="h-10 border rounded-lg px-3" />
              <select value={payment.method} onChange={(e) => setPayment((prev) => ({ ...prev, method: e.target.value as PaymentMethod }))} className="h-10 border rounded-lg px-3">
                <option value="CASH">CASH</option>
                <option value="TRANSFER">TRANSFER</option>
                <option value="MERCADO_PAGO">MERCADO_PAGO</option>
                <option value="CARD">CARD</option>
                <option value="OTHER">OTHER</option>
              </select>
              <select value={payment.source} onChange={(e) => setPayment((prev) => ({ ...prev, source: e.target.value as PaymentSource }))} className="h-10 border rounded-lg px-3">
                <option value="POS">POS</option>
                <option value="ONLINE">ONLINE</option>
                <option value="BACKOFFICE">BACKOFFICE</option>
              </select>
              <button
                onClick={async () => {
                  const allocations = Object.entries(itemAllocationDraft)
                    .map(([accountItemId, amount]) => ({ accountItemId, amount: Number(amount || 0) }))
                    .filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0.009);
                  const allocationTotal = Number(allocations.reduce((sum, entry) => sum + entry.amount, 0).toFixed(2));
                  const amountToPay = Number(payment.amount || 0);

                  if (allocations.length > 0 && Math.abs(allocationTotal - amountToPay) > 0.009) {
                    throw new Error('El monto debe coincidir con la suma asignada a items.');
                  }

                  await registerPayment({
                    accountId: selectedId,
                    amount: amountToPay,
                    method: payment.method,
                    source: payment.source,
                    allocations: allocations.length > 0 ? allocations : undefined
                  });
                  setItemAllocationDraft({});
                  await loadDetail(selectedId);
                  await refreshLists();
                }}
                className="h-10 rounded-lg bg-[#347048] text-[#EBE1D8] text-xs font-black uppercase"
              >
                Registrar pago
              </button>
              <button
                onClick={async () => {
                  await closeAccount(selectedId);
                  setDetail(null);
                  setSelectedId('');
                  await refreshLists();
                }}
                className="h-10 rounded-lg bg-[#B9CF32] text-[#347048] text-xs font-black uppercase"
              >
                Cerrar cuenta
              </button>
            </div>

            <div className="rounded-xl border border-[#347048]/10 p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Split payments</p>
              {splitPayments.map((splitPayment, index) => (
                <div key={`split-payment-${index}`} className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input type="number" min={0} step="0.01" value={splitPayment.amount} onChange={(e) => setSplitPayments((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, amount: Number(e.target.value) } : entry))} className="h-10 border rounded-lg px-3" />
                  <select value={splitPayment.method} onChange={(e) => setSplitPayments((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, method: e.target.value as PaymentMethod } : entry))} className="h-10 border rounded-lg px-3">
                    <option value="CASH">CASH</option>
                    <option value="TRANSFER">TRANSFER</option>
                    <option value="MERCADO_PAGO">MERCADO_PAGO</option>
                    <option value="CARD">CARD</option>
                    <option value="OTHER">OTHER</option>
                  </select>
                  <select value={splitPayment.source} onChange={(e) => setSplitPayments((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, source: e.target.value as PaymentSource } : entry))} className="h-10 border rounded-lg px-3">
                    <option value="POS">POS</option>
                    <option value="ONLINE">ONLINE</option>
                    <option value="BACKOFFICE">BACKOFFICE</option>
                  </select>
                  <button onClick={() => setSplitPayments((prev) => prev.filter((_, entryIndex) => entryIndex !== index))} className="h-10 rounded-lg border border-[#347048]/20 text-xs font-black uppercase text-[#347048]">
                    Quitar
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={() => setSplitPayments((prev) => [...prev, { amount: 0, method: 'CASH', source: 'POS' }])} className="h-9 px-3 rounded-lg border border-[#347048]/20 text-xs font-black uppercase text-[#347048]">Agregar tramo</button>
                <button
                  onClick={async () => {
                    const validSplits = splitPayments.filter((entry) => Number.isFinite(entry.amount) && entry.amount > 0);
                    for (const splitPayment of validSplits) {
                      await registerPayment({ accountId: selectedId, amount: splitPayment.amount, method: splitPayment.method, source: splitPayment.source });
                    }
                    await loadDetail(selectedId);
                    await refreshLists();
                  }}
                  className="h-9 px-3 rounded-lg bg-[#347048] text-[#EBE1D8] text-xs font-black uppercase"
                >
                  Registrar split
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[#347048]/10 p-3 space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Pagos de la cuenta (refund manual)</p>
              <div className="space-y-1 max-h-40 overflow-y-auto text-xs">
                {(detail.payments || []).map((entry: any) => {
                  const paymentId = String(entry?.id || '');
                  if (!paymentId) return null;
                  const amount = Number(entry?.amount || 0);
                  return (
                    <div key={paymentId} className="flex items-center justify-between gap-2 border border-[#347048]/10 rounded-lg px-2 py-1">
                      <div className="min-w-0">
                        <p className="font-black truncate">{paymentId}</p>
                        <p className="text-[#347048]/70 truncate">{entry.method} · ${amount.toLocaleString()}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openRefundModal(paymentId, amount)}
                        className="h-8 rounded-lg border border-[#347048]/20 px-2 text-[10px] font-black uppercase"
                      >
                        Solicitar refund
                      </button>
                    </div>
                  );
                })}
                {(!detail.payments || detail.payments.length === 0) && <div className="text-[#347048]/50">Sin pagos.</div>}
              </div>
            </div>

            <div className="rounded-xl border border-[#347048]/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Devoluciones de la cuenta</p>
                <button
                  type="button"
                  onClick={() => loadRefunds(selectedId)}
                  className="h-7 rounded-lg border border-[#347048]/20 px-2 text-[10px] font-black uppercase"
                >
                  Recargar
                </button>
              </div>
              {loadingRefunds ? (
                <div className="text-xs text-[#347048]/60">Cargando devoluciones...</div>
              ) : (
                <div className="space-y-1 max-h-36 overflow-y-auto text-xs">
                  {refunds.map((refund) => (
                    <div key={refund.id} className="border border-[#347048]/10 rounded-lg px-2 py-1">
                      <p className="font-black">{refund.id}</p>
                      <p className="text-[#347048]/70">
                        ${Number(refund.amount || 0).toLocaleString()} · {formatRefundStatus(refund.status)} · {refund.executionMethod || '-'}
                      </p>
                    </div>
                  ))}
                  {!loadingRefunds && refunds.length === 0 ? <div className="text-[#347048]/50">Sin devoluciones para esta cuenta.</div> : null}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-[#347048]/10 bg-white p-4">
          <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60 mb-2">Cuentas cerradas</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {closedAccounts.slice(0, 12).map((account) => (
              <div key={account.id} className="border border-[#347048]/15 rounded-lg px-3 py-2 text-xs">
                <div className="font-black uppercase">{account.sourceType} · {account.sourceId}</div>
                <div>Estado: {account.status}</div>
              </div>
            ))}
            {!loading && closedAccounts.length === 0 && <div className="text-xs font-bold text-[#347048]/50">No hay cuentas cerradas.</div>}
          </div>
        </div>
      </div>

      {showRefundModal ? (
        <div className="fixed inset-0 z-[9999] bg-[#347048]/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#EBE1D8] border-4 border-white/60 rounded-[1.5rem] shadow-2xl p-6 text-[#347048] space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black uppercase italic">Solicitar refund</h3>
                <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60">
                  Pago: {refundPaymentId}
                </p>
              </div>
              <button
                type="button"
                onClick={closeRefundModal}
                disabled={submittingRefund}
                className="h-8 px-3 rounded-lg border border-[#347048]/20 text-xs font-black uppercase"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Monto</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refundAmountInput}
                  onChange={(e) => setRefundAmountInput(e.target.value)}
                  className="w-full h-10 border rounded-lg px-3 bg-white"
                />
                <p className="text-[11px] text-[#347048]/60 mt-1">Maximo: ${refundPaymentMaxAmount.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Tipo</label>
                <select
                  value={refundReasonType}
                  onChange={(e) => setRefundReasonType(e.target.value as 'FULL' | 'PARTIAL_COMMERCIAL' | 'PARTIAL_SERVICE_FAILURE' | 'PARTIAL_PRICING_ERROR' | 'OTHER')}
                  className="w-full h-10 border rounded-lg px-3 bg-white"
                >
                  <option value="FULL">FULL</option>
                  <option value="PARTIAL_COMMERCIAL">PARTIAL_COMMERCIAL</option>
                  <option value="PARTIAL_SERVICE_FAILURE">PARTIAL_SERVICE_FAILURE</option>
                  <option value="PARTIAL_PRICING_ERROR">PARTIAL_PRICING_ERROR</option>
                  <option value="OTHER">OTHER</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Nota operativa</label>
                <textarea
                  value={refundExecutionNotes}
                  onChange={(e) => setRefundExecutionNotes(e.target.value)}
                  rows={3}
                  maxLength={500}
                  className="w-full border rounded-lg px-3 py-2 bg-white resize-none"
                  placeholder="Detalle interno"
                />
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-bold">
                <input
                  type="checkbox"
                  checked={refundExecuteNow}
                  onChange={(e) => setRefundExecuteNow(e.target.checked)}
                />
                Ejecutar ahora
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={closeRefundModal}
                disabled={submittingRefund}
                className="h-10 rounded-lg border border-[#347048]/20 text-xs font-black uppercase"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitRefundModal}
                disabled={submittingRefund}
                className="h-10 rounded-lg bg-[#347048] text-[#EBE1D8] text-xs font-black uppercase disabled:opacity-50"
              >
                {submittingRefund ? 'Enviando...' : 'Confirmar refund'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminLayout>
  );
}

