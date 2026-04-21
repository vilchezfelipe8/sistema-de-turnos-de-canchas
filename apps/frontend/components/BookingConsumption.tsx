import { useState, useEffect, useCallback, useRef } from 'react';
import { ClubAdminService } from '../services/ClubAdminService';
import { getBookingFinancialSummary, registerBookingPartialPayment, type BookingFinancialSummary } from '../services/BookingService';
import { Trash2, Plus, ShoppingCart, Receipt, Lock, X, Banknote, Star } from 'lucide-react';
import PaymentCalculator, { type PaymentCalculatorResult } from './PaymentCalculator';
import ProductSearch, { type ProductSearchItem } from './ui/ProductSearch';
import { formatTime24 } from '../utils/dateTime';
import AppModal from './AppModal';
import { extractErrorMessage, reportUiError } from '../utils/uiError';
// import { BookingTicket } from './BookingTicket'; // Si no lo usás, podés borrar esta línea

interface Props {
  bookingId: number;
  slug: string;
  courtPrice?: number;
  baseCourtPrice?: number | null;
  bookingStatus?: string;
  paymentStatus?: string;
  onClose: () => void;
  onConfirm: () => void;
  onPaymentModalStateChange?: (open: boolean) => void;
}

interface CartItem {
  id?: string;
  tempId?: string;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  type?: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT';
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER' | null;
  isNew: boolean;
}

export default function BookingConsumption(
  { bookingId, slug, courtPrice = 0, baseCourtPrice, bookingStatus, paymentStatus, onClose, onConfirm, onPaymentModalStateChange }: Props
) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [itemsToDelete, setItemsToDelete] = useState<string[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    isWarning?: boolean;
  }>({ show: false, title: 'Información', message: '' });
  const [financialSummary, setFinancialSummary] = useState<BookingFinancialSummary | null>(null);
  const [bookingChargeItemId, setBookingChargeItemId] = useState<string | null>(null);
  const [bookingIsPendingLocal, setBookingIsPendingLocal] = useState(bookingStatus === 'PENDING');
  const paymentInFlightRef = useRef(false);

  const showErrorModal = (message: string) => {
    setFeedbackModal({
      show: true,
      title: 'Error',
      message,
      isWarning: true
    });
  };

  const showInfoModal = (message: string) => {
    setFeedbackModal({
      show: true,
      title: 'Información',
      message
    });
  };

  // Formulario
  const [quantity, setQuantity] = useState(1);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [productsData, currentItems, summary] = await Promise.all([
        ClubAdminService.getProducts(slug),
        ClubAdminService.getBookingItems(bookingId),
        getBookingFinancialSummary(bookingId)
      ]);

      setProducts(productsData || []);

      const bookingChargeItem = (currentItems || []).find((item: any) => String(item?.type || '') === 'BOOKING');
      setBookingChargeItemId(bookingChargeItem?.id ? String(bookingChargeItem.id) : null);

      const formattedItems = (currentItems || [])
        .filter((item: any) => String(item?.type || '') !== 'BOOKING')
        .map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product?.name ?? item.productName ?? item.description ?? 'Producto',
        quantity: Number(item.quantity || 1),
        price: Number(item.price || 0),
        type: item.type,
        paymentMethod: item.paymentMethod ?? null,
        isNew: false
      }));
      
      setCartItems(formattedItems);
      setFinancialSummary(summary || null);
      setItemsToDelete([]); 
    } catch (error) {
      reportUiError({ area: 'BookingConsumption', action: 'loadData' }, error);
      showErrorModal(extractErrorMessage(error, 'No se pudo cargar la información del turno.'));
    } finally {
      setLoading(false);
    }
  }, [bookingId, slug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setBookingIsPendingLocal(bookingStatus === 'PENDING');
  }, [bookingStatus]);

  useEffect(() => {
    onPaymentModalStateChange?.(showPaymentModal);
  }, [onPaymentModalStateChange, showPaymentModal]);

  const handleAddProductToDraft = (product: ProductSearchItem) => {
    if (!product?.id) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;

    const newItem: CartItem = {
      tempId: `new-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      quantity: qty,
      price: Number(product.price || 0),
      isNew: true
    };

    setCartItems((prev) => [...prev, newItem]);
    setQuantity(1);
  };

  const handleRemoveFromDraft = (item: CartItem) => {
    if (!item.isNew && item.id) {
      setItemsToDelete([...itemsToDelete, String(item.id)]);
    }
    setCartItems(cartItems.filter(i => item.isNew ? i.tempId !== item.tempId : i.id !== item.id));
  };

  const isCancelled = bookingStatus === 'CANCELLED';

  const courtTotal = Number(financialSummary?.courtTotal || 0);
  const itemsTotal = Number(financialSummary?.itemsTotal || 0);
  const paidTotal = Number(financialSummary?.paid || 0);
  const remainingTotal = Number(financialSummary?.remaining || 0);

  const courtPriceToPay = Math.max(0, remainingTotal);
  const hasCourtPaid = paidTotal > 0.01;
  const hasCourtDebtInAccount = remainingTotal > 0.01;
  const hasCourtPendingToRegister = remainingTotal > 0.01;
  const isCourtFullyPaid = remainingTotal <= 0.01;
  const isCourtOnlyPending = !hasCourtPaid && remainingTotal > 0.01;
  const isCourtOnlyInAccount = false;
  const basePrice = Number(baseCourtPrice ?? 0);
  const lightsExtra = basePrice > 0 ? Math.max(courtTotal - basePrice, 0) : 0;
  const courtBaseWithoutLights = lightsExtra > 0 ? Math.max(0, Number((courtTotal - lightsExtra).toFixed(2))) : courtTotal;
  const courtPayments: Array<{ id: number; amount: number; method: string; description?: string; date: string }> = [];

  const formatMethodLabel = (method?: string) => {
    if (method === 'CASH') return 'Efectivo';
    if (method === 'TRANSFER') return 'Transferencia';
    if (method === 'CARD') return 'Tarjeta';
    if (method === 'OTHER') return 'Otro';
    if (!method) return 'Sin método';
    return method
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const formatPaymentTime = (dateValue?: string) => {
    return formatTime24(dateValue, { fallback: '--:--' });
  };

  const consumptionTotal = cartItems
    .filter(item => item.isNew)
    .reduce((sum, item) => sum + (item.price * item.quantity), 0);

  const finalTotal = courtPriceToPay + consumptionTotal;
  const hasPendingCharges = finalTotal > 0;

  const handleCalculatedPaymentConfirm = async (result: PaymentCalculatorResult) => {
    if (paymentInFlightRef.current) {
      return;
    }

    paymentInFlightRef.current = true;

    try {
      setSaving(true);

      const deletePromises = itemsToDelete.map((id) => ClubAdminService.removeItemFromBooking(id));
      const newItems = cartItems.filter((item) => item.isNew);
      const allocationByKey = new Map(
        (result.itemAllocations || [])
          .map((entry) => [String(entry.key), Number(entry.amount || 0)] as const)
          .filter(([, amount]) => amount > 0.009)
      );
      const selectedItems = newItems.filter((item) =>
        allocationByKey.has(String(item.tempId || item.id || ''))
      );

      await Promise.all(deletePromises);
      setItemsToDelete([]);

      const persistedSelectedItems: CartItem[] = [];
      const itemAllocations: Array<{ accountItemId: string; amount: number }> = [];

      for (const item of selectedItems) {
        const created = await ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity, result.method);
        const createdId = created?.id ? String(created.id) : '';
        const itemAllocatedAmount = Number(
          allocationByKey.get(String(item.tempId || item.id || '')) || 0
        );
        if (createdId && itemAllocatedAmount > 0) {
          itemAllocations.push({
            accountItemId: createdId,
            amount: Number(itemAllocatedAmount.toFixed(2))
          });
        }
        persistedSelectedItems.push({
          id: createdId || undefined,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          price: item.price,
          type: 'PRODUCT',
          paymentMethod: result.method,
          isNew: false
        });
      }

      const paidItemsAmount = Number(
        (result.itemAllocations || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0).toFixed(2)
      );
      const courtPortion = Math.max(0, Number(result.courtAmount || 0));
      const expectedAmount = paidItemsAmount + courtPortion;
      if (Math.abs(expectedAmount - result.amount) > 0.01) {
        throw new Error('El monto registrado no coincide con los conceptos seleccionados. Reintentá.');
      }
      const paymentAmount = Math.max(0, Number(result.amount || 0));
      if (paymentAmount > 0.01) {
        const hasBookingItemForCourt = courtPortion <= 0.01 || Boolean(bookingChargeItemId);
        const allocations = [
          ...itemAllocations,
          ...(courtPortion > 0.01 && bookingChargeItemId
            ? [{ accountItemId: bookingChargeItemId, amount: Number(courtPortion.toFixed(2)) }]
            : [])
        ];
        await registerBookingPartialPayment(
          bookingId,
          paymentAmount,
          result.method,
          result.channel,
          hasBookingItemForCourt ? allocations : undefined
        );
        setBookingIsPendingLocal(false);
      }

      const selectedTempKeys = new Set(selectedItems.map((item) => String(item.tempId || item.id || '')));
      setCartItems((prev) => {
        const remaining = prev.filter((item) => !item.isNew || !selectedTempKeys.has(String(item.tempId || item.id || '')));
        return [...remaining, ...persistedSelectedItems];
      });

      const updatedSummary = await getBookingFinancialSummary(bookingId);
      setFinancialSummary(updatedSummary || null);
      onConfirm();
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo registrar el pago');

      if (String(message).toLowerCase().includes('saldo pendiente')) {
        try {
          const refreshedSummary = await getBookingFinancialSummary(bookingId);
          setFinancialSummary(refreshedSummary || null);
        } catch {
        }
        setShowPaymentModal(false);
        onConfirm();
        showInfoModal('Ese saldo ya fue cancelado. Se actualizo el estado del turno.');
      } else {
        reportUiError({ area: 'BookingConsumption', action: 'confirmPayment' }, error);
        showErrorModal(message);
      }
    } finally {
      setSaving(false);
      paymentInFlightRef.current = false;
    }
  };

  return (
    <div className="density-compact space-y-4 text-[#347048]">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h2 className="text-2xl font-black text-[#926699] uppercase italic tracking-tighter">
             Gestión de Reserva
          </h2>
          <p className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest mt-1">
             Consumos, extras y cobro
          </p>
        </div>
        <button 
          onClick={onClose}
          className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
          title="Cerrar ventana"
        >
          <X size={20} strokeWidth={3} />
        </button>
      </div>

      {/* SECCIÓN: AGREGAR CONSUMO */}
      <div className="bg-[#347048]/5 p-4 rounded-2xl border border-[#347048]/10 relative z-50">
        <h3 className="text-[#926699] font-black flex items-center gap-2 mb-4 text-xs uppercase tracking-[0.1em]">
          <ShoppingCart size={16} strokeWidth={3} /> Agregar Consumo / Extra
        </h3>
        <div className="flex gap-2.5 relative">
            <div className="flex-1">
              <ProductSearch
                products={products || []}
                autoFocus
                placeholder={loading ? 'Cargando productos...' : 'Agregar producto (ej: Gatorade)...'}
                disabled={loading || isCancelled}
                onSelect={(product) => {
                  const outOfStock = Number((product as any)?.stock ?? 1) <= 0;
                  if (outOfStock) return;
                  handleAddProductToDraft(product);
                }}
              />
            </div>

            <input 
                type="number" min="1" 
              className="compact-field w-16 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-2 text-center text-[#347048] font-black shadow-sm outline-none"
                value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}
            />
            <div className="bg-[#926699] text-[#EBE1D8] p-3 rounded-xl opacity-40 select-none">
              <Plus size={24} strokeWidth={3} />
            </div>
        </div>
      </div>

      {/* LISTA DE ITEMS */}
      <div className="bg-white/40 rounded-2xl border-2 border-dashed border-[#347048]/10 overflow-hidden min-h-[120px] relative z-0">
        {cartItems.length === 0 ? (
           <div className="flex flex-col items-center justify-center py-10 opacity-40 italic">
              <Receipt size={32} className="mb-2" />
              <p className="text-sm font-bold uppercase tracking-widest">Sin consumos cargados</p>
           </div>
        ) : (
          <div className="divide-y divide-[#347048]/5">
            {cartItems.map((item) => (
              <div 
                key={item.isNew ? item.tempId : item.id} 
                className={`flex justify-between items-center p-4 transition-colors ${item.isNew ? 'bg-white/60' : 'bg-transparent opacity-60'}`}
              >
                <div className="text-sm flex items-center">
                  <span className="font-black text-[#347048] bg-[#347048]/10 w-8 h-8 flex items-center justify-center rounded-lg mr-3 italic">{item.quantity}x</span> 
                  <div className="flex flex-col">
                    <span className="text-[#347048] font-black uppercase tracking-tight leading-none mb-1">{item.productName}</span>
                    {item.isNew ? (
                      <span className="text-[9px] text-[#B9CF32] font-black tracking-widest uppercase flex items-center gap-1">
                        <Star size={10} strokeWidth={2.5} /> Pendiente de cobro
                      </span>
                    ) : (
                      <span className={`flex items-center gap-1 text-[9px] font-black uppercase tracking-widest ${
                        item.paymentMethod === 'TRANSFER'
                            ? 'text-blue-700'
                            : item.paymentMethod === 'CASH'
                              ? 'text-emerald-700'
                                : item.paymentMethod === 'CARD'
                                  ? 'text-violet-700'
                              : 'text-[#347048]/40'
                      }`}>
                        <Lock size={8} />
                        {item.paymentMethod === 'TRANSFER'
                            ? 'Pagado transferencia'
                            : item.paymentMethod === 'CASH'
                              ? 'Pagado efectivo'
                                : item.paymentMethod === 'CARD'
                                  ? 'Pagado tarjeta'
                              : 'Estado no disponible'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`font-black text-sm ${item.isNew ? 'text-[#347048]' : 'text-[#347048]/50'}`}>${(item.price * item.quantity).toLocaleString()}</span>
                  {item.isNew ? (
                    <button onClick={() => handleRemoveFromDraft(item)} className="text-red-400 hover:text-red-600 transition p-2 hover:bg-red-50 rounded-xl"><Trash2 size={18} strokeWidth={2.5} /></button>
                  ) : <div className="w-9 flex justify-center text-[#347048]/20"><Lock size={16} /></div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TICKET FINAL */}
      <div className="bg-white border-4 border-[#B9CF32]/30 rounded-[1.5rem] p-4 shadow-sm relative overflow-hidden z-0">
        <div className="space-y-1.5 mb-4">
          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest opacity-60">
            <span>Alquiler Cancha</span>
            <div className="flex items-center gap-3">
              {isCourtFullyPaid ? (
                <span className="px-2 py-0.5 rounded-md font-black border bg-emerald-100 text-emerald-700 border-emerald-200">PAGADO</span>
              ) : isCourtOnlyInAccount ? (
                <span className="px-2 py-0.5 rounded-md font-black border bg-yellow-100 text-yellow-700 border-yellow-200">EN CUENTA</span>
              ) : isCourtOnlyPending ? (
                <span className="px-2 py-0.5 rounded-md font-black border bg-slate-100 text-slate-700 border-slate-200">PENDIENTE</span>
              ) : (
                <span className="px-2 py-0.5 rounded-md font-black border bg-blue-100 text-blue-700 border-blue-200">PARCIAL</span>
              )}
              <span className={isCourtFullyPaid ? "line-through opacity-50" : ""}>
                ${courtTotal.toLocaleString()}
              </span>
            </div>
          </div>
          {lightsExtra > 0 && (
            <>
              <div className="flex justify-between text-[10px] font-black text-[#347048]/70 uppercase tracking-widest">
                <span>Cancha base</span>
                <span>${courtBaseWithoutLights.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[10px] font-black text-[#926699] uppercase tracking-widest">
                <span>Recargo por luces</span>
                <span>+${lightsExtra.toLocaleString()}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-[10px] font-black text-[#347048]/70 uppercase tracking-widest">
            <span>Cancha pagado</span>
            <span>${paidTotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[10px] font-black text-[#347048]/70 uppercase tracking-widest">
            <span>Consumos registrados</span>
            <span>${itemsTotal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-[10px] font-black text-[#926699] uppercase tracking-widest">
            <span>Cancha pendiente (sin registrar)</span>
            <span>${remainingTotal.toLocaleString()}</span>
          </div>
          {courtPayments.length > 0 && (
            <div className="rounded-xl bg-white/70 border border-[#347048]/10 p-2 space-y-1">
              <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/50">Detalle pagos cancha</p>
              {courtPayments.map((payment) => (
                <div key={payment.id} className="flex justify-between items-center text-[10px] font-black text-[#347048]">
                  <span>{formatPaymentTime(payment.date)} • {formatMethodLabel(payment.method)}</span>
                  <span>${Number(payment.amount || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex justify-between text-[10px] font-black text-[#347048] uppercase tracking-widest">
            <span>Consumos (Nuevos)</span>
            <span>${consumptionTotal.toLocaleString()}</span>
          </div>
        </div>

          <div className="flex justify-between items-end pt-3 border-t-2 border-dashed border-[#347048]/10">
          <span className="text-[#347048]/50 font-black text-[10px] uppercase tracking-[0.2em] mb-1">Total a registrar</span>
          <span className="text-4xl font-black text-[#347048] tracking-tighter leading-none italic">
            ${finalTotal.toLocaleString()}
          </span>
        </div>
      </div>

      {/* BOTONES DE ACCIÓN */}
      <div className="grid grid-cols-1 gap-3 pt-1 relative z-0">
        <button 
          onClick={() => {
            setShowPaymentModal(true);
          }} 
          disabled={saving || !hasPendingCharges || isCancelled}
          className="compact-field flex flex-col items-center justify-center gap-1 py-3 bg-[#B9CF32] text-[#347048] font-black uppercase text-[10px] tracking-widest rounded-2xl shadow-xl shadow-[#B9CF32]/20 transition-all hover:-translate-y-1 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2"><Banknote size={18} strokeWidth={2.5} /> Registrar pago</div>
        </button>
      </div>

      {/* MODAL DE COBRO */}
      {showPaymentModal && (
        <PaymentCalculator
          courtPending={courtPriceToPay}
          courtBaseTotal={courtTotal}
          courtBreakdown={
            lightsExtra > 0
              ? {
                  baseAmount: Number(courtBaseWithoutLights || 0),
                  lightsExtraAmount: Number(lightsExtra || 0),
                  totalAmount: Number(courtTotal || 0),
                  lightsFromHour: null
                }
              : undefined
          }
          cartItems={cartItems.filter((item) => item.isNew).map((item) => ({
            id: item.id,
            tempId: item.tempId,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price
          }))}
          alreadyPaid={0}
          grandTotal={finalTotal}
          onClose={() => setShowPaymentModal(false)}
          onConfirm={handleCalculatedPaymentConfirm}
          submitting={saving}
        />
      )}

      <AppModal
        show={feedbackModal.show}
        onClose={() => setFeedbackModal((prev) => ({ ...prev, show: false }))}
        title={feedbackModal.title}
        message={feedbackModal.message}
        cancelText=""
        confirmText="Aceptar"
        isWarning={feedbackModal.isWarning}
      />
    </div>
  );
}
