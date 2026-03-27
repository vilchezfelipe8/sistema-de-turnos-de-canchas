import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import ClubProductSearch, { type ClubProductSearchItem } from '../ui/ClubProductSearch';
import ClubServiceSearch, { type ClubServiceSearchItem } from '../ui/ClubServiceSearch';
import type { PaymentChannel, PaymentSource } from '../../services/AccountService';
import { formatAccountCode, formatPaymentCode } from '../../utils/displayCode';
import { lockBodyScroll } from '../../utils/bodyScrollLock';

type NewItemForm = {
  description: string;
  quantity: number;
  unitPrice: number;
  type: 'PRODUCT' | 'SERVICE' | 'ADJUSTMENT';
  productId?: number;
  serviceCode?: string;
};

type PaymentForm = {
  channel: PaymentChannel;
  collectorAccountLabel: string;
  externalReference: string;
  source: PaymentSource;
};

type AccountManagerModalProps = {
  show: boolean;
  accountId: string;
  detail: any;
  isClosed: boolean;
  clubSlug: string;
  products: ClubProductSearchItem[];
  services: ClubServiceSearchItem[];
  productsLoading: boolean;
  servicesLoading: boolean;
  newItem: NewItemForm;
  setNewItem: Dispatch<SetStateAction<NewItemForm>>;
  payment: PaymentForm;
  setPayment: Dispatch<SetStateAction<PaymentForm>>;
  itemOutstandingMap: Map<string, number>;
  paymentCalculatorTotalPending: number;
  paymentCalculatorCourtPending: number;
  actionError?: string;
  formatItemType: (value?: string) => string;
  formatPaymentMethod: (value?: string) => string;
  formatPaymentChannel: (value?: string) => string;
  formatPaymentSource: (value?: string) => string;
  onClose: () => void;
  onAddItem: () => Promise<void>;
  onSelectProduct: (product: ClubProductSearchItem) => void;
  onSelectService: (service: ClubServiceSearchItem) => void;
  onOpenPaymentCalculator: () => void;
  onOpenCloseAccountConfirm: () => void;
  onRequestRefund: (paymentId: string, amount: number) => void;
};

export default function AccountManagerModal({
  show,
  accountId,
  detail,
  isClosed,
  clubSlug,
  products,
  services,
  productsLoading,
  servicesLoading,
  newItem,
  setNewItem,
  payment,
  setPayment,
  itemOutstandingMap,
  paymentCalculatorTotalPending,
  paymentCalculatorCourtPending,
  actionError,
  formatItemType,
  formatPaymentMethod,
  formatPaymentChannel,
  formatPaymentSource,
  onClose,
  onAddItem,
  onSelectProduct,
  onSelectService,
  onOpenPaymentCalculator,
  onOpenCloseAccountConfirm,
  onRequestRefund
}: AccountManagerModalProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedProductName, setSelectedProductName] = useState('');
  const [selectedServiceName, setSelectedServiceName] = useState('');
  const [showAdvancedPaymentFields, setShowAdvancedPaymentFields] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!show) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const releaseBodyScrollLock = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      releaseBodyScrollLock();
    };
  }, [show, onClose]);

  useEffect(() => {
    if (!show) {
      setSelectedProductName('');
      setSelectedServiceName('');
      return;
    }
    if (newItem.type !== 'PRODUCT' || !String(newItem.description || '').trim()) {
      setSelectedProductName('');
    }
    if (newItem.type !== 'SERVICE' || !String(newItem.description || '').trim()) {
      setSelectedServiceName('');
    }
    if (newItem.type !== 'PRODUCT' && newItem.productId) {
      setNewItem((prev) => ({ ...prev, productId: undefined }));
    }
    if (newItem.type !== 'SERVICE' && newItem.serviceCode) {
      setNewItem((prev) => ({ ...prev, serviceCode: undefined }));
    }
  }, [newItem.description, newItem.productId, newItem.serviceCode, newItem.type, setNewItem, show]);

  useEffect(() => {
    if (show && !wasOpenRef.current && Number(newItem.quantity || 0) <= 0) {
      setNewItem((prev) => ({ ...prev, quantity: 1 }));
    }
    wasOpenRef.current = show;
  }, [newItem.quantity, setNewItem, show]);

  if (!show) return null;

  const accountSourceType = String(
    detail?.sourceType || detail?.account?.sourceType || detail?.source || ''
  ).toUpperCase();
  const showDescriptionField = newItem.type === 'ADJUSTMENT';
  const hasBookingPending = paymentCalculatorCourtPending > 0.009;
  const shouldShowBookingPending = accountSourceType === 'BOOKING' || hasBookingPending;
  const pendingItemsFromMap = Number(
    (Array.isArray(detail?.items) ? detail.items : []).reduce((sum: number, item: any) => {
      const itemType = String(item?.type || '').toUpperCase();
      if (itemType === 'BOOKING') return sum;
      const outstanding = Number(itemOutstandingMap.get(String(item?.id || '')) || 0);
      return sum + Math.max(0, outstanding);
    }, 0).toFixed(2)
  );
  const remaining = Number(detail?.remaining || 0);
  const calculatedPending = Number(paymentCalculatorTotalPending || 0);
  const hasPendingDrift = Math.abs(remaining - calculatedPending) > 0.01;
  const itemFieldsGridClass = showDescriptionField
    ? 'grid grid-cols-1 md:grid-cols-4 gap-3'
    : 'grid grid-cols-1 md:grid-cols-2 gap-3';
  const inputClass =
    'w-full h-12 bg-white border-2 border-[#347048]/10 focus:border-[#B9CF32] rounded-xl px-4 text-sm font-bold text-[#347048] outline-none transition-all shadow-sm';
  const selectClass = `${inputClass} pr-10 appearance-none`;
  const labelClass =
    'block text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-1.5';
  const cardClass = 'rounded-2xl border border-white/60 bg-white/40 p-4';
  const primaryButtonClass =
    'h-12 rounded-xl bg-[#347048] text-[#EBE1D8] text-xs font-black uppercase tracking-widest shadow-lg shadow-[#347048]/20 hover:bg-[#B9CF32] hover:text-[#347048] transition-all disabled:opacity-60 disabled:cursor-not-allowed';
  const accentButtonClass =
    'h-12 rounded-xl bg-[#926699] text-[#EBE1D8] text-xs font-black uppercase tracking-widest shadow-lg shadow-[#926699]/20 hover:brightness-110 transition-all';
  const sourceLabel =
    payment.source === 'ONLINE'
      ? 'En linea (ONLINE)'
      : payment.source === 'BACKOFFICE'
        ? 'Administracion (BACKOFFICE)'
        : 'Mostrador (POS)';

  const modalContent = (
    <div
      className="fixed inset-0 z-[2147483000] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl bg-[#EBE1D8] border-4 border-white/50 rounded-[2rem] shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/50">Gestion de cuenta</p>
            <h3 className="text-2xl font-black uppercase italic tracking-tight text-[#347048]">
              Cuenta {formatAccountCode(accountId, detail?.account?.displayCode || detail?.displayCode)}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Cerrar"
            className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
          >
            <X size={20} strokeWidth={3} />
          </button>
        </div>

        {actionError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            {actionError}
          </div>
        ) : null}

        {!detail ? (
          <div className="rounded-2xl border border-[#347048]/10 bg-white p-5 text-sm font-bold text-[#347048]/70">
            Cargando cuenta...
          </div>
        ) : (
          <div className="max-h-[calc(100vh-12rem)] overflow-y-auto pr-1">
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 lg:col-span-7 lg:pr-6 lg:border-r lg:border-[#347048]/10 space-y-5">
                {!isClosed && (
                  <div className={cardClass}>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-3">Cargar consumos</p>
                    <div className="space-y-2">
                      <div>
                        <p className={labelClass}>Tipo de concepto</p>
                        <select
                          value={newItem.type}
                          onChange={(e) => {
                            const nextType = e.target.value as NewItemForm['type'];
                            if (nextType === 'PRODUCT') {
                              setNewItem((prev) => ({
                                ...prev,
                                type: nextType,
                                quantity: prev.quantity > 0 ? prev.quantity : 1,
                                productId: prev.type === 'PRODUCT' ? prev.productId : undefined,
                                serviceCode: undefined
                              }));
                              setSelectedServiceName('');
                              return;
                            }
                            if (nextType === 'SERVICE') {
                              setNewItem((prev) => ({
                                ...prev,
                                type: nextType,
                                quantity: prev.quantity > 0 ? prev.quantity : 1,
                                description: '',
                                unitPrice: 0,
                                productId: undefined,
                                serviceCode: undefined
                              }));
                              setSelectedProductName('');
                              return;
                            }
                            setNewItem((prev) => ({
                              ...prev,
                              type: nextType,
                              quantity: prev.quantity > 0 ? prev.quantity : 1,
                              description: '',
                              unitPrice: 0,
                              productId: undefined,
                              serviceCode: undefined
                            }));
                            setSelectedProductName('');
                            setSelectedServiceName('');
                          }}
                          className={selectClass}
                        >
                          <option value="PRODUCT">Producto</option>
                          <option value="SERVICE">Servicio</option>
                          <option value="ADJUSTMENT">Ajuste (+)</option>
                        </select>
                      </div>
                      {newItem.type === 'PRODUCT' && (
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Producto del club</p>
                          <ClubProductSearch
                            products={products}
                            onSelect={(product) => {
                              onSelectProduct(product);
                              setSelectedProductName(String(product?.name || ''));
                            }}
                            selectedName={selectedProductName || undefined}
                            value={newItem.description}
                            onChange={(value) => {
                              setNewItem((prev) => ({ ...prev, description: value }));
                            }}
                            onInputChange={(value) => {
                              if (!selectedProductName) return;
                              if (value.trim().toLowerCase() !== selectedProductName.trim().toLowerCase()) {
                                setSelectedProductName('');
                                setNewItem((prev) => ({ ...prev, productId: undefined }));
                              }
                            }}
                            minQueryLength={1}
                            maxResults={12}
                            disabled={productsLoading || !clubSlug}
                            placeholder={
                              productsLoading
                                ? 'Cargando productos...'
                                : clubSlug
                                  ? 'Buscar producto por nombre...'
                                  : 'No se detecto club para cargar productos'
                            }
                          />
                        </div>
                      )}
                      {newItem.type === 'SERVICE' && (
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Servicio del club</p>
                          <ClubServiceSearch
                            services={services}
                            onSelect={(service) => {
                              onSelectService(service);
                              setSelectedServiceName(String(service?.name || ''));
                            }}
                            selectedName={selectedServiceName || undefined}
                            value={newItem.description}
                            onChange={(value) => {
                              setNewItem((prev) => ({ ...prev, description: value }));
                            }}
                            onInputChange={(value) => {
                              if (!selectedServiceName) return;
                              if (value.trim().toLowerCase() !== selectedServiceName.trim().toLowerCase()) {
                                setSelectedServiceName('');
                                setNewItem((prev) => ({ ...prev, serviceCode: undefined }));
                              }
                            }}
                            minQueryLength={1}
                            maxResults={12}
                            disabled={servicesLoading || !clubSlug}
                            placeholder={
                              servicesLoading
                                ? 'Cargando servicios...'
                                : clubSlug
                                  ? 'Buscar servicio por nombre o codigo...'
                                  : 'No se detecto club para cargar servicios'
                            }
                          />
                        </div>
                      )}
                      {newItem.type !== 'PRODUCT' && (
                        <p className="text-[11px] font-bold text-[#347048]/60">
                          {newItem.type === 'ADJUSTMENT'
                            ? 'Ajuste actualmente suma saldo de la cuenta (+). Para restar, usa devolucion o ajuste manual compensado.'
                            : newItem.type === 'SERVICE'
                              ? 'Selecciona un servicio del club para autocompletar descripcion y precio, o cargalo manualmente.'
                              : 'Selecciona un producto del club para autocompletar descripcion y precio.'}
                        </p>
                      )}
                      <div className={itemFieldsGridClass}>
                        {showDescriptionField && (
                          <div className="space-y-1 md:col-span-2">
                            <label className={labelClass}>Descripcion</label>
                            <input
                              placeholder="Descripcion"
                              value={newItem.description}
                              onChange={(e) => setNewItem((prev) => ({
                                ...prev,
                                description: e.target.value,
                                productId: prev.type === 'PRODUCT' ? undefined : prev.productId,
                                serviceCode: prev.type === 'SERVICE' ? undefined : prev.serviceCode
                              }))}
                              className={inputClass}
                            />
                          </div>
                        )}
                        <div className="space-y-1">
                          <label className={labelClass}>Cantidad</label>
                          <input
                            type="number"
                            min={1}
                            value={newItem.quantity > 0 ? newItem.quantity : ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setNewItem((prev) => ({ ...prev, quantity: raw === '' ? 0 : Number(raw) }));
                            }}
                            onBlur={() => {
                              if (Number(newItem.quantity || 0) > 0) return;
                              setNewItem((prev) => ({ ...prev, quantity: 1 }));
                            }}
                            onWheel={(event) => event.currentTarget.blur()}
                            className={inputClass}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className={labelClass}>
                            {newItem.type === 'ADJUSTMENT' ? 'Monto ajuste (+)' : 'Precio unitario'}
                          </label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={newItem.unitPrice > 0 ? newItem.unitPrice : ''}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setNewItem((prev) => ({ ...prev, unitPrice: raw === '' ? 0 : Number(raw) }));
                            }}
                            onWheel={(event) => event.currentTarget.blur()}
                            className={inputClass}
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void onAddItem()}
                        className={`w-full ${accentButtonClass}`}
                      >
                        Agregar consumo
                      </button>
                    </div>
                  </div>
                )}

                <div className={cardClass}>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-2">Items pendientes</p>
                  <div className="space-y-2 max-h-40 overflow-y-auto text-xs text-[#24573A]">
                    {(detail.items || []).map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between border border-[#347048]/20 rounded-xl px-3 py-2 bg-white shadow-sm">
                        <span className="font-black text-[#1F4E32]">{item.description} · {formatItemType(item.type)}</span>
                        <span className="font-black text-[#2B6843]">
                          Pendiente: ${Number(itemOutstandingMap.get(String(item.id)) || 0).toLocaleString()}
                        </span>
                      </div>
                    ))}
                    {(!detail.items || detail.items.length === 0) && (
                      <div className="text-[#24573A]/75 font-bold">Sin items.</div>
                    )}
                  </div>
                </div>

                <div className={cardClass}>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60 mb-2">Historial de pagos y devoluciones</p>
                  <div className="space-y-2 max-h-52 overflow-y-auto text-xs text-[#24573A]">
                    {(detail.payments || []).map((entry: any) => {
                      const paymentId = String(entry?.id || '');
                      if (!paymentId) return null;
                      const amount = Number(entry?.amount || 0);
                      return (
                        <div key={paymentId} className="flex items-center justify-between gap-2 border border-[#347048]/20 rounded-xl px-3 py-2 bg-white shadow-sm">
                          <div className="min-w-0">
                            <p className="font-black text-[#1F4E32] truncate">
                              {formatPaymentCode(paymentId, entry?.displayCode)}
                            </p>
                            <p className="font-semibold text-[#2B6843] truncate">
                              {formatPaymentMethod(entry.method)} · {formatPaymentChannel(entry.channel)} · {formatPaymentSource(entry.source)} · ${amount.toLocaleString()}
                            </p>
                            {(entry.collectorAccountLabel || entry.externalReference) && (
                              <p className="text-[#24573A]/80 truncate">
                                {entry.collectorAccountLabel ? `Cuenta: ${entry.collectorAccountLabel}` : ''}
                                {entry.collectorAccountLabel && entry.externalReference ? ' · ' : ''}
                                {entry.externalReference ? `Ref: ${entry.externalReference}` : ''}
                              </p>
                            )}
                          </div>
                          {!isClosed && (
                            <button
                              type="button"
                              onClick={() => onRequestRefund(paymentId, amount)}
                              className="h-9 rounded-xl border-2 border-[#347048]/20 px-3 text-[10px] font-black uppercase tracking-widest hover:bg-white transition-all"
                            >
                              Solicitar devolucion
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {(!detail.payments || detail.payments.length === 0) && (
                      <div className="text-[#24573A]/75 font-bold">Sin pagos.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-5">
                <div className={`${cardClass} space-y-3`}>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60">Estado de cuenta</p>
                  <div className="space-y-2 text-xs font-black uppercase tracking-widest">
                    <div className="flex items-center justify-between text-[#347048]/70">
                      <span>Total</span>
                      <span>${Number(detail.total || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-[#347048]/70">
                      <span>Pagado</span>
                      <span>${Number(detail.paid || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-[#926699]">
                      <span>Restante</span>
                      <span>${Number(detail.remaining || 0).toLocaleString()}</span>
                    </div>
                    {shouldShowBookingPending && (
                      <div className="flex items-center justify-between text-[#347048]/60">
                        <span>Pendiente reserva</span>
                        <span>${paymentCalculatorCourtPending.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[#347048]/60">
                      <span>Pendiente consumos</span>
                      <span>${pendingItemsFromMap.toLocaleString()}</span>
                    </div>
                    {hasPendingDrift && (
                      <div className="flex items-center justify-between text-amber-700">
                        <span>Pendiente calculado</span>
                        <span>${paymentCalculatorTotalPending.toLocaleString()}</span>
                      </div>
                    )}
                  </div>

                  {isClosed ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                      Cuenta cerrada: solo lectura.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/60">Registrar pago</p>
                        <div className="rounded-xl border border-[#347048]/10 bg-white/60 px-3 py-2 text-xs">
                          <p className="font-black uppercase tracking-widest text-[#347048]/70">Origen operativo</p>
                          <p className="mt-1 font-semibold text-[#347048]">{sourceLabel}</p>
                          <p className="mt-1 text-[#347048]/60">
                            Canal y conciliacion se completan automaticamente segun el metodo de cobro.
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#347048]/10 bg-white/60 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setShowAdvancedPaymentFields((prev) => !prev)}
                            className="w-full px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-[#347048]/5 transition-all focus:outline-none"
                          >
                            <div className="text-left">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/70">
                                Datos de conciliacion
                              </p>
                              <p className="text-[11px] font-semibold text-[#347048]/60 mt-0.5">
                                Opcional. Solo para caja/finanzas.
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span
                                className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border ${
                                  showAdvancedPaymentFields
                                    ? 'bg-[#347048]/10 text-[#347048] border-[#347048]/20'
                                    : 'bg-white text-[#347048]/60 border-[#347048]/15'
                                }`}
                              >
                                {showAdvancedPaymentFields ? 'Abierto' : 'Opcional'}
                              </span>
                              {showAdvancedPaymentFields ? (
                                <ChevronUp size={16} className="text-[#347048]/70" />
                              ) : (
                                <ChevronDown size={16} className="text-[#347048]/70" />
                              )}
                            </div>
                          </button>
                        {showAdvancedPaymentFields && (
                          <div className="border-t border-[#347048]/10 p-3 space-y-2">
                            <div className="space-y-1">
                              <label className={labelClass}>Origen del pago</label>
                              <select
                                value={payment.source}
                                onChange={(e) => setPayment((prev) => ({ ...prev, source: e.target.value as PaymentSource }))}
                                className={selectClass}
                              >
                                <option value="POS">Mostrador (POS)</option>
                                <option value="ONLINE">En linea</option>
                                <option value="BACKOFFICE">Administracion</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className={labelClass}>Canal</label>
                              <select
                                value={payment.channel}
                                onChange={(e) => setPayment((prev) => ({ ...prev, channel: e.target.value as PaymentChannel }))}
                                className={selectClass}
                              >
                                <option value="AUTO">Canal automatico</option>
                                <option value="CASH_DRAWER">Caja</option>
                                <option value="BANK_ACCOUNT">Cuenta bancaria</option>
                                <option value="CARD_TERMINAL">Terminal de tarjeta</option>
                                <option value="VIRTUAL_WALLET">Billetera virtual</option>
                                <option value="OTHER">Otro</option>
                              </select>
                            </div>
                            <div className="space-y-1">
                              <label className={labelClass}>Cuenta receptora</label>
                              <input
                                type="text"
                                value={payment.collectorAccountLabel}
                                onChange={(e) => setPayment((prev) => ({ ...prev, collectorAccountLabel: e.target.value }))}
                                className={inputClass}
                                placeholder="Alias, banco o caja (opcional)"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className={labelClass}>Comprobante / referencia</label>
                              <input
                                type="text"
                                value={payment.externalReference}
                                onChange={(e) => setPayment((prev) => ({ ...prev, externalReference: e.target.value }))}
                                className={inputClass}
                                placeholder="Numero de operacion (opcional)"
                              />
                            </div>
                          </div>
                        )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onOpenPaymentCalculator}
                        disabled={paymentCalculatorTotalPending <= 0.009}
                        className={`w-full ${primaryButtonClass}`}
                      >
                        Abrir calculadora de cobro
                      </button>
                      <button
                        type="button"
                        onClick={onOpenCloseAccountConfirm}
                        className="w-full h-12 rounded-xl bg-[#F4D35E] text-[#5F4300] text-xs font-black uppercase tracking-widest shadow-lg shadow-[#F4D35E]/25 hover:bg-[#E6BF3F] transition-all"
                      >
                        Cerrar cuenta
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
