import { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import AdminLayout from '../../components/AdminLayout';
import { addAccountItem, closeAccount, getAccountById, listAccounts, openAccount, registerPayment, type PaymentChannel, type PaymentSource } from '../../services/AccountService';
import { ClubAdminService } from '../../services/ClubAdminService';
import AppModal from '../../components/AppModal';
import type { RefundDraft } from '../../modules/refunds/refund.types';
import { buildDefaultRefundDraft } from '../../modules/refunds/refund.policy';
import { validateRefundAmountInput } from '../../modules/refunds/refund.validators';
import { requestManualRefund } from '../../modules/refunds/refund.facade';
import RefundRequestModal from '../../components/admin/refunds/RefundRequestModal';
import PaymentCalculator, { type PaymentCalculatorResult } from '../../components/PaymentCalculator';
import ProductSearch, { type ProductSearchItem } from '../../components/ui/ProductSearch';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { reportUiError } from '../../utils/uiError';

type AccountRow = {
  id: string;
  sourceType: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL';
  sourceId: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt?: string | null;
  booking?: {
    id: number;
    startDateTime: string;
    courtName?: string | null;
    clientName?: string | null;
  } | null;
};

export default function AdminAccountsPage() {
  const [openAccounts, setOpenAccounts] = useState<AccountRow[]>([]);
  const [closedAccounts, setClosedAccounts] = useState<AccountRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  const [newItem, setNewItem] = useState<{ description: string; quantity: number; unitPrice: number; type: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT' }>({ description: '', quantity: 1, unitPrice: 0, type: 'PRODUCT' });
  const [payment, setPayment] = useState<{ channel: PaymentChannel; collectorAccountLabel: string; externalReference: string; source: PaymentSource }>({ channel: 'AUTO', collectorAccountLabel: '', externalReference: '', source: 'POS' });
  const [newAccount, setNewAccount] = useState({ sourceType: 'MANUAL' as const, sourceId: '' });
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundPaymentId, setRefundPaymentId] = useState('');
  const [refundPaymentMaxAmount, setRefundPaymentMaxAmount] = useState(0);
  const [refundDraft, setRefundDraft] = useState<RefundDraft>(() => buildDefaultRefundDraft('ACCOUNT_MANUAL', 0));
  const [submittingRefund, setSubmittingRefund] = useState(false);
  const [clubSlug, setClubSlug] = useState('');
  const [products, setProducts] = useState<ProductSearchItem[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showPaymentCalculator, setShowPaymentCalculator] = useState(false);
  const [submittingCalculator, setSubmittingCalculator] = useState(false);
  const [openAccountsSearch, setOpenAccountsSearch] = useState('');
  const [closedVisibleCount, setClosedVisibleCount] = useState(12);
  const [showCloseAccountConfirm, setShowCloseAccountConfirm] = useState(false);
  const [closingAccount, setClosingAccount] = useState(false);
  const [closeBlockedModal, setCloseBlockedModal] = useState<{
    show: boolean;
    message: string;
  }>({ show: false, message: '' });
  const [showClosedAccountModal, setShowClosedAccountModal] = useState(false);
  const [selectedClosedAccountId, setSelectedClosedAccountId] = useState<string>('');
  const [selectedClosedAccountDetail, setSelectedClosedAccountDetail] = useState<any>(null);
  const [loadingClosedAccountDetail, setLoadingClosedAccountDetail] = useState(false);

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

  const resolveClubSlug = useCallback(() => {
    if (typeof window === 'undefined') return '';
    try {
      const path = window.location.pathname;
      const parts = path.split('/').filter(Boolean);
      const clubIdx = parts.findIndex((part) => part === 'club');
      if (clubIdx >= 0 && parts[clubIdx + 1]) return parts[clubIdx + 1];

      const rawUser = localStorage.getItem('user');
      if (!rawUser) return '';
      const normalized = normalizeSessionUser(JSON.parse(rawUser));
      return getActiveClubSlug(normalized) || '';
    } catch (err) {
      reportUiError({ area: 'AdminAccountsPage', action: 'resolveClubSlug' }, err);
      setError('No se pudo resolver el club activo para cargar productos.');
      return '';
    }
  }, []);

  const loadClubProducts = useCallback(async (slug: string) => {
    if (!slug) {
      setProducts([]);
      return;
    }
    try {
      setProductsLoading(true);
      const data = await ClubAdminService.getProducts(slug);
      const normalizedProducts = Array.isArray(data)
        ? data.map((item: any) => ({
            id: Number(item?.id || 0),
            name: String(item?.name || ''),
            price: Number(item?.price || 0),
            stock: item?.stock !== undefined && item?.stock !== null ? Number(item.stock) : null
          }))
        : [];
      setProducts(normalizedProducts.filter((item: ProductSearchItem) => Number(item.id) > 0 && item.name.trim().length > 0));
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar los productos del club');
      setProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const data = await getAccountById(id);
      setDetail(data);
      setPayment((prev) => ({
        ...prev,
        collectorAccountLabel: '',
        externalReference: ''
      }));
    } catch (err: any) {
      setError(err.message || 'Error al cargar detalle');
    }
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists]);

  useEffect(() => {
    const resolved = resolveClubSlug();
    setClubSlug(resolved);
    void loadClubProducts(resolved);
  }, [loadClubProducts, resolveClubSlug]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const totals = useMemo(() => ({
    open: openAccounts.length,
    closed: closedAccounts.length
  }), [openAccounts.length, closedAccounts.length]);

  const filteredOpenAccounts = useMemo(() => {
    const term = openAccountsSearch.trim().toLowerCase();
    if (!term) return openAccounts;
    return openAccounts.filter((account) => {
      const booking = account.booking;
      const haystack = [
        account.id,
        account.sourceType,
        account.sourceId,
        booking?.clientName || '',
        booking?.courtName || '',
        booking?.id ? String(booking.id) : ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [openAccounts, openAccountsSearch]);

  const visibleClosedAccounts = useMemo(
    () => closedAccounts.slice(0, Math.max(1, closedVisibleCount)),
    [closedAccounts, closedVisibleCount]
  );

  const hasMoreClosedAccounts = closedAccounts.length > visibleClosedAccounts.length;

  const formatRawCode = (value?: string) => {
    if (!value) return '-';
    return value
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const formatBookingDateTime = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const day = date.toLocaleDateString('es-AR');
    const time = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${time}`;
  };

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

  const pendingAccountItems = useMemo(() => {
    const items = Array.isArray(detail?.items) ? detail.items : [];
    return items
      .map((item: any) => {
        const id = String(item?.id || '');
        const quantity = Math.max(1, Number(item?.quantity || 1));
        const remaining = Number(itemOutstandingMap.get(id) || 0);
        return {
          id,
          type: String(item?.type || 'OTHER'),
          description: String(item?.description || 'Concepto'),
          quantity,
          remaining
        };
      })
      .filter((item) => item.id && item.remaining > 0.009);
  }, [detail?.items, itemOutstandingMap]);

  const bookingPendingItems = useMemo(
    () => pendingAccountItems.filter((item) => item.type === 'BOOKING'),
    [pendingAccountItems]
  );

  const consumptionPendingItems = useMemo(
    () => pendingAccountItems.filter((item) => item.type !== 'BOOKING'),
    [pendingAccountItems]
  );

  const paymentCalculatorContext = useMemo(() => {
    const courtPending = Number(bookingPendingItems.reduce((sum, item) => sum + item.remaining, 0).toFixed(2));
    const cartItems = consumptionPendingItems.map((item) => ({
      id: item.id,
      productName: item.description,
      quantity: item.quantity,
      price: Number((item.remaining / item.quantity).toFixed(2))
    }));
    const cartTotal = Number(cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
    const totalPending = Number((courtPending + cartTotal).toFixed(2));
    return { courtPending, cartItems, totalPending };
  }, [bookingPendingItems, consumptionPendingItems]);

  const formatAccountSourceType = (sourceType?: string) => {
    switch (sourceType) {
      case 'MANUAL':
        return 'Manual';
      case 'BAR':
        return 'Bar';
      case 'TABLE':
        return 'Mesa';
      case 'BOOKING':
        return 'Reserva';
      default:
        return formatRawCode(sourceType);
    }
  };
  const formatAccountStatus = (status?: string) => {
    switch (status) {
      case 'OPEN':
        return 'Abierta';
      case 'CLOSED':
        return 'Cerrada';
      default:
        return formatRawCode(status);
    }
  };
  const formatItemType = (type?: string) => {
    switch (type) {
      case 'PRODUCT':
        return 'Producto';
      case 'BOOKING':
        return 'Reserva';
      case 'SERVICE':
        return 'Servicio';
      case 'ADJUSTMENT':
        return 'Ajuste';
      default:
        return formatRawCode(type);
    }
  };
  const formatPaymentMethod = (method?: string) => {
    switch (method) {
      case 'CASH':
        return 'Efectivo';
      case 'TRANSFER':
        return 'Transferencia';
      case 'CARD':
        return 'Tarjeta';
      case 'OTHER':
        return 'Otro';
      default:
        return formatRawCode(method);
    }
  };
  const formatPaymentSource = (source?: string) => {
    switch (source) {
      case 'POS':
        return 'Mostrador (POS)';
      case 'ONLINE':
        return 'En línea';
      case 'BACKOFFICE':
        return 'Administración';
      default:
        return formatRawCode(source);
    }
  };
  const formatPaymentChannel = (channel?: string) => {
    switch (channel) {
      case 'CASH_DRAWER':
        return 'Caja';
      case 'BANK_ACCOUNT':
        return 'Cuenta bancaria';
      case 'CARD_TERMINAL':
        return 'Terminal tarjeta';
      case 'VIRTUAL_WALLET':
        return 'Billetera virtual';
      case 'AUTO':
        return 'Automático';
      case 'OTHER':
        return 'Otro';
      default:
        return formatRawCode(channel);
    }
  };

  const isSelectedAccountClosed =
    String(detail?.status || detail?.accountStatus || '').toUpperCase() === 'CLOSED';

  useEffect(() => {
    if (!isSelectedAccountClosed) return;
    setShowPaymentCalculator(false);
    setShowCloseAccountConfirm(false);
    setShowRefundModal(false);
    setNewItem({ description: '', quantity: 1, unitPrice: 0, type: 'PRODUCT' });
    setPayment({
      channel: 'AUTO',
      collectorAccountLabel: '',
      externalReference: '',
      source: 'POS'
    });
  }, [isSelectedAccountClosed]);

  const handleSelectProduct = (product: ProductSearchItem) => {
    setNewItem((prev) => ({
      ...prev,
      description: product.name,
      unitPrice: Number(product.price || 0),
      type: 'PRODUCT'
    }));
  };

  const openClosedAccountDetail = useCallback(async (accountId: string) => {
    try {
      setLoadingClosedAccountDetail(true);
      setSelectedClosedAccountId(accountId);
      setShowClosedAccountModal(true);
      setSelectedClosedAccountDetail(null);
      const data = await getAccountById(accountId);
      setSelectedClosedAccountDetail(data);
    } catch (err: any) {
      setShowClosedAccountModal(false);
      setError(err?.message || 'No se pudo cargar el detalle de la cuenta cerrada');
    } finally {
      setLoadingClosedAccountDetail(false);
    }
  }, []);

  const handleCalculatorPaymentConfirm = async (result: PaymentCalculatorResult) => {
    try {
      if (!selectedId) return;
      setSubmittingCalculator(true);

      const itemAllocationMap = new Map<string, number>(
        (result.itemAllocations || [])
          .map((entry) => [String(entry.key), Number(entry.amount || 0)] as const)
          .filter(([, amount]) => amount > 0.009)
      );

      const allocations: Array<{ accountItemId: string; amount: number }> = [];

      for (const item of consumptionPendingItems) {
        const allocated = Number(itemAllocationMap.get(String(item.id)) || 0);
        if (allocated > 0.009) {
          allocations.push({
            accountItemId: String(item.id),
            amount: Number(Math.min(item.remaining, allocated).toFixed(2))
          });
        }
      }

      let remainingCourtToAllocate = Math.max(0, Number(result.courtAmount || 0));
      for (const item of bookingPendingItems) {
        if (remainingCourtToAllocate <= 0.009) break;
        const amount = Math.min(item.remaining, remainingCourtToAllocate);
        if (amount > 0.009) {
          allocations.push({
            accountItemId: String(item.id),
            amount: Number(amount.toFixed(2))
          });
          remainingCourtToAllocate = Number((remainingCourtToAllocate - amount).toFixed(2));
        }
      }

      const fallbackChannel = payment.channel !== 'AUTO' ? payment.channel : undefined;

      await registerPayment({
        accountId: selectedId,
        amount: Number(result.amount || 0),
        method: result.method,
        channel: result.channel || fallbackChannel,
        collectorAccountLabel: payment.collectorAccountLabel,
        externalReference: payment.externalReference,
        source: payment.source,
        allocations: allocations.length > 0 ? allocations : undefined
      });

      setShowPaymentCalculator(false);
      await loadDetail(selectedId);
      await refreshLists();
    } catch (err: any) {
      setError(err?.message || 'No se pudo registrar el pago con calculadora');
    } finally {
      setSubmittingCalculator(false);
    }
  };

  const openRefundModal = (paymentId: string, amount: number) => {
    setRefundPaymentId(paymentId);
    setRefundPaymentMaxAmount(amount);
    setRefundDraft(buildDefaultRefundDraft('ACCOUNT_MANUAL', amount));
    setShowRefundModal(true);
  };

  const closeRefundModal = () => {
    if (submittingRefund) return;
    setShowRefundModal(false);
  };

  const submitRefundModal = async () => {
    try {
      const validation = validateRefundAmountInput(refundDraft.amountInput, refundPaymentMaxAmount);
      if (validation.error) throw new Error(validation.error);
      if (!refundPaymentId) {
        throw new Error('Pago invalido');
      }
      setSubmittingRefund(true);
      await requestManualRefund(refundPaymentId, refundDraft, refundPaymentMaxAmount, 'Devolucion solicitada desde cuentas');
      await loadDetail(selectedId);
      await refreshLists();
      setShowRefundModal(false);
    } catch (err: any) {
      setError(err.message || 'No se pudo solicitar devolucion');
    } finally {
      setSubmittingRefund(false);
    }
  };

  return (
    <AdminLayout>
      <Head>
        <title>Cuentas | TuCancha Admin</title>
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
              <option value="MANUAL">Manual</option>
              <option value="BAR">Bar</option>
              <option value="TABLE">Mesa</option>
              <option value="BOOKING">Reserva</option>
            </select>
            <input
              value={newAccount.sourceId}
              onChange={(e) => setNewAccount((prev) => ({ ...prev, sourceId: e.target.value }))}
              placeholder="ID de origen"
              className="w-full h-10 border rounded-lg px-3"
            />
            <button
              onClick={async () => {
                try {
                  await openAccount({
                    sourceType: newAccount.sourceType,
                    sourceId: newAccount.sourceId || `manual-${Date.now()}`
                  });
                  await refreshLists();
                } catch (err: any) {
                  setError(err?.message || 'No se pudo crear la cuenta');
                }
              }}
              className="w-full h-10 rounded-lg bg-[#347048] text-[#EBE1D8] font-black text-xs uppercase"
            >
              Crear
            </button>
          </div>

          <div className="rounded-2xl border border-[#347048]/10 bg-white p-4 lg:col-span-2">
            <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60 mb-3">Cuentas abiertas</p>
            <input
              value={openAccountsSearch}
              onChange={(e) => setOpenAccountsSearch(e.target.value)}
              placeholder="Buscar por cliente, cancha, origen o ID"
              className="w-full h-10 border rounded-lg px-3 mb-3 text-sm"
            />
            <div className="space-y-2 max-h-44 overflow-y-auto">
              {filteredOpenAccounts.map((account) => (
                <button
                  key={account.id}
                  onClick={() => setSelectedId(account.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border ${selectedId === account.id ? 'bg-[#347048] text-[#EBE1D8] border-[#347048]' : 'bg-white border-[#347048]/20 text-[#347048]'}`}
                >
                  <div className="text-xs font-black uppercase tracking-wider">
                    {account.sourceType === 'BOOKING' && account.booking
                      ? `${account.booking.clientName || 'Sin cliente'} · ${formatBookingDateTime(account.booking.startDateTime)} · ${account.booking.courtName || 'Sin cancha'}`
                      : `${formatAccountSourceType(account.sourceType)} · ${account.sourceId}`}
                  </div>
                  <div className="text-xs">Estado: {formatAccountStatus(account.status)}</div>
                </button>
              ))}
              {filteredOpenAccounts.length === 0 && <div className="text-xs font-bold text-[#347048]/50">No hay cuentas abiertas para ese filtro.</div>}
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

            {isSelectedAccountClosed && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                Cuenta cerrada: solo lectura.
              </div>
            )}

            {!isSelectedAccountClosed && (
              <>
                <details className="rounded-xl border border-[#347048]/10 p-3 space-y-2">
                  <summary className="cursor-pointer text-[11px] font-black text-[#347048]">Cargar consumos</summary>
                  <div className="space-y-2 pt-2">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Producto del club</p>
                      <ProductSearch
                        products={products}
                        onSelect={handleSelectProduct}
                        minQueryLength={1}
                        maxResults={12}
                        disabled={productsLoading || !clubSlug}
                        placeholder={productsLoading ? 'Cargando productos...' : clubSlug ? 'Buscar producto por nombre...' : 'No se detectó club para cargar productos'}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <input placeholder="Descripción" value={newItem.description} onChange={(e) => setNewItem((prev) => ({ ...prev, description: e.target.value }))} className="h-10 border rounded-lg px-3" />
                      <input type="number" min={1} value={newItem.quantity} onChange={(e) => setNewItem((prev) => ({ ...prev, quantity: Number(e.target.value) }))} className="h-10 border rounded-lg px-3" />
                      <input type="number" min={0} step="0.01" value={newItem.unitPrice} onChange={(e) => setNewItem((prev) => ({ ...prev, unitPrice: Number(e.target.value) }))} className="h-10 border rounded-lg px-3" />
                      <select value={newItem.type} onChange={(e) => setNewItem((prev) => ({ ...prev, type: e.target.value as any }))} className="h-10 border rounded-lg px-3">
                        <option value="PRODUCT">Producto</option>
                        <option value="BOOKING">Reserva</option>
                        <option value="SERVICE">Servicio</option>
                        <option value="ADJUSTMENT">Ajuste</option>
                      </select>
                      <button
                        onClick={async () => {
                          try {
                            await addAccountItem(selectedId, newItem);
                            setNewItem({ description: '', quantity: 1, unitPrice: 0, type: 'PRODUCT' });
                            await loadDetail(selectedId);
                            await refreshLists();
                          } catch (err: any) {
                            setError(err?.message || 'No se pudo agregar el consumo');
                          }
                        }}
                        className="h-10 rounded-lg bg-[#926699] text-[#EBE1D8] text-xs font-black uppercase md:col-span-4"
                      >
                        Agregar consumo
                      </button>
                    </div>
                  </div>
                </details>

                <details className="rounded-xl border border-[#347048]/10 p-3 space-y-2">
                  <summary className="cursor-pointer text-[11px] font-black text-[#347048]">Items pendientes</summary>
                  <div className="space-y-1 max-h-32 overflow-y-auto text-xs pt-2">
                    {(detail.items || []).map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between border border-[#347048]/10 rounded-lg px-2 py-1">
                        <span className="font-bold">{item.description} · {formatItemType(item.type)}</span>
                        <span className="text-[#347048]/70">Pendiente: ${Number(itemOutstandingMap.get(String(item.id)) || 0).toLocaleString()}</span>
                      </div>
                    ))}
                    {(!detail.items || detail.items.length === 0) && <div className="text-[#347048]/50">Sin items.</div>}
                  </div>
                </details>

                <div className="rounded-xl border border-[#347048]/10 p-3 space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Registrar pago (recomendado)</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <select value={payment.channel} onChange={(e) => setPayment((prev) => ({ ...prev, channel: e.target.value as PaymentChannel }))} className="h-10 border rounded-lg px-3">
                      <option value="AUTO">Canal automático</option>
                      <option value="BANK_ACCOUNT">Cuenta bancaria</option>
                      <option value="VIRTUAL_WALLET">Billetera virtual</option>
                    </select>
                    <input
                      type="text"
                      value={payment.collectorAccountLabel}
                      onChange={(e) => setPayment((prev) => ({ ...prev, collectorAccountLabel: e.target.value }))}
                      className="h-10 border rounded-lg px-3"
                      placeholder="Cuenta receptora (opcional)"
                    />
                    <input
                      type="text"
                      value={payment.externalReference}
                      onChange={(e) => setPayment((prev) => ({ ...prev, externalReference: e.target.value }))}
                      className="h-10 border rounded-lg px-3"
                      placeholder="Referencia externa"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <select value={payment.source} onChange={(e) => setPayment((prev) => ({ ...prev, source: e.target.value as PaymentSource }))} className="h-10 border rounded-lg px-3">
                      <option value="POS">Mostrador (POS)</option>
                      <option value="ONLINE">En línea</option>
                      <option value="BACKOFFICE">Administración</option>
                    </select>
                    <button
                      onClick={() => setShowPaymentCalculator(true)}
                      disabled={paymentCalculatorContext.totalPending <= 0.009}
                      className="h-10 rounded-lg bg-[#347048] disabled:opacity-60 disabled:cursor-not-allowed text-[#EBE1D8] text-xs font-black uppercase"
                    >
                      Abrir calculadora de cobro
                    </button>
                  </div>
                  <p className="text-[11px] font-bold text-[#347048]/60">
                    Pendiente calculado: ${paymentCalculatorContext.totalPending.toLocaleString()}.
                  </p>
                </div>

                <button
                  onClick={() => setShowCloseAccountConfirm(true)}
                  className="h-10 rounded-lg bg-[#B9CF32] text-[#347048] text-xs font-black uppercase"
                >
                  Cerrar cuenta
                </button>
              </>
            )}

            <details className="rounded-xl border border-[#347048]/10 p-3 space-y-2" open={isSelectedAccountClosed}>
              <summary className="cursor-pointer text-[11px] font-black text-[#347048]">Historial de pagos y devoluciones</summary>
              <div className="space-y-1 max-h-40 overflow-y-auto text-xs">
                {(detail.payments || []).map((entry: any) => {
                  const paymentId = String(entry?.id || '');
                  if (!paymentId) return null;
                  const amount = Number(entry?.amount || 0);
                  return (
                    <div key={paymentId} className="flex items-center justify-between gap-2 border border-[#347048]/10 rounded-lg px-2 py-1">
                      <div className="min-w-0">
                        <p className="font-black truncate">{paymentId}</p>
                        <p className="text-[#347048]/70 truncate">{formatPaymentMethod(entry.method)} · {formatPaymentChannel(entry.channel)} · {formatPaymentSource(entry.source)} · ${amount.toLocaleString()}</p>
                        {(entry.collectorAccountLabel || entry.externalReference) && (
                          <p className="text-[#347048]/50 truncate">
                            {entry.collectorAccountLabel ? `Cuenta: ${entry.collectorAccountLabel}` : ''}{entry.collectorAccountLabel && entry.externalReference ? ' · ' : ''}{entry.externalReference ? `Ref: ${entry.externalReference}` : ''}
                          </p>
                        )}
                      </div>
                      {!isSelectedAccountClosed && (
                        <button
                          type="button"
                          onClick={() => openRefundModal(paymentId, amount)}
                          className="h-8 rounded-lg border border-[#347048]/20 px-2 text-[10px] font-black uppercase"
                        >
                          Solicitar devolución
                        </button>
                      )}
                    </div>
                  );
                })}
                {(!detail.payments || detail.payments.length === 0) && <div className="text-[#347048]/50">Sin pagos.</div>}
              </div>
            </details>

          </div>
        )}

        <div className="rounded-2xl border border-[#347048]/10 bg-white p-4">
          <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60 mb-2">Cuentas cerradas</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {visibleClosedAccounts.map((account) => (
              <button
                type="button"
                key={account.id}
                onClick={() => void openClosedAccountDetail(account.id)}
                className={`w-full text-left border rounded-lg px-3 py-2 text-xs ${
                  selectedClosedAccountId === account.id && showClosedAccountModal
                    ? 'bg-[#347048] text-[#EBE1D8] border-[#347048]'
                    : 'border-[#347048]/15 text-[#347048]'
                }`}
              >
                <div className="font-black uppercase">
                  {account.sourceType === 'BOOKING' && account.booking
                    ? `${account.booking.clientName || 'Sin cliente'} · ${formatBookingDateTime(account.booking.startDateTime)} · ${account.booking.courtName || 'Sin cancha'}`
                    : `${formatAccountSourceType(account.sourceType)} · ${account.sourceId}`}
                </div>
                <div>Estado: {formatAccountStatus(account.status)}</div>
              </button>
            ))}
            {!loading && closedAccounts.length === 0 && <div className="text-xs font-bold text-[#347048]/50">No hay cuentas cerradas.</div>}
          </div>
          {hasMoreClosedAccounts && (
            <button
              type="button"
              onClick={() => setClosedVisibleCount((prev) => prev + 12)}
              className="mt-3 h-9 px-3 rounded-lg border border-[#347048]/20 text-xs font-black uppercase text-[#347048]"
            >
              Ver más
            </button>
          )}
          {closedVisibleCount > 12 && (
            <button
              type="button"
              onClick={() => setClosedVisibleCount(12)}
              className="mt-3 ml-2 h-9 px-3 rounded-lg border border-[#347048]/20 text-xs font-black uppercase text-[#347048]"
            >
              Ver menos
            </button>
          )}
        </div>
      </div>

      {showPaymentCalculator && detail && (
        <PaymentCalculator
          courtPending={paymentCalculatorContext.courtPending}
          courtBaseTotal={paymentCalculatorContext.courtPending}
          cartItems={paymentCalculatorContext.cartItems}
          alreadyPaid={0}
          grandTotal={paymentCalculatorContext.totalPending}
          onClose={() => {
            if (submittingCalculator) return;
            setShowPaymentCalculator(false);
          }}
          onConfirm={handleCalculatorPaymentConfirm}
          submitting={submittingCalculator}
          zIndexClass="z-[100005]"
        />
      )}

      <RefundRequestModal
        show={showRefundModal}
        title="Solicitar devolucion"
        paymentId={refundPaymentId}
        maxAmount={refundPaymentMaxAmount}
        draft={refundDraft}
        submitting={submittingRefund}
        onClose={closeRefundModal}
        onSubmit={submitRefundModal}
        onChangeDraft={setRefundDraft}
        submitLabel="Confirmar devolucion"
      />

      <AppModal
        show={showClosedAccountModal}
        title="Detalle de cuenta cerrada"
        message={
          loadingClosedAccountDetail ? (
            <div className="text-sm font-bold text-[#347048]/70">Cargando detalle...</div>
          ) : selectedClosedAccountDetail ? (
            <div className="space-y-3 text-sm text-[#347048]">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="font-black">Origen:</span>{' '}
                  {formatAccountSourceType(
                    selectedClosedAccountDetail?.sourceType ||
                    selectedClosedAccountDetail?.account?.sourceType ||
                    selectedClosedAccountDetail?.source ||
                    undefined
                  )}
                </div>
                <div>
                  <span className="font-black">Estado:</span>{' '}
                  {formatAccountStatus(
                    selectedClosedAccountDetail?.status ||
                    selectedClosedAccountDetail?.accountStatus ||
                    selectedClosedAccountDetail?.account?.status ||
                    undefined
                  )}
                </div>
                <div><span className="font-black">Total:</span> ${Number(selectedClosedAccountDetail?.total || 0).toLocaleString()}</div>
                <div><span className="font-black">Pagado:</span> ${Number(selectedClosedAccountDetail?.paid || 0).toLocaleString()}</div>
              </div>
              <div className="rounded-lg border border-[#347048]/10 p-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Items</div>
                <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                  {(selectedClosedAccountDetail?.items || []).map((item: any, index: number) => (
                    <div key={String(item?.id || `item-${index}`)} className="flex items-center justify-between">
                      <span>{item?.description || 'Concepto'} · {formatItemType(item?.type)}</span>
                      <span className="font-bold">${Number(item?.total || 0).toLocaleString()}</span>
                    </div>
                  ))}
                  {(!selectedClosedAccountDetail?.items || selectedClosedAccountDetail.items.length === 0) && (
                    <div className="text-[#347048]/50">Sin items.</div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-[#347048]/10 p-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Pagos</div>
                <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
                  {(selectedClosedAccountDetail?.payments || []).map((entry: any, index: number) => (
                    <div key={String(entry?.id || `payment-${index}`)} className="flex items-center justify-between">
                      <span>{formatPaymentMethod(entry?.method)} · {formatPaymentChannel(entry?.channel)} · {formatPaymentSource(entry?.source)}</span>
                      <span className="font-bold">${Number(entry?.amount || 0).toLocaleString()}</span>
                    </div>
                  ))}
                  {(!selectedClosedAccountDetail?.payments || selectedClosedAccountDetail.payments.length === 0) && (
                    <div className="text-[#347048]/50">Sin pagos.</div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm font-bold text-[#347048]/70">Sin datos para mostrar.</div>
          )
        }
        confirmText="Cerrar"
        cancelText=""
        onClose={() => {
          if (loadingClosedAccountDetail) return;
          setShowClosedAccountModal(false);
          setSelectedClosedAccountDetail(null);
          setSelectedClosedAccountId('');
        }}
      />

      <AppModal
        show={showCloseAccountConfirm}
        title="Cerrar cuenta"
        message="Vas a cerrar la cuenta seleccionada. No vas a poder agregar consumos ni pagos después."
        confirmText={closingAccount ? 'Cerrando...' : 'Sí, cerrar cuenta'}
        cancelText="Cancelar"
        isWarning
        onClose={() => {
          if (closingAccount) return;
          setShowCloseAccountConfirm(false);
        }}
        onCancel={() => {
          if (closingAccount) return;
          setShowCloseAccountConfirm(false);
        }}
        onConfirm={async () => {
          if (closingAccount || !selectedId) return;
          try {
            setClosingAccount(true);
            setError('');
            await closeAccount(selectedId);
            setDetail(null);
            setSelectedId('');
            setShowCloseAccountConfirm(false);
            await refreshLists();
          } catch (err: any) {
            const code = String(err?.code || '');
            const remaining = Number(err?.remaining || 0);
            if (code === 'ACCOUNT_HAS_PENDING_BALANCE') {
              const remainingLabel = Number.isFinite(remaining) && remaining > 0
                ? `Saldo pendiente actual: $${remaining.toLocaleString()}. `
                : '';
              setShowCloseAccountConfirm(false);
              setCloseBlockedModal({
                show: true,
                message: `${remainingLabel}Para cerrar la cuenta primero registrá el pago pendiente o ajustá consumos.`
              });
            } else {
              setError(err?.message || 'No se pudo cerrar la cuenta');
            }
          } finally {
            setClosingAccount(false);
          }
        }}
      />

      <AppModal
        show={closeBlockedModal.show}
        title="No se pudo cerrar la cuenta"
        message={closeBlockedModal.message}
        isWarning
        confirmText="Entendido"
        cancelText=""
        onClose={() => setCloseBlockedModal({ show: false, message: '' })}
      />
    </AdminLayout>
  );
}
