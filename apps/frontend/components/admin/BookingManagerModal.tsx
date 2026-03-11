import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Receipt, Trash2, X } from 'lucide-react';
import { ClubAdminService } from '../../services/ClubAdminService';
import {
  confirmBooking,
  getBookingFinancialSummary,
  registerBookingPartialPayment,
  type BookingFinancialSummary
} from '../../services/BookingService';
import PaymentCalculator, { type PaymentCalculatorResult } from '../PaymentCalculator';
import ProductSearch, { type ProductSearchItem } from '../ui/ProductSearch';
import { formatDateTime24 } from '../../utils/dateTime';

type Props = {
  booking: any;
  clubSlug: string;
  courtName?: string;
  onClose: () => void;
  onCancelBooking: (booking: any) => void;
  onUpdated: () => void;
};

type CartItem = {
  id?: number;
  tempId?: string;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  paymentMethod?: 'CASH' | 'TRANSFER' | null;
  isNew: boolean;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString()}`;
const formatBookingStatus = (status?: string) => {
  if (status === 'PENDING') return 'Pendiente';
  if (status === 'CONFIRMED') return 'Confirmada';
  if (status === 'COMPLETED') return 'Finalizada';
  if (status === 'CANCELLED') return 'Cancelada';
  return status || 'Pendiente';
};
const formatConfirmationMode = (mode?: BookingFinancialSummary['confirmationMode']) => {
  if (mode === 'AUTOMATIC') return 'Automática';
  if (mode === 'MANUAL') return 'Manual';
  if (mode === 'DEPOSIT_REQUIRED') return 'Con seña';
  return 'Manual';
};
const formatPaymentStatus = (status?: BookingFinancialSummary['paymentStatus']) => {
  if (status === 'PAID') return 'Pagado';
  if (status === 'PARTIAL') return 'Parcial';
  return 'Sin pago';
};

const formatAutoCancelAt = (value?: string | null) => {
  return formatDateTime24(value, { fallback: 'Sin hora definida' });
};

export default function BookingManagerModal({ booking, clubSlug, courtName, onClose, onCancelBooking, onUpdated }: Props) {
  const bookingId = Number(booking?.id);
  const [products, setProducts] = useState<ProductSearchItem[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [itemsToDelete, setItemsToDelete] = useState<number[]>([]);
  const [summary, setSummary] = useState<BookingFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showPaymentCalculator, setShowPaymentCalculator] = useState(false);
  const paymentInFlightRef = useRef(false);

  const isCancelled = booking?.status === 'CANCELLED';

  const loadData = useCallback(async () => {
    if (!clubSlug || !bookingId) return;
    try {
      setLoading(true);
      const [productsData, currentItems, financial] = await Promise.all([
        ClubAdminService.getProducts(clubSlug),
        ClubAdminService.getBookingItems(bookingId),
        getBookingFinancialSummary(bookingId)
      ]);

      setProducts(Array.isArray(productsData) ? productsData : []);
      const formattedItems = (currentItems || []).map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product?.name ?? item.productName ?? 'Producto',
        quantity: Number(item.quantity || 1),
        price: Number(item.price || 0),
        paymentMethod: item.paymentMethod ?? null,
        isNew: false
      }));
      setCartItems(formattedItems);
      setItemsToDelete([]);
      setSummary(financial || null);
      setActionError(null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [bookingId, clubSlug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const draftTotal = useMemo(() => {
    return cartItems
      .filter((i) => i.isNew)
      .reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0);
  }, [cartItems]);

  const courtTotal = Number(summary?.courtTotal || booking?.price || 0);
  const itemsRegisteredTotal = Number(summary?.itemsTotal || 0);
  const paidTotal = Number(summary?.paid || 0);
  const remainingCourt = Math.max(0, Number(summary?.remaining || 0));
  const grandTotalToRegister = remainingCourt + draftTotal;

  const handleAddProductToDraft = (product: ProductSearchItem) => {
    if (!product?.id) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const outOfStock = Number((product as any)?.stock ?? 1) <= 0;
    if (outOfStock) return;

    const newItem: CartItem = {
      tempId: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      productId: product.id,
      productName: product.name,
      quantity: qty,
      price: Number(product.price || 0),
      isNew: true
    };
    setCartItems((prev) => [...prev, newItem]);
    setQuantity(1);
  };

  const handleRemove = (item: CartItem) => {
    if (!item) return;
    if (!item.isNew && item.id) {
      setItemsToDelete((prev) => [...prev, item.id!]);
    }
    setCartItems((prev) => prev.filter((i) => (item.isNew ? i.tempId !== item.tempId : i.id !== item.id)));
  };

  const handlePaymentConfirm = async (result: PaymentCalculatorResult) => {
    if (paymentInFlightRef.current) return;
    paymentInFlightRef.current = true;

    try {
      setSaving(true);

      const deletePromises = itemsToDelete.map((id) => ClubAdminService.removeItemFromBooking(id));
      await Promise.all(deletePromises);
      setItemsToDelete([]);

      const newItems = cartItems.filter((i) => i.isNew);
      const selectedKeys = new Set((result.selectedItemKeys || []).map((k) => String(k)));
      const selectedItems = newItems.filter((i) => selectedKeys.has(String(i.tempId || i.id || '')));

      const persistedSelected: CartItem[] = [];
      for (const item of selectedItems) {
        const created = await ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity, result.method);
        persistedSelected.push({
          id: created?.id,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
          paymentMethod: result.method,
          isNew: false
        });
      }

      const paidItemsAmount = selectedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const courtPortion = Math.max(0, Number((result as any).courtAmount || 0));
      const expectedAmount = paidItemsAmount + courtPortion;
      if (Math.abs(expectedAmount - Number(result.amount || 0)) > 0.01) {
        throw new Error('El monto registrado no coincide con los conceptos seleccionados. Reintentá.');
      }

      if (courtPortion > 0.01) {
        await registerBookingPartialPayment(bookingId, courtPortion, result.method);
      }

      const selectedTempKeys = new Set(selectedItems.map((i) => String(i.tempId || i.id || '')));
      setCartItems((prev) => {
        const remaining = prev.filter((i) => !i.isNew || !selectedTempKeys.has(String(i.tempId || i.id || '')));
        return [...remaining, ...persistedSelected];
      });

      const updated = await getBookingFinancialSummary(bookingId);
      setSummary(updated || null);
      setShowPaymentCalculator(false);
      onUpdated();
    } catch (e: any) {
      const message = e?.message || 'No se pudo registrar el pago';
      alert(`Error: ${message}`);
    } finally {
      setSaving(false);
      paymentInFlightRef.current = false;
    }
  };

  const bookingTitle = courtName || booking?.court?.name || 'Cancha';
  const clientName = booking?.client?.name || 'Sin cliente vinculado';
  const clientPhone = booking?.client?.phone || '';
  const bookingStatus = String(booking?.status || 'PENDING');
  const canManualConfirm = bookingStatus === 'PENDING';

  const handleManualConfirm = async () => {
    if (!canManualConfirm) return;
    try {
      setConfirming(true);
      setActionError(null);
      setActionMessage(null);
      await confirmBooking(bookingId);
      setActionMessage('Reserva confirmada correctamente.');
      await loadData();
      onUpdated();
    } catch (error: any) {
      setActionError(error?.message || 'No se pudo confirmar la reserva');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="relative text-[#347048]">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-2xl font-black uppercase italic tracking-tight">Ficha del Turno</h3>
          <p className="text-xs font-bold uppercase tracking-widest text-[#347048]/50 mt-1">{bookingTitle}</p>
        </div>
        <button
          onClick={onClose}
          className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
          title="Cerrar"
        >
          <X size={20} strokeWidth={3} />
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* IZQUIERDA: CUENTA */}
        <div className="col-span-12 lg:col-span-7 lg:pr-6 lg:border-r lg:border-[#347048]/10 space-y-5">
          <div className="rounded-2xl border border-[#347048]/10 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Reservante</p>
            <p className="text-lg font-black mt-1">{clientName}</p>
            {clientPhone ? <p className="text-xs font-bold text-[#347048]/60 mt-1">{clientPhone}</p> : null}
          </div>

          <div className="bg-white/40 p-4 rounded-2xl border border-white/60">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-3">
              Agregar consumos / extras
            </p>
            <div className="flex gap-3 items-center">
              <div className="flex-1">
                <ProductSearch
                  products={products}
                  autoFocus
                  disabled={loading || saving || isCancelled}
                  placeholder={loading ? 'Cargando productos...' : 'Agregar producto (ej: Gatorade)...'}
                  onSelect={handleAddProductToDraft}
                />
              </div>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-20 h-12 bg-white border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-xl px-2 text-center text-[#347048] font-black shadow-sm outline-none"
                disabled={saving || isCancelled}
              />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-[#347048]/10 overflow-hidden">
            <div className="p-4 flex items-center justify-between bg-[#347048]/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Alquiler de cancha</span>
              <span className="font-black">{formatMoney(courtTotal)}</span>
            </div>

            {cartItems.length === 0 ? (
              <div className="p-10 text-center opacity-40">
                <Receipt size={32} className="mx-auto mb-2" />
                <p className="text-xs font-black uppercase tracking-widest">Sin consumos cargados</p>
              </div>
            ) : (
              <div className="divide-y divide-[#347048]/5">
                {cartItems.map((item) => (
                  <div key={item.isNew ? item.tempId : item.id} className={`p-4 flex items-center justify-between ${item.isNew ? '' : 'opacity-70'}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-black truncate">
                        {item.quantity}x {item.productName}
                      </p>
                      {!item.isNew && item.paymentMethod ? (
                        <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/50 mt-1">
                          Pagado ({item.paymentMethod === 'CASH' ? 'Efectivo' : 'Digital'})
                        </p>
                      ) : item.isNew ? (
                        <p className="text-[9px] font-black uppercase tracking-widest text-[#B9CF32] mt-1">Pendiente de cobro</p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-black text-sm">{formatMoney(item.price * item.quantity)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        className="p-2 rounded-xl text-red-500 hover:bg-red-50 transition"
                        title="Quitar"
                        disabled={saving || (!item.isNew && !item.id) || isCancelled}
                      >
                        <Trash2 size={18} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* DERECHA: RESUMEN / PAGO */}
        <div className="col-span-12 lg:col-span-5">
          <div className="bg-white/50 border border-white/60 rounded-[2rem] p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-4">Estado de cuenta</p>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 pb-2">
                <div className="rounded-xl bg-white border border-[#347048]/10 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Estado reserva</p>
                  <p className="text-[11px] font-black uppercase tracking-wide text-[#347048] mt-1">
                    {formatBookingStatus(bookingStatus)}
                  </p>
                </div>
                <div className="rounded-xl bg-white border border-[#347048]/10 px-3 py-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Confirmación</p>
                  <p className="text-[11px] font-black uppercase tracking-wide text-[#347048] mt-1">
                    {formatConfirmationMode(summary?.confirmationMode)}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-white border border-[#347048]/10 px-3 py-2 mb-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Estado de pago</p>
                <p className="text-[11px] font-black uppercase tracking-wide text-[#347048] mt-1">
                  {formatPaymentStatus(summary?.paymentStatus)}
                </p>
              </div>

              {summary?.confirmationMode === 'DEPOSIT_REQUIRED' ? (
                <div className="rounded-xl bg-white border border-[#347048]/10 px-3 py-2 mb-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Seña requerida</p>
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-[11px] font-black uppercase tracking-wide text-[#347048]">
                      {formatMoney(Number(summary.depositRequiredAmount || 0))}
                    </p>
                    <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border ${summary.depositCovered ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>
                      {summary.depositCovered ? 'Cubierta' : 'No cubierta'}
                    </span>
                  </div>
                </div>
              ) : null}

              {summary?.confirmationMode === 'DEPOSIT_REQUIRED' ? (
                <div className="rounded-xl bg-white border border-[#347048]/10 px-3 py-2 mb-2">
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Confirmacion por pago</p>
                  <div className="mt-1 space-y-1 text-[11px] font-black uppercase tracking-wide text-[#347048]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#347048]/60">Pagado</span>
                      <span>{formatMoney(Number(summary.paid || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#347048]/60">Requerido para confirmar</span>
                      <span>{formatMoney(Number(summary.requiredToConfirm || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#347048]/60">Restante para confirmar</span>
                      <span>{formatMoney(Number(summary.remainingToConfirm || 0))}</span>
                    </div>
                  </div>
                  {summary.isPendingByInsufficientPayment ? (
                    <div className="mt-2 rounded-lg border border-yellow-200 bg-yellow-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-yellow-700">
                      Pendiente de confirmacion por pago insuficiente
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="rounded-xl bg-white border border-[#347048]/10 px-3 py-2 mb-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Auto-cancelacion</p>
                <p className="text-[11px] font-black uppercase tracking-wide text-[#347048] mt-1">
                  {summary?.autoCancelStatus?.label || 'No aplica'}
                </p>
                {summary?.autoCancelStatus?.enabled ? (
                  <div className="mt-2 space-y-1 text-[10px] font-black uppercase tracking-wider text-[#347048]/70">
                    <div className="flex items-center justify-between">
                      <span>Solo impagas</span>
                      <span>{summary.autoCancelStatus.onlyIfUnpaid ? 'Si' : 'No'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Hora objetivo</span>
                      <span className="normal-case font-bold tracking-normal">{formatAutoCancelAt(summary.autoCancelStatus.autoCancelAt)}</span>
                    </div>
                  </div>
                ) : null}
                {summary?.autoCancelStatus?.blockedByPayment ? (
                  <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-blue-700">
                    No se cancelara automaticamente porque tiene pagos registrados
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-[#347048]/70">
                <span>Cancha</span>
                <span>{formatMoney(courtTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-[#347048]/70">
                <span>Extras (registrados)</span>
                <span>{formatMoney(itemsRegisteredTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-[#347048]/70">
                <span>Pagado</span>
                <span>{formatMoney(paidTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-[#926699]">
                <span>Pendiente cancha</span>
                <span>{formatMoney(remainingCourt)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-[#926699]">
                <span>Extras nuevos</span>
                <span>{formatMoney(draftTotal)}</span>
              </div>
              <div className="mt-4 pt-4 border-t border-[#347048]/10 flex items-end justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Total a registrar</span>
                <span className="text-4xl font-black italic tracking-tighter text-[#347048]">
                  {formatMoney(grandTotalToRegister)}
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {canManualConfirm ? (
                <button
                  type="button"
                  onClick={handleManualConfirm}
                  disabled={confirming || saving}
                  className="w-full flex items-center justify-center gap-2 bg-[#926699] hover:bg-[#B9CF32] text-white hover:text-[#347048] py-3 rounded-2xl font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {confirming ? 'Confirmando...' : 'Confirmar reserva'}
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => setShowPaymentCalculator(true)}
                disabled={saving || isCancelled || grandTotalToRegister <= 0.009}
                className="w-full flex items-center justify-center gap-2 bg-[#347048] hover:bg-[#B9CF32] text-white hover:text-[#347048] py-4 rounded-2xl font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Banknote size={18} strokeWidth={2.5} /> Registrar pago
              </button>

              <button
                type="button"
                onClick={() => onCancelBooking(booking)}
                className="w-full py-3 text-red-600 text-xs font-black uppercase tracking-widest border border-red-200 bg-red-50 rounded-2xl"
              >
                Cancelar reserva
              </button>

              {actionMessage ? (
                <p className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  {actionMessage}
                </p>
              ) : null}
              {actionError ? (
                <p className="text-[11px] font-black text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                  {actionError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {showPaymentCalculator && (
        <PaymentCalculator
          courtPending={remainingCourt}
          courtBaseTotal={courtTotal}
          cartItems={cartItems
            .filter((item) => item.isNew)
            .map((item) => ({
              id: item.id,
              tempId: item.tempId,
              productName: item.productName,
              quantity: item.quantity,
              price: item.price
            }))}
          alreadyPaid={0}
          grandTotal={grandTotalToRegister}
          onClose={() => setShowPaymentCalculator(false)}
          onConfirm={handlePaymentConfirm}
          submitting={saving}
        />
      )}
    </div>
  );
}

