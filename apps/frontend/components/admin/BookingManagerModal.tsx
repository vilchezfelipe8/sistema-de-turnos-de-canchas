import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, Receipt, Trash2, X } from 'lucide-react';
import { ClubAdminService } from '../../services/ClubAdminService';
import {
  confirmBooking,
  getBookingQuote,
  getBookingFinancialSummary,
  registerBookingPartialPayment,
  type BookingFinancialSummary,
  type BookingQuote
} from '../../services/BookingService';
import PaymentCalculator, { type PaymentCalculatorResult } from '../PaymentCalculator';
import ProductSearch, { type ProductSearchItem } from '../ui/ProductSearch';
import { formatDateTime24 } from '../../utils/dateTime';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';

type Props = {
  booking: any;
  clubSlug: string;
  courtName?: string;
  onClose: () => void;
  onCancelBooking: (booking: any) => void;
  onUpdated: () => void;
};

type CartItem = {
  id?: string;
  tempId?: string;
  productId: number;
  productName: string;
  quantity: number;
  price: number;
  listUnitPrice?: number;
  discountAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  type?: 'BOOKING' | 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT';
  paymentMethod?: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER' | null;
  discounts?: Array<{
    id: string;
    policyId?: string;
    policyName?: string | null;
    discountAmount?: number;
  }>;
  isNew: boolean;
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString()}`;
const formatBookingStatus = (status?: string) => {
  if (status === 'PENDING') return 'Pendiente';
  if (status === 'CONFIRMED') return 'Confirmada';
  if (status === 'COMPLETED') return 'Finalizada';
  if (status === 'CANCELLED') return 'Cancelada';
  if (!status) return 'Pendiente';
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
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

type NightSurchargeInfo = {
  applied: boolean;
  amount: number;
  fromHour: string | null;
};

const toMinutes = (timeValue?: string | null) => {
  if (!timeValue) return null;
  const [hh, mm] = String(timeValue).split(':').map((value) => Number(value));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
};

export default function BookingManagerModal({ booking, clubSlug, courtName, onClose, onCancelBooking, onUpdated }: Props) {
  const bookingId = Number(booking?.id);
  const [products, setProducts] = useState<ProductSearchItem[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [summary, setSummary] = useState<BookingFinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showPaymentCalculator, setShowPaymentCalculator] = useState(false);
  const [bookingChargeItemId, setBookingChargeItemId] = useState<string | null>(null);
  const [bookingChargeRemaining, setBookingChargeRemaining] = useState(0);
  const [bookingChargeDiscounts, setBookingChargeDiscounts] = useState<Array<{
    id: string;
    policyId?: string;
    policyName?: string | null;
    discountAmount?: number;
  }>>([]);
  const paymentInFlightRef = useRef(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchItem | null>(null);
  const [productSearchKey, setProductSearchKey] = useState(0);
  const [confirmationQuote, setConfirmationQuote] = useState<BookingQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [clubLightsConfig, setClubLightsConfig] = useState<{
    enabled: boolean;
    extraAmount: number;
    fromHour: string | null;
  }>({
    enabled: false,
    extraAmount: 0,
    fromHour: null
  });

  const isCancelled = booking?.status === 'CANCELLED';
  const bookingStatus = String(booking?.status || 'PENDING');
  const canManualConfirm = bookingStatus === 'PENDING';
  const canManageConsumptions = bookingStatus !== 'PENDING' && !isCancelled;
  const bookingStart = useMemo(() => {
    const raw = booking?.startDateTime;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [booking?.startDateTime]);
  const bookingDurationMinutes = useMemo(() => {
    const byField = Number(booking?.durationMinutes || 0);
    if (Number.isFinite(byField) && byField > 0) return byField;
    if (bookingStart && booking?.endDateTime) {
      const end = new Date(booking.endDateTime);
      if (!Number.isNaN(end.getTime())) {
        const diff = Math.round((end.getTime() - bookingStart.getTime()) / 60000);
        if (Number.isFinite(diff) && diff > 0) return diff;
      }
    }
    return Number(booking?.activity?.defaultDurationMinutes || booking?.activityType?.defaultDurationMinutes || 0);
  }, [booking?.durationMinutes, booking?.endDateTime, booking?.activity?.defaultDurationMinutes, booking?.activityType?.defaultDurationMinutes, bookingStart]);
  const bookingEnd = useMemo(() => {
    if (!bookingStart) return null;
    if (booking?.endDateTime) {
      const parsed = new Date(booking.endDateTime);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    if (Number.isFinite(bookingDurationMinutes) && bookingDurationMinutes > 0) {
      return new Date(bookingStart.getTime() + bookingDurationMinutes * 60000);
    }
    return null;
  }, [booking?.endDateTime, bookingDurationMinutes, bookingStart]);
  const bookingNightSurcharge = useMemo<NightSurchargeInfo>(() => {
    if (!bookingStart) return { applied: false, amount: 0, fromHour: clubLightsConfig.fromHour };
    if (!clubLightsConfig.enabled) return { applied: false, amount: 0, fromHour: clubLightsConfig.fromHour };
    if (!Number.isFinite(clubLightsConfig.extraAmount) || clubLightsConfig.extraAmount <= 0) {
      return { applied: false, amount: 0, fromHour: clubLightsConfig.fromHour };
    }
    const threshold = toMinutes(clubLightsConfig.fromHour);
    if (threshold == null) return { applied: false, amount: 0, fromHour: clubLightsConfig.fromHour };
    const bookingMinutes = bookingStart.getHours() * 60 + bookingStart.getMinutes();
    if (bookingMinutes < threshold) return { applied: false, amount: 0, fromHour: clubLightsConfig.fromHour };
    return {
      applied: true,
      amount: Number(clubLightsConfig.extraAmount || 0),
      fromHour: clubLightsConfig.fromHour
    };
  }, [bookingStart, clubLightsConfig.enabled, clubLightsConfig.extraAmount, clubLightsConfig.fromHour]);

  const loadData = useCallback(async () => {
    if (!clubSlug || !bookingId) return;
    try {
      setLoading(true);
      const [productsData, currentItems, financial, clubInfo] = await Promise.all([
        ClubAdminService.getProducts(clubSlug),
        ClubAdminService.getBookingItems(bookingId),
        getBookingFinancialSummary(bookingId),
        ClubAdminService.getClubInfo(clubSlug)
      ]);

      setProducts(Array.isArray(productsData) ? productsData : []);
      const bookingChargeItem = (currentItems || []).find((item: any) => String(item?.type || '') === 'BOOKING');
      setBookingChargeItemId(bookingChargeItem?.id ? String(bookingChargeItem.id) : null);
      setBookingChargeRemaining(
        Number(
          bookingChargeItem?.remainingAmount == null
            ? bookingChargeItem?.totalPrice || bookingChargeItem?.total || 0
            : bookingChargeItem.remainingAmount
        )
      );
      setBookingChargeDiscounts(Array.isArray(bookingChargeItem?.discounts) ? bookingChargeItem.discounts : []);

      const formattedItems = (currentItems || [])
        .filter((item: any) => String(item?.type || '') !== 'BOOKING')
        .map((item: any) => ({
        id: item.id,
        productId: item.productId,
        productName: item.product?.name ?? item.productName ?? item.description ?? 'Producto',
        quantity: Number(item.quantity || 1),
        price: Number(item.price || 0),
        paidAmount: Number(item.paidAmount || 0),
        remainingAmount: Number(item.remainingAmount == null ? item.totalPrice || 0 : item.remainingAmount),
        type: item.type,
        paymentMethod: item.paymentMethod ?? null,
        discounts: Array.isArray(item.discounts) ? item.discounts : [],
        isNew: false
      }));
      setCartItems(formattedItems);
      setSummary(financial || null);
      const settings = (clubInfo as any)?.settings ?? (clubInfo as any) ?? {};
      setClubLightsConfig({
        enabled: Boolean(settings?.lightsEnabled),
        extraAmount: Number(settings?.lightsExtraAmount || 0),
        fromHour: settings?.lightsFromHour ? String(settings.lightsFromHour) : null
      });
      setActionError(null);
      setSelectedProduct(null);
      setProductSearchKey((prev) => prev + 1);
    } catch (error) {
      reportUiError({ area: 'BookingManagerModal', action: 'loadData' }, error);
      setActionError('No se pudo cargar la información del turno.');
    } finally {
      setLoading(false);
    }
  }, [bookingId, clubSlug]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!canManualConfirm) {
      setConfirmationQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }

    const courtId = Number(booking?.courtId || booking?.court?.id || 0);
    const activityId = Number(booking?.activityId || booking?.activityTypeId || booking?.activityType?.id || booking?.activity?.id || 0);
    const startRaw = booking?.startDateTime;
    const endRaw = booking?.endDateTime;
    const startDateTime = startRaw ? new Date(startRaw) : null;
    const endDateTime = endRaw ? new Date(endRaw) : null;
    const durationFromRange = startDateTime && endDateTime
      ? Math.round((endDateTime.getTime() - startDateTime.getTime()) / 60000)
      : null;
    const durationMinutes = Number(booking?.durationMinutes || durationFromRange || 0);
    const safeGuestDni = String(booking?.client?.dni || '').replace(/\D/g, '');
    const safeGuestPhone = String(booking?.client?.phone || '').trim();
    const safeGuestEmail = String(booking?.client?.email || '').trim();

    if (!Number.isFinite(courtId) || courtId <= 0 || !Number.isFinite(activityId) || activityId <= 0 || !startDateTime || Number.isNaN(startDateTime.getTime())) {
      setConfirmationQuote(null);
      setQuoteError('No se pudo preparar la cotización previa.');
      setQuoteLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setQuoteLoading(true);
        setQuoteError(null);
        const quote = await getBookingQuote({
          courtId,
          activityId,
          startDateTime,
          ...(Number.isFinite(durationMinutes) && durationMinutes > 0 ? { durationMinutes } : {}),
          ...(safeGuestDni ? { guestDni: safeGuestDni } : {}),
          ...(safeGuestPhone ? { guestPhone: safeGuestPhone } : {}),
          ...(safeGuestEmail ? { guestEmail: safeGuestEmail } : {})
        });
        if (!cancelled) setConfirmationQuote(quote);
      } catch (error) {
        if (!cancelled) {
          setConfirmationQuote(null);
          setQuoteError(extractErrorMessage(error, 'No se pudo cotizar el descuento previo a la confirmación.'));
        }
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    canManualConfirm,
    booking?.courtId,
    booking?.court?.id,
    booking?.activityId,
    booking?.activityTypeId,
    booking?.activityType?.id,
    booking?.activity?.id,
    booking?.startDateTime,
    booking?.endDateTime,
    booking?.durationMinutes,
    booking?.client?.dni,
    booking?.client?.phone,
    booking?.client?.email
  ]);

  const draftTotal = useMemo(() => {
    return cartItems
      .filter((i) => i.isNew)
      .reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0);
  }, [cartItems]);

  const hasDraftItems = useMemo(() => {
    return cartItems.some((item) => item.isNew);
  }, [cartItems]);

  const registeredItemsPendingTotal = useMemo(() => {
    return cartItems
      .filter((i) => !i.isNew)
      .reduce((sum, i) => sum + Math.max(0, Number(i.remainingAmount || 0)), 0);
  }, [cartItems]);

  const payableItems = useMemo(() => {
    return cartItems.filter((item) => item.isNew || Number(item.remainingAmount || 0) > 0.009);
  }, [cartItems]);

  const courtTotal = Number(summary?.courtTotal || booking?.price || 0);
  const itemsRegisteredTotal = Number(summary?.itemsTotal || 0);
  const paidTotal = Number(summary?.paid || 0);
  const remainingCourt = Math.max(0, Number(bookingChargeRemaining || 0));
  const courtPaidNow = Math.max(0, Number((courtTotal - remainingCourt).toFixed(2)));
  const grandTotalToRegister = remainingCourt + registeredItemsPendingTotal + draftTotal;
  const bookingDiscountTotal = Number(
    (bookingChargeDiscounts || []).reduce((sum, discount) => sum + Number(discount?.discountAmount || 0), 0).toFixed(2)
  );
  const bookingDiscountPolicies = Array.from(
    new Set(
      (bookingChargeDiscounts || [])
        .map((discount) => String(discount?.policyName || '').trim())
        .filter(Boolean)
    )
  );
  const registeredItemsDiscountTotal = Number(
    cartItems
      .filter((item) => !item.isNew)
      .reduce(
        (sum, item) =>
          sum +
          (item.discounts || []).reduce(
            (acc, discount) => acc + Number(discount?.discountAmount || 0),
            0
          ),
        0
      )
      .toFixed(2)
  );

  const handleSelectProduct = (product: ProductSearchItem) => {
    if (!product?.id) return;
    if (!canManageConsumptions) return;
    const outOfStock = Number((product as any)?.stock ?? 1) <= 0;
    if (outOfStock) return;
    setSelectedProduct(product);
  };

  const handleAddSelectedProduct = async () => {
    if (!selectedProduct?.id) return;
    if (!canManageConsumptions) return;
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const outOfStock = Number((selectedProduct as any)?.stock ?? 1) <= 0;
    if (outOfStock) return;

    try {
      setSaving(true);
      setActionError(null);
      const quote = await ClubAdminService.quoteBookingItem(bookingId, selectedProduct.id, qty);
      const tempId = `new-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const unitPrice = Number(quote?.finalUnitPrice ?? selectedProduct.price ?? 0);
      const listUnitPrice = Number(quote?.listUnitPrice ?? selectedProduct.price ?? unitPrice);
      const discountAmount = Number(quote?.discountAmount ?? 0);
      const newItem: CartItem = {
        tempId,
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        quantity: qty,
        price: unitPrice,
        listUnitPrice,
        discountAmount,
        discounts: Array.isArray(quote?.appliedPolicies)
          ? quote.appliedPolicies.map((p: any) => ({
              id: String(p.policyId || p.policyName || 'policy'),
              policyId: String(p.policyId || ''),
              policyName: String(p.policyName || ''),
              discountAmount: Number(p.discountAmount || 0)
            }))
          : [],
        isNew: true
      };
      setCartItems((prev) => [...prev, newItem]);
      setSelectedProduct(null);
      setQuantity(1);
      setProductSearchKey((prev) => prev + 1);
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo cotizar el producto con descuento.');
      reportUiError({ area: 'BookingManagerModal', action: 'quoteBookingItem' }, error);
      setActionError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (item: CartItem) => {
    if (!item) return;
    if (saving || isCancelled) return;

    if (item.isNew) {
      setCartItems((prev) => prev.filter((i) => i.tempId !== item.tempId));
      return;
    }

    if (!item.id) return;

    try {
      setSaving(true);
      await ClubAdminService.removeItemFromBooking(String(item.id));
      await loadData();
      onUpdated();
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo eliminar el consumo');
      reportUiError({ area: 'BookingManagerModal', action: 'removeItem' }, error);
      setActionError(message);
    } finally {
      setSaving(false);
    }
  };

  const handlePaymentConfirm = async (result: PaymentCalculatorResult) => {
    if (paymentInFlightRef.current) return;
    paymentInFlightRef.current = true;

    try {
      setSaving(true);

      const newItems = cartItems.filter((i) => i.isNew);
      const existingItems = cartItems.filter((i) => !i.isNew);
      const allocationByKey = new Map(
        (result.itemAllocations || [])
          .map((entry) => [String(entry.key), Number(entry.amount || 0)] as const)
          .filter(([, amount]) => amount > 0.009)
      );
      const selectedItems = newItems.filter((i) => allocationByKey.has(String(i.tempId || i.id || '')));

      const itemAllocations: Array<{ accountItemId: string; amount: number }> = [];

      for (const item of existingItems) {
        const key = String(item.tempId || item.id || '');
        const allocated = Number(allocationByKey.get(key) || 0);
        if (item.id && allocated > 0.009) {
          itemAllocations.push({
            accountItemId: String(item.id),
            amount: Number(allocated.toFixed(2))
          });
        }
      }

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
      }

      const paidItemsAmount = Number(
        (result.itemAllocations || []).reduce((sum, entry) => sum + Number(entry.amount || 0), 0).toFixed(2)
      );
      const courtPortion = Math.max(0, Number((result as any).courtAmount || 0));
      const expectedAmount = paidItemsAmount + courtPortion;
      if (Math.abs(expectedAmount - Number(result.amount || 0)) > 0.01) {
        throw new Error('El monto registrado no coincide con los conceptos seleccionados. Reintentá.');
      }

      const paymentAmount = Math.max(0, Number(result.amount || 0));
      if (paymentAmount > 0.01) {
        const courtPortion = Math.max(0, Number((result as any).courtAmount || 0));
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
      }

      const updated = await getBookingFinancialSummary(bookingId);
      setSummary(updated || null);
      await loadData();
      setShowPaymentCalculator(false);
      onUpdated();
    } catch (error) {
      const message = extractErrorMessage(error, 'No se pudo registrar el pago');
      reportUiError({ area: 'BookingManagerModal', action: 'handlePaymentConfirm' }, error);
      setActionError(message);
    } finally {
      setSaving(false);
      paymentInFlightRef.current = false;
    }
  };

  const handleSaveDraftItems = async () => {
    if (saving || isCancelled) return;
    if (!canManageConsumptions) {
      setActionError('No se pueden cargar consumos mientras la reserva está pendiente. Confirmala primero.');
      return;
    }
    const draftItems = cartItems.filter((item) => item.isNew);
    if (draftItems.length === 0) return;

    try {
      setSaving(true);
      setActionError(null);
      setActionMessage(null);

      for (const item of draftItems) {
        await ClubAdminService.addItemToBooking(bookingId, item.productId, item.quantity, 'CASH');
      }

      await loadData();
      onUpdated();
      setActionMessage('Consumos guardados correctamente. Quedaron pendientes de cobro.');
    } catch (error: any) {
      setActionError(error?.message || 'No se pudieron guardar los consumos');
    } finally {
      setSaving(false);
    }
  };

  const bookingTitle = courtName || booking?.court?.name || 'Cancha';
  const clientName = booking?.client?.name || 'Sin cliente vinculado';
  const clientPhone = booking?.client?.phone || '';

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
            {booking?.client?.email ? <p className="text-xs font-bold text-[#347048]/60">{String(booking.client.email)}</p> : null}
            {booking?.client?.dni ? <p className="text-xs font-bold text-[#347048]/60">DNI: {String(booking.client.dni)}</p> : null}
          </div>

          <div className="rounded-2xl border border-[#347048]/10 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Datos de la reserva</p>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-black uppercase tracking-widest text-[#347048]/50">Estado</span>
                <span className="font-black">{formatBookingStatus(bookingStatus)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-black uppercase tracking-widest text-[#347048]/50">Actividad</span>
                <span className="font-black text-right">{String(booking?.activity?.name || booking?.activityType?.name || 'Actividad')}</span>
              </div>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <span className="font-black uppercase tracking-widest text-[#347048]/50">Fecha</span>
                <span className="font-black text-right">{bookingStart ? bookingStart.toLocaleDateString('es-AR') : '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3 sm:col-span-2">
                <span className="font-black uppercase tracking-widest text-[#347048]/50">Horario</span>
                <span className="font-black text-right">
                  {bookingStart ? bookingStart.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'}
                  {' - '}
                  {bookingEnd ? bookingEnd.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '--:--'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-black uppercase tracking-widest text-[#347048]/50">Duración</span>
                <span className="font-black">{Number.isFinite(bookingDurationMinutes) && bookingDurationMinutes > 0 ? `${bookingDurationMinutes} min` : '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-black uppercase tracking-widest text-[#347048]/50">Precio reserva</span>
                <span className="font-black">{formatMoney(Number(booking?.price || 0))}</span>
              </div>
              {bookingNightSurcharge.applied ? (
                <div className="flex items-center justify-between gap-3 sm:col-span-2 text-amber-700">
                  <span className="font-black uppercase tracking-widest">Recargo nocturno</span>
                  <span className="font-black text-right">
                    Aplicado (+{formatMoney(bookingNightSurcharge.amount)})
                    {bookingNightSurcharge.fromHour ? ` desde ${bookingNightSurcharge.fromHour}` : ''}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          {canManageConsumptions ? (
            <div className="bg-white/40 p-4 rounded-2xl border border-white/60">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-3">
                Agregar consumos / extras
              </p>
              <div className="flex gap-3 items-center">
                <div className="flex-1">
                  <ProductSearch
                    key={`product-search-${productSearchKey}`}
                    products={products}
                    autoFocus
                    disabled={loading || saving || isCancelled}
                    placeholder={loading ? 'Cargando productos...' : 'Agregar producto (ej: Gatorade)...'}
                    onSelect={handleSelectProduct}
                    selectedName={selectedProduct?.name}
                    onInputChange={(value) => {
                      if (!selectedProduct) return;
                      if (value.trim().toLowerCase() !== selectedProduct.name.toLowerCase()) {
                        setSelectedProduct(null);
                      }
                    }}
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
              <button
                type="button"
                onClick={() => void handleAddSelectedProduct()}
                disabled={saving || isCancelled || !selectedProduct}
                  className="h-12 px-4 rounded-xl bg-[#347048] text-white font-black uppercase tracking-widest text-[10px] shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#B9CF32] hover:text-[#347048]"
                >
                  Agregar
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-800">
              Esta reserva está <span className="font-black">pendiente</span>. Para evitar inconsistencias, los consumos/extras se cargan recién cuando la confirmás.
            </div>
          )}

          <div className="bg-white rounded-2xl border border-[#347048]/10 overflow-hidden">
            <div className="p-4 flex items-center justify-between bg-[#347048]/5">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Conceptos cobrables</span>
              <span className="font-black">{formatMoney(courtTotal + itemsRegisteredTotal + draftTotal)}</span>
            </div>

            <div className="divide-y divide-[#347048]/5">
              <div className="p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black truncate">Alquiler de cancha</p>
                  {bookingDiscountTotal > 0.009 ? (
                    <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 mt-1">
                      Descuento aplicado: -{formatMoney(bookingDiscountTotal)}
                    </p>
                  ) : null}
                  {bookingDiscountPolicies.length > 0 ? (
                    <p className="text-[9px] font-black text-[#347048]/60 mt-1 truncate">
                      Políticas: {bookingDiscountPolicies.join(', ')}
                    </p>
                  ) : null}
                  {bookingNightSurcharge.applied ? (
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 mt-1">
                      Recargo nocturno aplicado: +{formatMoney(bookingNightSurcharge.amount)}
                      {bookingNightSurcharge.fromHour ? ` (desde ${bookingNightSurcharge.fromHour})` : ''}
                    </p>
                  ) : null}
                  {remainingCourt <= 0.009 ? (
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/50 mt-1">
                      Pagado
                    </p>
                  ) : courtPaidNow > 0.009 ? (
                    <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 mt-1">
                      Parcial (resta {formatMoney(remainingCourt)})
                    </p>
                  ) : (
                    <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/50 mt-1">
                      Pendiente de cobro
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-black text-sm">{formatMoney(courtTotal)}</span>
                </div>
              </div>

              {cartItems.length === 0 ? (
                <div className="p-6 text-center opacity-40">
                  <Receipt size={24} className="mx-auto mb-2" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Sin consumos cargados</p>
                </div>
              ) : (
                cartItems.map((item) => {
                  const isPaid = !item.isNew && Number(item.remainingAmount || 0) <= 0.009;
                  const isPartial = !item.isNew && Number(item.paidAmount || 0) > 0.009 && Number(item.remainingAmount || 0) > 0.009;
                  const hasPayments = !item.isNew && Number(item.paidAmount || 0) > 0.009;
                  const itemDiscountTotal = Number(
                    ((item.discounts || []).reduce((sum, discount) => sum + Number(discount?.discountAmount || 0), 0)).toFixed(2)
                  );
                  const itemDiscountPolicies = Array.from(
                    new Set(
                      (item.discounts || [])
                        .map((discount) => String(discount?.policyName || '').trim())
                        .filter(Boolean)
                    )
                  );
                  const rowClass = isPaid ? 'bg-gray-50 text-gray-500' : isPartial ? 'bg-amber-50/40 text-[#7a5d1f]' : 'text-[#347048]';
                  return (
                  <div key={item.isNew ? item.tempId : item.id} className={`p-4 flex items-center justify-between ${rowClass}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-black truncate">
                        {item.quantity}x {item.productName}
                      </p>
                      {item.isNew && Number(item.discountAmount || 0) > 0.009 ? (
                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 mt-1">
                          Descuento aplicado: -{formatMoney(Number(item.discountAmount || 0))}
                        </p>
                      ) : null}
                      {!item.isNew && itemDiscountTotal > 0.009 ? (
                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-700 mt-1">
                          Descuento aplicado: -{formatMoney(itemDiscountTotal)}
                        </p>
                      ) : null}
                      {itemDiscountPolicies.length > 0 ? (
                        <p className="text-[9px] font-black text-[#347048]/60 mt-1 truncate">
                          Políticas: {itemDiscountPolicies.join(', ')}
                        </p>
                      ) : null}
                      {!item.isNew && Number(item.remainingAmount || 0) <= 0.009 ? (
                        <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/50 mt-1">
                          Pagado
                        </p>
                      ) : !item.isNew && Number(item.paidAmount || 0) > 0.009 ? (
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 mt-1">
                          Parcial (resta {formatMoney(Number(item.remainingAmount || 0))})
                        </p>
                      ) : item.isNew ? (
                        <p className="text-[9px] font-black uppercase tracking-widest text-[#B9CF32] mt-1">Pendiente de cobro</p>
                      ) : (
                        <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/50 mt-1">Pendiente de cobro</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-black text-sm">{formatMoney(item.price * item.quantity)}</span>
                      <button
                        type="button"
                        onClick={() => handleRemove(item)}
                        className={`p-2 rounded-xl transition ${
                          hasPayments
                            ? 'text-gray-400 bg-transparent cursor-not-allowed opacity-60'
                            : isPaid
                              ? 'text-gray-400 hover:bg-gray-100'
                              : 'text-red-500 hover:bg-red-50'
                        }`}
                        title={hasPayments ? 'No se puede eliminar: tiene pagos asociados' : 'Quitar'}
                        disabled={saving || (!item.isNew && !item.id) || isCancelled || hasPayments}
                      >
                        <Trash2 size={18} strokeWidth={2.5} />
                      </button>
                    </div>
                  </div>
                );
                })
              )}
            </div>
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
                <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Cancelación automática</p>
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
                    No se cancelará automáticamente porque tiene pagos registrados
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-[#347048]/70">
                <span>Cancha</span>
                <span>{formatMoney(courtTotal)}</span>
              </div>
              {bookingNightSurcharge.applied ? (
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-amber-700">
                  <span>Recargo nocturno</span>
                  <span>
                    +{formatMoney(bookingNightSurcharge.amount)}
                    {bookingNightSurcharge.fromHour ? ` (desde ${bookingNightSurcharge.fromHour})` : ''}
                  </span>
                </div>
              ) : null}
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
                <span>Extras pendientes</span>
                <span>{formatMoney(registeredItemsPendingTotal)}</span>
              </div>
              {canManageConsumptions ? (
                <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-[#926699]">
                  <span>Extras nuevos</span>
                  <span>{formatMoney(draftTotal)}</span>
                </div>
              ) : null}
              <div className="mt-4 pt-4 border-t border-[#347048]/10 flex items-end justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Total a registrar</span>
                <span className="text-4xl font-black italic tracking-tighter text-[#347048]">
                  {formatMoney(grandTotalToRegister)}
                </span>
              </div>
            </div>

            {canManualConfirm ? (
              <div className="mt-4 rounded-xl bg-white border border-[#347048]/10 px-3 py-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Previsualización al confirmar</p>
                {quoteLoading ? (
                  <p className="text-[11px] font-black uppercase tracking-wide text-[#347048] mt-2">Cotizando descuento...</p>
                ) : confirmationQuote ? (
                  <div className="mt-2 space-y-1 text-[11px] font-black uppercase tracking-wide text-[#347048]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#347048]/60">Precio de lista</span>
                      <span>{formatMoney(Number(confirmationQuote.listPrice || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#347048]/60">Descuento</span>
                      <span>{formatMoney(Number(confirmationQuote.discountAmount || 0))}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#347048]/60">Final estimado</span>
                      <span>{formatMoney(Number(confirmationQuote.finalPrice || 0))}</span>
                    </div>
                    {bookingNightSurcharge.applied ? (
                      <div className="flex items-center justify-between text-amber-700">
                        <span>Recargo nocturno</span>
                        <span>
                          +{formatMoney(bookingNightSurcharge.amount)}
                          {bookingNightSurcharge.fromHour ? ` (desde ${bookingNightSurcharge.fromHour})` : ''}
                        </span>
                      </div>
                    ) : null}
                    {itemsRegisteredTotal > 0.009 ? (
                      <>
                        <div className="mt-2 border-t border-[#347048]/10 pt-2 flex items-center justify-between">
                          <span className="text-[#347048]/60">
                            {canManageConsumptions ? 'Consumos registrados' : 'Extras ya registrados'}
                          </span>
                          <span>{formatMoney(itemsRegisteredTotal)}</span>
                        </div>
                        {registeredItemsDiscountTotal > 0.009 ? (
                          <div className="flex items-center justify-between">
                            <span className="text-[#347048]/60">
                              {canManageConsumptions ? 'Descuento en consumos' : 'Descuento en extras'}
                            </span>
                            <span>{formatMoney(registeredItemsDiscountTotal)}</span>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {canManageConsumptions && draftTotal > 0.009 ? (
                      <div className="flex items-center justify-between">
                        <span className="text-[#347048]/60">Consumos nuevos (pend.)</span>
                        <span>{formatMoney(draftTotal)}</span>
                      </div>
                    ) : null}
                    <div className="mt-2 border-t border-[#347048]/10 pt-2 flex items-center justify-between text-[#926699]">
                      <span>Total preliminar cuenta</span>
                      <span>{formatMoney(Number((Number(confirmationQuote.finalPrice || 0) + itemsRegisteredTotal + (canManageConsumptions ? draftTotal : 0)).toFixed(2)))}</span>
                    </div>
                    {Array.isArray(confirmationQuote.appliedPolicies) && confirmationQuote.appliedPolicies.length > 0 ? (
                      <div className="pt-1 text-[10px] font-black text-emerald-700 normal-case tracking-normal">
                        Políticas: {confirmationQuote.appliedPolicies.map((policy) => String(policy?.policyName || '').trim()).filter(Boolean).join(', ')}
                      </div>
                    ) : null}
                    {canManageConsumptions && draftTotal > 0.009 ? (
                      <div className="pt-1 text-[10px] font-black text-[#347048]/60 normal-case tracking-normal">
                        Los consumos nuevos se calculan como pendientes hasta guardarlos/cobrarlos.
                      </div>
                    ) : null}
                  </div>
                ) : quoteError ? (
                  <p className="text-[10px] font-black text-amber-700 mt-2">{quoteError}</p>
                ) : (
                  <p className="text-[10px] font-black text-[#347048]/60 mt-2">Sin datos para cotizar.</p>
                )}
              </div>
            ) : null}

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
                onClick={handleSaveDraftItems}
                disabled={saving || isCancelled || !canManageConsumptions || !hasDraftItems}
                className="w-full flex items-center justify-center gap-2 bg-white border border-[#347048]/20 hover:border-[#347048]/35 text-[#347048] py-3 rounded-2xl font-black uppercase tracking-widest transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Guardar consumos
              </button>

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
          cartItems={payableItems
            .filter((item) => {
              if (item.isNew) return true;
              return Number(item.remainingAmount || 0) > 0.009;
            })
            .map((item) => {
              const pendingAmount = item.isNew
                ? Number(item.price || 0) * Number(item.quantity || 0)
                : Number(item.remainingAmount || 0);
              const qty = Math.max(1, Number(item.quantity || 1));
              const label = `${qty}x ${item.productName}`;
              return {
              id: item.id,
              tempId: item.tempId,
              productName: label,
              quantity: 1,
              price: pendingAmount
            };
            })}
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
