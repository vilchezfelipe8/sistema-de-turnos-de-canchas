import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Wallet, ArrowUpCircle, ArrowDownCircle, Banknote, CreditCard, Plus, Receipt, History, ChevronDown, Check, Phone, IdCard, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { searchClients } from '../../services/BookingService';
import { ClubService } from '../../services/ClubService';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { CashService } from '../../services/CashService';
import { formatDateTime24, formatTime24 } from '../../utils/dateTime';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import AppModal from '../AppModal';
import PaymentCalculator, { type PaymentCalculatorResult } from '../PaymentCalculator';
import ProductSearch, { type ProductSearchItem } from '../ui/ProductSearch';

// Tipos
interface Movement {
  id: number;
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  method: 'CASH' | 'TRANSFER' | 'CARD';
  channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET' | null;
  sourceType?: 'BOOKING' | 'BAR' | 'TABLE' | 'MANUAL' | null;
  sourceId?: string | null;
  accountId?: string | null;
  bookingAmount?: number;
  barAmount?: number;
  paymentId?: string | null;
  refundId?: string | null;
  booking?: {
    id: number;
    startDateTime: string;
    courtName?: string | null;
    clientName?: string | null;
  } | null;
  allocations?: Array<{
    accountItemId: string;
    amount: number;
    type?: string | null;
    description?: string | null;
    quantity?: number | null;
    unitPrice?: number | null;
    total?: number | null;
  }>;
}

interface Balance {
  total: number;
  cash: number;
  digital: number;
  income: number;
  expense: number;
}

interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  category?: string;
}

interface CashRegister {
  id: string;
  name: string;
  location?: string | null;
}

interface CashShift {
  id: string;
  cashRegisterId: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openingAmount: number;
  openAccountsSummary?: {
    openAccounts: number;
    openAccountsWithPending: number;
    pendingAmount: number;
  };
  closePolicy?: {
    strict: boolean;
  };
  cashRegister?: {
    id: string;
    name: string;
    location?: string | null;
  };
}

interface CashShiftCloseReport {
  shift: {
    id: string;
    openedAt?: string;
    closedAt?: string | null;
  };
  expectedCash: number;
  countedCash: number;
  difference: number;
  totals?: {
    paymentIn?: number;
    deposit?: number;
    withdraw?: number;
    refund?: number;
  };
}

type SalePaymentAllocation = {
  itemKey: string;
  amount: number;
};

type SalePayment = {
  method: 'CASH' | 'TRANSFER' | 'CARD';
  channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
  amount: number;
  allocations: SalePaymentAllocation[];
};

type SaleCartItem = {
  itemKey: string;
  productId?: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  isCustom: boolean;
  stock?: number | null;
};

type CashPeriod = 'hoy' | 'semana' | 'mes';

const toDateLabel = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getCashDateRange = (period: CashPeriod, offset: number = 0) => {
  const base = new Date();
  const start = new Date(base);
  const end = new Date(base);

  if (period === 'hoy') {
    start.setDate(start.getDate() + offset);
    end.setDate(end.getDate() + offset);
  } else if (period === 'semana') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1 + (offset * 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  } else {
    start.setFullYear(start.getFullYear(), start.getMonth() + offset, 1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return {
    startDate: toDateLabel(start),
    endDate: toDateLabel(end),
    rawStart: start,
    rawEnd: end
  };
};

const normalizeSaleItemName = (value: string) => String(value || '').trim().toLowerCase();

// --- COMPONENTE DROPDOWN CUSTOM (ESTILO WIMBLEDON) ---
const CustomSelect = ({ value, options, onChange, placeholder }: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find((o: any) => o.value === value);

  return (
    <div className={`relative w-full ${isOpen ? 'z-[100]' : 'z-10'}`} ref={wrapperRef}>
      <div 
        className={`w-full h-14 bg-white border-2 transition-all rounded-2xl px-4 flex items-center justify-between shadow-sm cursor-pointer ${
          isOpen ? 'border-[#B9CF32] ring-2 ring-[#B9CF32]/20' : 'border-transparent hover:border-[#B9CF32]/50'
        }`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`font-bold text-sm ${!selectedOption ? 'text-[#347048]/40' : 'text-[#347048]'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={18} className={`transition-transform duration-300 ${isOpen ? 'rotate-180 text-[#B9CF32]' : 'text-[#347048]/40'}`} strokeWidth={3} />
      </div>

      {isOpen && (
        <div className="absolute z-[110] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-48 overflow-y-auto custom-scrollbar overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <ul className="flex flex-col py-2">
            {options.map((option: any) => (
              <li 
                key={option.value}
                onClick={() => {
                  if (!option.disabled) {
                    onChange(option.value);
                    setIsOpen(false);
                  }
                }}
                className={`px-4 py-3 flex items-center justify-between transition-colors ${
                  option.disabled 
                    ? 'opacity-40 cursor-not-allowed bg-gray-50' 
                    : 'cursor-pointer hover:bg-[#B9CF32]/20'
                } ${value === option.value ? 'bg-[#347048]/5 text-[#347048]' : 'text-[#347048]'}`}
              >
                <span className="font-black text-xs">{option.label}</span>
                {option.disabled && <span className="text-[9px] font-black text-red-500 uppercase tracking-widest border border-red-500/20 bg-red-50 px-2 py-0.5 rounded-md">Sin Stock</span>}
                {!option.disabled && value === option.value && <Check size={14} className="text-[#347048]" strokeWidth={4} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};


const AdminCashDashboard = () => {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [balance, setBalance] = useState<Balance>({ total: 0, cash: 0, digital: 0, income: 0, expense: 0 });
  const [loading, setLoading] = useState(true);
  const [activePeriod, setActivePeriod] = useState<CashPeriod>('hoy');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [saleError, setSaleError] = useState('');
  const [movementError, setMovementError] = useState('');
  const [currentShift, setCurrentShift] = useState<CashShift | null>(null);
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([]);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [openingShift, setOpeningShift] = useState(false);
  const [openShiftError, setOpenShiftError] = useState('');
  const [openShiftForm, setOpenShiftForm] = useState({ cashRegisterId: '', openingAmount: '' });
  const [closeShiftForm, setCloseShiftForm] = useState({ countedCash: '' });
  const [closingShift, setClosingShift] = useState(false);
  const [closeShiftError, setCloseShiftError] = useState('');
  const [lastClosedReport, setLastClosedReport] = useState<CashShiftCloseReport | null>(null);
  const [showLastCloseDetails, setShowLastCloseDetails] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedClient, setSelectedClient] = useState<any | null>(null);
  const [searchClubSlug, setSearchClubSlug] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientWrapperRef = useRef<HTMLDivElement | null>(null);
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(null);
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ show: boolean; title: string; message: string }>({
    show: false,
    title: '',
    message: ''
  });
  const [showCreateClientModal, setShowCreateClientModal] = useState(false);
  const [newClientDraft, setNewClientDraft] = useState({ name: '', phone: '', dni: '', email: '', isProfessor: false });

  const handlePeriodChange = (period: CashPeriod) => {
    setActivePeriod(period);
    setPeriodOffset(0);
  };

  const getPeriodLabel = () => {
    const { rawStart, rawEnd } = getCashDateRange(activePeriod, periodOffset);
    if (activePeriod === 'hoy') {
      if (periodOffset === 0) return 'Hoy';
      if (periodOffset === -1) return 'Ayer';
      return rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
    if (activePeriod === 'semana') {
      if (periodOffset === 0) return 'Esta Semana';
      if (periodOffset === -1) return 'Semana Pasada';
      return `${rawStart.getDate()} al ${rawEnd.getDate()} ${rawEnd.toLocaleDateString('es-AR', { month: 'short' })}`;
    }
    return rawStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  };

  // Formulario
  const [newMove, setNewMove] = useState({ description: '', amount: '', type: 'INCOME' });
  const [showMovementMethodPicker, setShowMovementMethodPicker] = useState(false);
  const [movementSubmitting, setMovementSubmitting] = useState(false);
  const [productSale, setProductSale] = useState({
    productQuery: '',
    manualUnitPrice: '',
    quantity: '1',
    clientQuery: '',
    guestPhone: '',
    guestDni: '',
    guestEmail: '',
    guestIsProfessor: false
  });
  const [createClientIfMissing, setCreateClientIfMissing] = useState(false);
  const [saleCart, setSaleCart] = useState<SaleCartItem[]>([]);
  const [saleQuote, setSaleQuote] = useState<any | null>(null);
  const [salePayments, setSalePayments] = useState<SalePayment[]>([]);
  const [showSalePaymentCalculator, setShowSalePaymentCalculator] = useState(false);
  const [selectedSaleProduct, setSelectedSaleProduct] = useState<ProductSearchItem | null>(null);
  const [saleProductSearchKey, setSaleProductSearchKey] = useState(0);

  const getClubSlug = useCallback(() => {
    try {
      const path = typeof window !== 'undefined' ? window.location.pathname : '';
      const parts = path.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => p === 'club');
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];

      const userStored = localStorage.getItem('user');
      if (userStored) {
        const user = normalizeSessionUser(JSON.parse(userStored));
        const foundSlug = getActiveClubSlug(user);
        if (foundSlug) return foundSlug;
      }
    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'getClubSlug' }, error);
    }
    return '';
  }, []);

  const resolveClubSlug = useCallback(async () => {
    const directSlug = getClubSlug();
    if (directSlug) {
      setSearchClubSlug(directSlug);
      return directSlug;
    }

    try {
      const userStored = localStorage.getItem('user');
      if (!userStored) return '';
      const user = normalizeSessionUser(JSON.parse(userStored));
      const clubId = Number(user?.activeClubId || user?.clubId || user?.club?.id);
      if (!Number.isFinite(clubId) || clubId <= 0) return '';
      const club = await ClubService.getClubById(clubId);
      const resolvedSlug = club?.slug || '';
      if (resolvedSlug) setSearchClubSlug(resolvedSlug);
      return resolvedSlug;
    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'resolveClubSlug' }, error);
      return '';
    }
  }, [getClubSlug]);

  const buildMovementLabel = useCallback((movement: Movement) => {
    const raw = String(movement?.description || '').trim();
    const isAutoPay = raw.toLowerCase().startsWith('pago cuenta');
    const isPaymentMovement = movement.type === 'INCOME' && Boolean(movement.paymentId);
    const isRefundMovement = movement.type === 'EXPENSE' && Boolean(movement.refundId);
    const isAutoRefund = raw.toLowerCase().startsWith('refund pago') || raw.toLowerCase().startsWith('devolucion');

    if (isAutoRefund && isRefundMovement) {
      if (movement.sourceType === 'BOOKING') {
        const booking = movement.booking;
        const parts = [
          booking?.clientName || null,
          booking?.courtName || null
        ].filter(Boolean);
        return parts.length > 0 ? `Devolución reserva · ${parts.join(' · ')}` : 'Devolución reserva';
      }

      if (movement.sourceType === 'BAR') {
        return 'Devolución bar';
      }

      if (movement.sourceType === 'TABLE') return 'Devolución mesa';
      if (movement.sourceType === 'MANUAL') return 'Devolución cuenta';
      return 'Devolución';
    }

    if (!isAutoPay || !isPaymentMovement) {
      return raw || 'Movimiento';
    }

    if (movement.sourceType === 'BOOKING') {
      const booking = movement.booking;
      const parts = [
        booking?.clientName || null,
        booking?.courtName || null
      ].filter(Boolean);
      return parts.length > 0 ? `Pago reserva · ${parts.join(' · ')}` : 'Pago reserva';
    }

    if (movement.sourceType === 'BAR') {
      const items = (movement.allocations || [])
        .filter((allocation) => allocation.type !== 'BOOKING')
        .map((allocation) => {
          const base = allocation.description || allocation.type || 'Item';
          const qty = allocation.quantity && allocation.quantity > 1 ? ` x${allocation.quantity}` : '';
          return `${base}${qty}`;
        })
        .filter((label) => label.trim().length > 0);

      if (items.length > 0) {
        const preview = items.slice(0, 2).join(', ');
        const extra = items.length > 2 ? ` +${items.length - 2}` : '';
        return `Pago bar · ${preview}${extra}`;
      }
      return 'Pago bar';
    }

    if (movement.sourceType === 'TABLE') return 'Pago mesa';
    if (movement.sourceType === 'MANUAL') return 'Pago cuenta';

    return 'Pago cuenta';
  }, []);

  const getMovementMethodLabel = useCallback((movement: Movement) => {
    if (movement.method === 'CASH') return 'Efectivo';
    if (movement.method === 'CARD') return 'Tarjeta';
    if (movement.channel === 'VIRTUAL_WALLET') return 'QR / Billetera';
    return 'Transferencia';
  }, []);

  const formatMovementSourceTypeLabel = useCallback((sourceType?: string | null) => {
    if (!sourceType) return 'Cuenta';
    if (sourceType === 'BOOKING') return 'Reserva';
    if (sourceType === 'BAR') return 'Bar';
    if (sourceType === 'TABLE') return 'Mesa';
    if (sourceType === 'MANUAL') return 'Cuenta';
    return sourceType
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }, []);

  const fetchCash = useCallback(async () => {
    setMovementError('');
    try {
      const { startDate, endDate } = getCashDateRange(activePeriod, periodOffset);
      const data = await CashService.getSummary({ startDate, endDate });
      if (data && data.balance) setBalance(data.balance);
      if (data && data.movements) {
        const normalizedMovements: Movement[] = (Array.isArray(data.movements) ? data.movements : []).map((movement: any) => {
          const id = Number(movement?.id);
          const createdAt = movement?.createdAt;
          const rawType = String(movement?.type || '');
          const rawMethod = String(movement?.method || '');
          const amount = Number(movement?.amount);
          const concept = movement?.concept;

          if (!Number.isFinite(id) || id <= 0) {
            throw new Error('Respuesta inválida de caja: movement.id es obligatorio.');
          }
          if (typeof createdAt !== 'string' || !createdAt.trim()) {
            throw new Error('Respuesta inválida de caja: movement.createdAt es obligatorio.');
          }
          if (!['PAYMENT_IN', 'DEPOSIT', 'REFUND', 'WITHDRAW', 'INCOME', 'EXPENSE'].includes(rawType)) {
            throw new Error(`Respuesta inválida de caja: movement.type inválido (${rawType || 'N/A'}).`);
          }
          if (!['CASH', 'CARD', 'TRANSFER'].includes(rawMethod)) {
            throw new Error(`Respuesta inválida de caja: movement.method inválido (${rawMethod || 'N/A'}).`);
          }
          if (!Number.isFinite(amount) || amount < 0) {
            throw new Error('Respuesta inválida de caja: movement.amount es obligatorio y debe ser >= 0.');
          }
          if (typeof concept !== 'string' || !concept.trim()) {
            throw new Error('Respuesta inválida de caja: movement.concept es obligatorio.');
          }

          return {
            id,
            date: createdAt,
            type: rawType === 'PAYMENT_IN' || rawType === 'DEPOSIT' || rawType === 'INCOME' ? 'INCOME' : 'EXPENSE',
            amount,
            description: concept,
            method: rawMethod as 'CASH' | 'CARD' | 'TRANSFER',
            channel: movement?.channel ?? null,
            sourceType: movement?.sourceType ?? null,
            sourceId: movement?.sourceId ?? null,
            accountId: movement?.accountId ?? null,
            bookingAmount: Number(movement?.bookingAmount || 0),
            barAmount: Number(movement?.barAmount || 0),
            paymentId: movement?.paymentId ?? null,
            refundId: movement?.refundId ?? null,
            booking: movement?.booking ?? null,
            allocations: (Array.isArray(movement?.payment?.allocations) ? movement.payment.allocations : []).map((allocation: any) => ({
              accountItemId: String(allocation?.accountItemId || ''),
              amount: Number(allocation?.amount || 0),
              type: allocation?.accountItem?.type ?? null,
              description: allocation?.accountItem?.description ?? null,
              quantity: Number(allocation?.accountItem?.quantity || 0),
              unitPrice: Number(allocation?.accountItem?.unitPrice || 0),
              total: Number(allocation?.accountItem?.total || 0)
            }))
          };
        });

        setMovements(normalizedMovements);
      }

    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'fetchCash' }, error);
      setMovementError(extractErrorMessage(error, 'No se pudieron cargar los movimientos de caja.'));
    } finally {
      setLoading(false);
    }
  }, [activePeriod, periodOffset]);

  useEffect(() => { fetchCash(); }, [fetchCash]);

  const fetchShiftContext = async () => {
    setShiftLoading(true);
    setOpenShiftError('');
    try {
      const [shift, registers] = await Promise.all([
        CashService.getCurrentShift(),
        CashService.getCashRegisters()
      ]);

      setCurrentShift(shift || null);
      setCloseShiftForm({ countedCash: '' });
      setCloseShiftError('');

      const normalizedRegisters = Array.isArray(registers) ? registers : [];
      setCashRegisters(normalizedRegisters);

      if (!shift && normalizedRegisters.length > 0) {
        setOpenShiftForm((prev) => ({
          ...prev,
          cashRegisterId: prev.cashRegisterId || String(normalizedRegisters[0].id)
        }));
      }
    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'fetchShiftContext' }, error);
      setOpenShiftError('No se pudo cargar la configuración de caja.');
    } finally {
      setShiftLoading(false);
    }
  };

  useEffect(() => { fetchShiftContext(); }, []);

  const fetchProducts = async () => {
    try {
      const data = await CashService.getProducts();
      setProducts(Array.isArray(data) ? data : []);
    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'fetchProducts' }, error);
      setSaleError(extractErrorMessage(error, 'No se pudieron cargar los productos para ventas.'));
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => { fetchProducts(); }, []);

  useEffect(() => {
    resolveClubSlug();
  }, [resolveClubSlug]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (clientWrapperRef.current && !clientWrapperRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleClientSearchChange = (value: string) => {
    setProductSale((prev) => ({ ...prev, clientQuery: value }));
    setSelectedClient(null);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (value.length < 2) {
      setShowDropdown(false);
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const slug = searchClubSlug || await resolveClubSlug();
        if (!slug) return;
        const results = await searchClients(slug, value);
        if (!Array.isArray(results)) {
          throw new Error('Respuesta inválida al buscar clientes');
        }
        setSearchResults(results);
        setShowDropdown(true);
      } catch (error) {
        reportUiError({ area: 'AdminCashDashboard', action: 'searchClients' }, error);
        setSaleError(extractErrorMessage(error, 'No se pudo buscar clientes en este momento.'));
      }
    }, 300);
  };

  const selectClient = (client: any) => {
    const fullName = String(client?.name || '').trim();
    setSelectedClient(client);
    setProductSale((prev) => ({ ...prev, clientQuery: fullName || '', guestPhone: '', guestDni: '', guestEmail: '', guestIsProfessor: false }));
    setCreateClientIfMissing(false);
    setNewClientDraft({ name: '', phone: '', dni: '', email: '', isProfessor: false });
    setShowDropdown(false);
  };

  const handleOpenCreateClientModal = () => {
    setNewClientDraft((prev) => ({
      ...prev,
      name: prev.name || String(productSale.clientQuery || '').trim()
    }));
    setShowCreateClientModal(true);
  };

  const handleConfirmCreateClientDraft = () => {
    const name = String(newClientDraft.name || '').trim();
    const phone = String(newClientDraft.phone || '').trim();
    const dni = String(newClientDraft.dni || '').trim();
    const email = String(newClientDraft.email || '').trim();
    const isProfessor = Boolean(newClientDraft.isProfessor);

    if (name.length < 2) {
      setSaleError('Para crear cliente, ingresá un nombre válido.');
      return;
    }
    if (phone.length < 7) {
      setSaleError('Para crear cliente, ingresá un teléfono válido.');
      return;
    }
    if (dni.length < 6) {
      setSaleError('Para crear cliente, ingresá un DNI válido.');
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSaleError('Para crear cliente, ingresá un email válido o dejalo vacío.');
      return;
    }

    setSelectedClient(null);
    setCreateClientIfMissing(true);
    setProductSale((prev) => ({
      ...prev,
      clientQuery: name,
      guestPhone: phone,
      guestDni: dni,
      guestEmail: email,
      guestIsProfessor: isProfessor
    }));
    setShowCreateClientModal(false);
    setSaleError('');
  };

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setMovementError('');
    if (!currentShift) {
      setOpenShiftError('Primero tenés que abrir la caja para registrar movimientos.');
      return;
    }
    if (!newMove.amount || !newMove.description) return;
    setShowMovementMethodPicker(true);
  };

  const handleConfirmMovementWithMethod = async (method: 'CASH' | 'TRANSFER' | 'CARD') => {
    if (movementSubmitting) return;
    try {
      setMovementSubmitting(true);
      await CashService.createMovement({
        amount: newMove.amount,
        description: newMove.description,
        type: newMove.type as 'INCOME' | 'EXPENSE',
        method
      });

      setNewMove({ description: '', amount: '', type: 'INCOME' });
      setShowMovementMethodPicker(false);
      setActionFeedback({
        show: true,
        title: 'Movimiento registrado',
        message: `Se registró ${newMove.type === 'INCOME' ? 'el ingreso' : 'el egreso'} por $${Number(newMove.amount || 0).toLocaleString()}.`
      });
      fetchCash();
    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'addMovement' }, error);
      setMovementError(extractErrorMessage(error, 'No se pudo registrar el movimiento.'));
    } finally {
      setMovementSubmitting(false);
    }
  };

  const buildSaleItemPayload = useCallback((item: SaleCartItem) => {
    if (item.productId) {
      return {
        itemKey: item.itemKey,
        productId: Number(item.productId),
        quantity: Number(item.quantity)
      };
    }

    return {
      itemKey: item.itemKey,
      customName: String(item.productName || '').trim(),
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice || 0)
    };
  }, []);

  const handleProductSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaleError('');

    if (!currentShift) {
      setSaleError('Primero tenés que abrir la caja para registrar ventas.');
      return;
    }

    if (!Array.isArray(saleCart) || saleCart.length === 0) {
      setSaleError('Agregá al menos un producto al carrito.');
      return;
    }

    const totalAmount = Number(saleQuote?.finalTotal || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      setSaleError('No se pudo cotizar el total de la venta. Reintentá.');
      return;
    }
    const configuredPayments = salePayments
      .map((payment) => ({
        method: payment.method,
        channel: payment.method === 'TRANSFER' ? (payment.channel || 'BANK_ACCOUNT') : undefined,
        amount: Number(payment.amount || 0),
        allocations: (payment.allocations || []).map((allocation) => ({
          itemKey: String(allocation.itemKey || ''),
          amount: Number(allocation.amount || 0)
        }))
      }))
      .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

    const hasDebtInSale = false;
    const fallbackGuestName = productSale.clientQuery.trim();
    const fallbackGuestPhone = String(productSale.guestPhone || '').trim();
    const fallbackGuestDni = String(productSale.guestDni || '').trim();
    const fallbackGuestEmail = String(productSale.guestEmail || '').trim();
    const fallbackGuestIsProfessor = Boolean(productSale.guestIsProfessor);

    if (!selectedClient && createClientIfMissing) {
      if (fallbackGuestName.length < 2) {
        setSaleError('Para crear cliente, ingresá un nombre válido.');
        return;
      }
      if (fallbackGuestPhone.length < 7) {
        setSaleError('Para crear cliente, ingresá un teléfono válido.');
        return;
      }
      if (fallbackGuestDni.length < 6) {
        setSaleError('Para crear cliente, ingresá un DNI válido.');
        return;
      }
      if (fallbackGuestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallbackGuestEmail)) {
        setSaleError('Para crear cliente, ingresá un email válido o dejalo vacío.');
        return;
      }
    }

    if (configuredPayments.length === 0) {
      setSaleError('Configurá el cobro con la calculadora antes de registrar la venta.');
      return;
    }
    const splitTotal = configuredPayments.reduce((sum, payment) => sum + payment.amount, 0);
    if (Math.abs(splitTotal - totalAmount) > 0.01) {
      setSaleError('La suma de los pagos debe coincidir con el total de la venta.');
      return;
    }

    if (hasDebtInSale && !selectedClient && !fallbackGuestName) {
      setSaleError('Para registrar fiado, seleccioná un cliente o escribí al menos un nombre.');
      return;
    }

    try {
      await CashService.createProductSale({
        items: saleCart.map(buildSaleItemPayload),
        method: configuredPayments[0].method,
        channel: configuredPayments[0].method === 'TRANSFER' ? configuredPayments[0].channel : undefined,
        payments: configuredPayments,
        clientId: selectedClient?.id ? String(selectedClient.id) : undefined,
        createClientIfMissing: !selectedClient && createClientIfMissing,
        guestName: selectedClient
          ? String(selectedClient?.name || '').trim()
          : (createClientIfMissing ? fallbackGuestName : undefined),
        guestPhone: selectedClient?.phone || (createClientIfMissing ? fallbackGuestPhone : undefined),
        guestDni: selectedClient?.dni || (createClientIfMissing ? fallbackGuestDni : undefined),
        guestEmail: selectedClient?.email || (createClientIfMissing ? fallbackGuestEmail : undefined),
        guestIsProfessor: createClientIfMissing ? fallbackGuestIsProfessor : undefined
      });

      setProductSale({
        productQuery: '',
        manualUnitPrice: '',
        quantity: '1',
        clientQuery: '',
        guestPhone: '',
        guestDni: '',
        guestEmail: '',
        guestIsProfessor: false
      });
      setCreateClientIfMissing(false);
      setSaleCart([]);
      setSaleQuote(null);
      setSalePayments([]);
      setSelectedClient(null);
      setSelectedSaleProduct(null);
      setSaleProductSearchKey((prev) => prev + 1);
      setActionFeedback({
        show: true,
        title: 'Venta registrada',
        message: `Se registró la venta por $${Number(totalAmount || 0).toLocaleString()}.`
      });
      fetchCash();
      fetchProducts();
    } catch (error: any) {
      setSaleError(error.message || 'Error al registrar venta');
    }
  };

  const handleOpenSalePaymentCalculator = () => {
    setSaleError('');
    if (!currentShift) {
      setSaleError('Primero tenés que abrir la caja para registrar ventas.');
      return;
    }
    if (!Array.isArray(saleCart) || saleCart.length === 0) {
      setSaleError('Agregá al menos un producto al carrito antes de cobrar.');
      return;
    }
    const totalAmount = Number(saleQuote?.finalTotal || 0);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      setSaleError('No se pudo cotizar el total de la venta. Reintentá.');
      return;
    }
    setShowSalePaymentCalculator(true);
  };

  const handleSalePaymentConfirm = async (result: PaymentCalculatorResult) => {
    const amount = Number(result.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const method = result.method === 'OTHER' ? 'CASH' : result.method;
    const allocations = (result.itemAllocations || [])
      .map((entry) => ({
        itemKey: String(entry.key || '').trim(),
        amount: Number(entry.amount || 0)
      }))
      .filter((entry) => entry.itemKey.length > 0 && Number.isFinite(entry.amount) && entry.amount > 0.009)
      .map((entry) => ({
        itemKey: entry.itemKey,
        amount: Number(entry.amount.toFixed(2))
      }));
    const nextPayment: SalePayment = {
      method,
      channel: method === 'TRANSFER' ? (result.channel || 'BANK_ACCOUNT') : undefined,
      amount: Number(amount.toFixed(2)),
      allocations
    };
    setSalePayments((prev) => [...prev, nextPayment]);
    setShowSalePaymentCalculator(false);
  };

  const handleAddProductToSaleCart = () => {
    setSaleError('');
    const qty = Number(productSale.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setSaleError('Seleccioná una cantidad válida.');
      return;
    }

    if (selectedSaleProduct?.id) {
      const currentQuantityInCart = Number(
        saleCart.find((item) => Number(item.productId) === Number(selectedSaleProduct.id))?.quantity || 0
      );
      const nextQuantityInCart = currentQuantityInCart + qty;
      if (Number(selectedSaleProduct.stock || 0) < nextQuantityInCart) {
        setSaleError(
          currentQuantityInCart > 0
            ? `Stock insuficiente. Ya tenés ${currentQuantityInCart} unidad(es) en el carrito y el stock disponible es ${Number(selectedSaleProduct.stock || 0)}.`
            : 'Stock insuficiente.'
        );
        return;
      }

      setSaleCart((prev) => {
        const next = [...prev];
        const idx = next.findIndex((item) => Number(item.productId) === Number(selectedSaleProduct.id));
        if (idx === -1) {
          next.push({
            itemKey: `product:${Number(selectedSaleProduct.id)}`,
            productId: Number(selectedSaleProduct.id),
            productName: selectedSaleProduct.name,
            quantity: qty,
            unitPrice: Number(selectedSaleProduct.price || 0),
            isCustom: false,
            stock: selectedSaleProduct.stock ?? null
          });
        } else {
          next[idx] = {
            ...next[idx],
            quantity: Number(next[idx].quantity) + qty,
            unitPrice: Number(selectedSaleProduct.price || next[idx].unitPrice || 0),
            stock: selectedSaleProduct.stock ?? next[idx].stock ?? null
          };
        }
        return next;
      });
      setSelectedSaleProduct(null);
      setSaleProductSearchKey((prev) => prev + 1);
      setProductSale((prev) => ({ ...prev, productQuery: '', manualUnitPrice: '', quantity: '1' }));
      return;
    }

    const manualName = String(productSale.productQuery || '').trim();
    const manualUnitPrice = Number(productSale.manualUnitPrice);
    if (manualName.length < 2) {
      setSaleError('Escribí un producto o detalle válido.');
      return;
    }
    const existingProduct = products.find((product) => normalizeSaleItemName(product.name) === normalizeSaleItemName(manualName));
    if (existingProduct) {
      setSaleError('Ese producto ya existe en catálogo. Seleccionalo del listado para respetar stock y descuentos.');
      return;
    }
    if (!Number.isFinite(manualUnitPrice) || manualUnitPrice <= 0) {
      setSaleError('Cargá un precio unitario válido para el item manual.');
      return;
    }

    setSaleCart((prev) => {
      const next = [...prev];
      const roundedUnitPrice = Number(manualUnitPrice.toFixed(2));
      const idx = next.findIndex((item) =>
        item.isCustom &&
        normalizeSaleItemName(item.productName) === normalizeSaleItemName(manualName) &&
        Math.abs(Number(item.unitPrice || 0) - roundedUnitPrice) <= 0.01
      );
      if (idx === -1) {
        next.push({
          itemKey: `custom:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          productName: manualName,
          quantity: qty,
          unitPrice: roundedUnitPrice,
          isCustom: true
        });
      } else {
        next[idx] = {
          ...next[idx],
          quantity: Number(next[idx].quantity) + qty
        };
      }
      return next;
    });
    setSaleProductSearchKey((prev) => prev + 1);
    setProductSale((prev) => ({ ...prev, productQuery: '', manualUnitPrice: '', quantity: '1' }));
  };

  const handleRemoveSaleCartItem = (itemKey: string) => {
    setSaleCart((prev) => prev.filter((item) => String(item.itemKey) !== String(itemKey)));
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        if (!currentShift) {
          setSaleQuote(null);
          setSaleError('');
          return;
        }
        if (!saleCart || saleCart.length === 0) {
          setSaleQuote(null);
          setSaleError('');
          return;
        }
        const fallbackGuestName = productSale.clientQuery.trim();
        const fallbackGuestPhone = String(productSale.guestPhone || '').trim();
        const fallbackGuestDni = String(productSale.guestDni || '').trim();
        const fallbackGuestEmail = String(productSale.guestEmail || '').trim();
        const fallbackGuestIsProfessor = Boolean(productSale.guestIsProfessor);

        const quote = await CashService.quoteProductSale({
          items: saleCart.map(buildSaleItemPayload),
          clientId: selectedClient?.id ? String(selectedClient.id) : undefined,
          createClientIfMissing: !selectedClient && createClientIfMissing,
          guestName: selectedClient
            ? String(selectedClient?.name || '').trim()
            : (createClientIfMissing ? fallbackGuestName : undefined),
          guestPhone: selectedClient?.phone || (createClientIfMissing ? fallbackGuestPhone : undefined),
          guestDni: selectedClient?.dni || (createClientIfMissing ? fallbackGuestDni : undefined),
          guestEmail: selectedClient?.email || (createClientIfMissing ? fallbackGuestEmail : undefined),
          guestIsProfessor: createClientIfMissing ? fallbackGuestIsProfessor : undefined
        });
        if (!cancelled) {
          setSaleQuote(quote);
          setSaleError('');
        }
      } catch (error) {
        if (!cancelled) {
          setSaleQuote(null);
          setSaleError(extractErrorMessage(error, 'No se pudo cotizar la venta.'));
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    buildSaleItemPayload,
    currentShift,
    saleCart,
    selectedClient,
    createClientIfMissing,
    productSale.clientQuery,
    productSale.guestPhone,
    productSale.guestDni,
    productSale.guestEmail,
    productSale.guestIsProfessor
  ]);

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setOpenShiftError('');

    if (!openShiftForm.cashRegisterId) {
      setOpenShiftError('Seleccioná una caja registradora.');
      return;
    }

    const openingAmount = Number(openShiftForm.openingAmount);
    if (!Number.isFinite(openingAmount) || openingAmount < 0) {
      setOpenShiftError('Ingresá un monto de apertura válido.');
      return;
    }

    try {
      setOpeningShift(true);
      const openedShift = await CashService.openShift({
        cashRegisterId: openShiftForm.cashRegisterId,
        openingAmount
      });
      setCurrentShift(openedShift);
      setLastClosedReport(null);
      setShowLastCloseDetails(false);
      await fetchCash();
    } catch (error: any) {
      setOpenShiftError(error.message || 'No se pudo abrir la caja.');
    } finally {
      setOpeningShift(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloseShiftError('');

    const countedCash = Number(closeShiftForm.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      setCloseShiftError('Ingresá un monto contado válido.');
      return;
    }

    try {
      setClosingShift(true);
      const closedShift = await CashService.closeCurrentShift({ countedCash });

      try {
        if (closedShift?.id) {
          const report = await CashService.getShiftReport(String(closedShift.id));
          setLastClosedReport(report);
          setShowLastCloseDetails(false);
        } else {
          setLastClosedReport(null);
          setShowLastCloseDetails(false);
        }
      } catch (reportError) {
        reportUiError({ area: 'AdminCashDashboard', action: 'loadCloseReport' }, reportError);
        setLastClosedReport(null);
        setShowLastCloseDetails(false);
      }

      setCurrentShift(null);
      await fetchShiftContext();
      await fetchCash();
    } catch (error: any) {
      setCloseShiftError(error.message || 'No se pudo cerrar la caja.');
    } finally {
      setClosingShift(false);
    }
  };

  const saleClientQueryResetDependency = createClientIfMissing ? productSale.clientQuery : '';

  useEffect(() => {
    setSalePayments([]);
  }, [
    saleCart,
    selectedClient?.id,
    createClientIfMissing,
    productSale.guestPhone,
    productSale.guestDni,
    productSale.guestEmail,
    productSale.guestIsProfessor,
    saleClientQueryResetDependency
  ]);

  const saleItemPaidMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of salePayments) {
      for (const allocation of payment.allocations || []) {
        const itemKey = String(allocation.itemKey || '').trim();
        const amount = Number(allocation.amount || 0);
        if (!itemKey || !Number.isFinite(amount) || amount <= 0) continue;
        map.set(itemKey, Number(((map.get(itemKey) || 0) + amount).toFixed(2)));
      }
    }
    return map;
  }, [salePayments]);

  const saleRemainingItems = useMemo(() => {
    const quotedItems = Array.isArray(saleQuote?.items) ? saleQuote.items : [];
    return quotedItems.map((item: any) => {
      const itemKey = String(item.itemKey || '');
      const itemTotal = Number(item.finalTotal || 0);
      const paidAmount = Number((saleItemPaidMap.get(itemKey) || 0).toFixed(2));
      const remainingAmount = Math.max(0, Number((itemTotal - paidAmount).toFixed(2)));
      return {
        ...item,
        itemKey,
        paidAmount,
        remainingAmount
      };
    });
  }, [saleQuote, saleItemPaidMap]);

  const saleTotalAmount = Number(saleQuote?.finalTotal || 0);
  const saleConfiguredTotal = salePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const saleRemaining = Number(
    saleRemainingItems.reduce((sum, item: any) => sum + Number(item.remainingAmount || 0), 0).toFixed(2)
  );
  const moveAmount = Number(newMove.amount);
  const canSubmitMovement = Boolean(
    currentShift &&
    String(newMove.description || '').trim().length > 0 &&
    Number.isFinite(moveAmount) &&
    moveAmount > 0 &&
    !movementSubmitting
  );
  const canSubmitSale = Boolean(
    currentShift &&
    saleCart.length > 0 &&
    saleTotalAmount > 0 &&
    salePayments.length > 0 &&
    Math.abs(saleConfiguredTotal - saleTotalAmount) <= 0.01 &&
    (
      !createClientIfMissing ||
      (
        String(productSale.clientQuery || '').trim().length >= 2 &&
        String(productSale.guestPhone || '').trim().length >= 7 &&
        String(productSale.guestDni || '').trim().length >= 6 &&
        (
          String(productSale.guestEmail || '').trim().length === 0 ||
          /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(productSale.guestEmail || '').trim())
        )
      )
    )
  );

  if (loading) return (
    <div className="flex flex-col items-center justify-center p-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-4 border-[#EBE1D8]"></div>
        <p className="text-[#EBE1D8] font-black uppercase tracking-widest mt-4">Cargando Billetera...</p>
    </div>
  );

  return (
    <>
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* TÍTULO DE SECCIÓN */}
      <div className="flex items-center justify-between mb-2">
        <div>
           <h2 className="text-3xl font-black text-[#EBE1D8] flex items-center gap-3 uppercase italic tracking-tighter">
          <div className="bg-[#B9CF32] text-[#347048] p-2 rounded-xl shadow-lg shadow-[#B9CF32]/20">
            <Wallet size={28} strokeWidth={3} />
          </div>
          Caja y Movimientos
        </h2>
            <p className="text-[#EBE1D8]/60 text-xs font-bold uppercase tracking-[0.2em] mt-1 ml-14">Resumen diario y control de flujo</p>
        </div>
        <div className="bg-[#347048]/40 border border-[#EBE1D8]/10 px-4 py-2 rounded-2xl backdrop-blur-sm">
            <span className="text-[#EBE1D8] font-black text-sm uppercase italic">{new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long' })}</span>
        </div>
      </div>

      {lastClosedReport && !currentShift && (
        <div className="bg-[#EBE1D8] border-4 border-white p-6 rounded-[2.5rem] shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <p className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest">Último cierre de caja</p>
              <h3 className="text-xl font-black text-[#347048] uppercase italic tracking-tight mt-1">Resumen de cierre</h3>
            </div>
            <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-full border w-fit ${
              Number(lastClosedReport.difference || 0) === 0
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : Number(lastClosedReport.difference || 0) > 0
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {Number(lastClosedReport.difference || 0) === 0
                ? 'Caja cuadrada'
                : Number(lastClosedReport.difference || 0) > 0
                  ? 'Sobrante'
                  : 'Faltante'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-4 border border-[#347048]/10">
              <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Esperado</p>
              <p className="text-2xl font-black text-[#347048] italic mt-2">${Number(lastClosedReport.expectedCash || 0).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-[#347048]/10">
              <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Contado</p>
              <p className="text-2xl font-black text-[#347048] italic mt-2">${Number(lastClosedReport.countedCash || 0).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl p-4 border border-[#347048]/10">
              <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Diferencia</p>
              <p className={`text-2xl font-black italic mt-2 ${
                Number(lastClosedReport.difference || 0) === 0
                  ? 'text-emerald-700'
                  : Number(lastClosedReport.difference || 0) > 0
                    ? 'text-blue-700'
                    : 'text-red-700'
              }`}>
                {Number(lastClosedReport.difference || 0) > 0 ? '+' : ''}${Number(lastClosedReport.difference || 0).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowLastCloseDetails((prev) => !prev)}
              className="w-full md:w-auto px-6 py-2.5 bg-white border border-[#347048]/20 text-[#347048] rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-[#347048]/5 transition-all"
            >
              {showLastCloseDetails ? 'Ocultar detalle completo' : 'Ver detalle completo'}
            </button>
          </div>

          {showLastCloseDetails && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
              <div className="bg-white rounded-2xl p-4 border border-[#347048]/10">
                <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Ingresos por cobros</p>
                <p className="text-lg font-black text-emerald-700 italic mt-2">+${Number(lastClosedReport.totals?.paymentIn || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-2xl p-4 border border-[#347048]/10">
                <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Depósitos</p>
                <p className="text-lg font-black text-emerald-700 italic mt-2">+${Number(lastClosedReport.totals?.deposit || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-2xl p-4 border border-[#347048]/10">
                <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Retiros</p>
                <p className="text-lg font-black text-red-700 italic mt-2">-${Number(lastClosedReport.totals?.withdraw || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white rounded-2xl p-4 border border-[#347048]/10">
                <p className="text-[10px] font-black text-[#347048]/50 uppercase tracking-widest">Devoluciones</p>
                <p className="text-lg font-black text-red-700 italic mt-2">-${Number(lastClosedReport.totals?.refund || 0).toLocaleString()}</p>
              </div>
            </div>
          )}

          {lastClosedReport.shift?.closedAt && (
            <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mt-4">
              Cerrada: {formatDateTime24(lastClosedReport.shift.closedAt)}
            </p>
          )}
        </div>
      )}

      <div className="bg-[#EBE1D8] border-4 border-white p-6 rounded-[2.5rem] shadow-2xl">
        {shiftLoading ? (
          <p className="text-xs font-black uppercase tracking-widest text-[#347048]/60">Cargando estado de caja...</p>
        ) : currentShift ? (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest">Turno de caja activo</p>
                <h3 className="text-xl font-black text-[#347048] uppercase italic tracking-tight mt-1">
                  {currentShift.cashRegister?.name || 'Caja activa'}
                </h3>
                <p className="text-xs font-bold text-[#347048]/70 mt-1">
                  Apertura: ${Number(currentShift.openingAmount || 0).toLocaleString()} · {formatDateTime24(currentShift.openedAt)}
                </p>
              </div>
              <span className="text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-full w-fit">
                Caja abierta
              </span>
            </div>

            <form onSubmit={handleCloseShift} className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 md:items-end">
              <div>
                <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Monto contado al cierre ($)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  onWheel={(event) => {
                    event.currentTarget.blur();
                  }}
                  className="w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-4 text-[#347048] font-black focus:outline-none shadow-sm transition-all"
                  value={closeShiftForm.countedCash}
                  onChange={(e) => setCloseShiftForm({ countedCash: e.target.value })}
                />
              </div>
              <button
                type="submit"
                disabled={closingShift}
                className="h-14 px-8 bg-[#926699] hover:bg-[#347048] text-[#EBE1D8] font-black rounded-[1.2rem] shadow-xl transition-all uppercase tracking-widest text-xs italic disabled:opacity-70"
              >
                {closingShift ? 'Cerrando...' : 'Cerrar caja'}
              </button>
            </form>

            {Number(currentShift.openAccountsSummary?.openAccounts || 0) > 0 ? (
              <div className={`rounded-xl border px-3 py-2 text-xs font-black ${
                currentShift.closePolicy?.strict
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-amber-50 border-amber-200 text-amber-700'
              }`}>
                {currentShift.closePolicy?.strict
                  ? 'Modo estricto activo'
                  : 'Aviso'}: {Number(currentShift.openAccountsSummary?.openAccounts || 0)} cuentas abiertas / ${Number(currentShift.openAccountsSummary?.pendingAmount || 0).toLocaleString()} pendiente.
              </div>
            ) : null}

            {closeShiftError && (
              <p className="text-xs font-bold text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{closeShiftError}</p>
            )}
          </div>
        ) : (
          <form onSubmit={handleOpenShift} className="space-y-4">
            <div>
              <p className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest">No hay turno de caja abierto</p>
              <h3 className="text-xl font-black text-[#347048] uppercase italic tracking-tight mt-1">Abrir caja</h3>
            </div>

            {cashRegisters.length === 0 ? (
              <p className="text-xs font-bold text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">
                No hay cajas registradoras creadas para este club.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="relative z-20">
                    <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Caja registradora</label>
                    <CustomSelect
                      value={openShiftForm.cashRegisterId}
                      onChange={(val: string) => setOpenShiftForm((prev) => ({ ...prev, cashRegisterId: val }))}
                      placeholder="Seleccionar caja"
                      options={cashRegisters.map((register) => ({
                        value: String(register.id),
                        label: register.location ? `${register.name} · ${register.location}` : register.name
                      }))}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Monto de apertura ($)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="0"
                      className="w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-4 text-[#347048] font-black focus:outline-none shadow-sm transition-all"
                      value={openShiftForm.openingAmount}
                      onChange={(e) => setOpenShiftForm((prev) => ({ ...prev, openingAmount: e.target.value }))}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={openingShift}
                  className="w-full md:w-auto px-8 py-3 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-[1.2rem] shadow-xl shadow-[#347048]/20 transition-all uppercase tracking-widest text-xs italic disabled:opacity-70"
                >
                  {openingShift ? 'Abriendo...' : 'Abrir caja'}
                </button>
              </>
            )}

            {openShiftError && (
              <p className="text-xs font-bold text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{openShiftError}</p>
            )}
          </form>
        )}
      </div>

      {/* HEADER DE BALANCE (TARJETAS BLANCAS) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* BALANCE TOTAL */}
        <div className="bg-white border-4 border-white p-6 rounded-[2.5rem] shadow-xl flex flex-col justify-between relative overflow-hidden group">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-[#347048]/5 rounded-2xl text-[#347048]"><Wallet size={24} strokeWidth={2.5} /></div>
            <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Balance Período</span>
          </div>
          <p className="text-4xl font-black text-[#347048] italic tracking-tighter mb-4">
            ${(balance?.total || 0).toLocaleString()}
          </p>
          <div className="flex gap-2 text-[9px] font-black uppercase tracking-wider">
            <span className="text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100 flex items-center gap-1">
              <ArrowUpCircle size={12}/> +${(balance?.income || 0).toLocaleString()}
            </span>
            <span className="text-red-500 bg-red-50 px-3 py-1 rounded-full border border-red-100 flex items-center gap-1">
              <ArrowDownCircle size={12}/> -${(balance?.expense || 0).toLocaleString()}
            </span>
          </div>
        </div>

        {/* EFECTIVO EN CAJA */}
        <div className="bg-white border-4 border-white p-6 rounded-[2.5rem] shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600"><Banknote size={24} strokeWidth={2.5} /></div>
            <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Efectivo Físico</span>
          </div>
          <p className="text-4xl font-black text-[#347048] italic tracking-tighter mb-4">
            ${(balance?.cash || 0).toLocaleString()}
          </p>
          <p className="text-[10px] font-bold text-[#347048]/40 uppercase italic tracking-widest">Dinero en caja fuerte</p>
        </div>

        {/* BANCO / TRANSFERENCIAS */}
        <div className="bg-white border-4 border-white p-6 rounded-[2.5rem] shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-50 rounded-2xl text-blue-600"><CreditCard size={24} strokeWidth={2.5} /></div>
            <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Banco / Transferencias</span>
          </div>
          <p className="text-4xl font-black text-[#347048] italic tracking-tighter mb-4">
            ${(balance?.digital || 0).toLocaleString()}
          </p>
          <p className="text-[10px] font-bold text-[#347048]/40 uppercase italic tracking-widest">Billeteras virtuales y bancos</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LISTA DE MOVIMIENTOS */}
        <div className="lg:col-span-2 bg-[#EBE1D8] border-4 border-white/50 rounded-[2.5rem] overflow-hidden shadow-2xl shadow-[#347048]/20 flex flex-col min-h-[500px]">
          <div className="p-6 border-b border-[#347048]/10 flex justify-between items-center bg-[#EBE1D8]">
            <h3 className="text-xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tight">
                <History size={20} className="text-[#926699]" /> Actividad Reciente
            </h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-white/50 rounded-xl overflow-hidden border border-white/80">
                <button
                  type="button"
                  onClick={() => setPeriodOffset((prev) => prev - 1)}
                  className="p-2 text-[#347048] hover:bg-[#347048]/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#347048]/20"
                >
                  <ChevronLeft size={16} strokeWidth={3} />
                </button>
                <span className="text-[#347048] font-black text-[10px] uppercase tracking-widest px-2 min-w-[110px] text-center">
                  {getPeriodLabel()}
                </span>
                <button
                  type="button"
                  onClick={() => setPeriodOffset((prev) => prev + 1)}
                  disabled={periodOffset === 0}
                  className={`p-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#347048]/20 ${periodOffset === 0 ? 'text-[#347048]/20' : 'text-[#347048] hover:bg-[#347048]/10'}`}
                >
                  <ChevronRight size={16} strokeWidth={3} />
                </button>
              </div>
              <div className="flex items-center gap-1 bg-white/50 p-1 rounded-lg border border-white/80">
                <button
                  type="button"
                  onClick={() => handlePeriodChange('hoy')}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#347048]/20 ${activePeriod === 'hoy' ? 'bg-[#347048] text-white shadow-md border-[#347048]' : 'text-[#347048] border-transparent hover:bg-[#347048]/10'}`}
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => handlePeriodChange('semana')}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#347048]/20 ${activePeriod === 'semana' ? 'bg-[#347048] text-white shadow-md border-[#347048]' : 'text-[#347048] border-transparent hover:bg-[#347048]/10'}`}
                >
                  Semana
                </button>
                <button
                  type="button"
                  onClick={() => handlePeriodChange('mes')}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all border focus:outline-none focus-visible:ring-2 focus-visible:ring-[#347048]/20 ${activePeriod === 'mes' ? 'bg-[#347048] text-white shadow-md border-[#347048]' : 'text-[#347048] border-transparent hover:bg-[#347048]/10'}`}
                >
                  Mes
                </button>
              </div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-white/40">
            {movements.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30 italic">
                  <Receipt size={48} className="mb-4" />
                  <p className="text-lg font-black uppercase tracking-widest text-[#347048]">No hay movimientos en el período</p>
              </div>
            ) : (
              <div className="space-y-3">
                {movements.map((m) => (
                  <div
                    key={m.id}
                    role="button"
                    onClick={() => {
                      setSelectedMovement(m);
                      setShowMovementModal(true);
                    }}
                    className="bg-white p-4 rounded-2xl flex items-center justify-between shadow-sm border border-[#347048]/5 hover:scale-[1.01] transition-transform cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                        <div className="text-right pr-4 border-r border-[#347048]/10">
                            <span className="block text-xs font-black text-[#347048]">
                                {(() => {
                                  const parsed = new Date(m.date);
                                  if (Number.isNaN(parsed.getTime())) return '--:--';
                                  return formatTime24(parsed, { fallback: '--:--' });
                                })()}
                            </span>
                            <span className="text-[9px] font-bold text-[#347048]/40 uppercase">Hora</span>
                        </div>
                        <div>
                            <span className="block text-sm font-black text-[#347048] uppercase tracking-tight leading-none mb-1">
                                {buildMovementLabel(m)}
                            </span>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest flex items-center gap-1 w-fit ${
                              m.method === 'CASH'
                                ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
                                : m.method === 'CARD'
                                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                                  : 'bg-blue-50 text-blue-600 border-blue-100'
                            }`}>
                              {m.method === 'CASH'
                                ? <><Banknote size={10} strokeWidth={3} /> Efectivo</>
                                : m.method === 'CARD'
                                  ? <><CreditCard size={10} strokeWidth={3} /> Tarjeta</>
                                  : <><CreditCard size={10} strokeWidth={3} /> {getMovementMethodLabel(m)}</>}
                            </span>
                            {(Number(m.bookingAmount || 0) > 0 || Number(m.barAmount || 0) > 0) ? (
                              <span className="text-[9px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest w-fit bg-white/60 text-[#347048]/70 border-[#347048]/20">
                                {[
                                  Number(m.bookingAmount || 0) > 0 ? `Reserva ${Number(m.bookingAmount || 0).toLocaleString()}` : null,
                                  Number(m.barAmount || 0) > 0 ? `Bar ${Number(m.barAmount || 0).toLocaleString()}` : null
                                ].filter(Boolean).join(' · ')}
                              </span>
                            ) : m.sourceType ? (
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-md border uppercase tracking-widest w-fit ${
                                m.sourceType === 'BOOKING'
                                  ? 'bg-[#B9CF32]/20 text-[#347048] border-[#B9CF32]/40'
                                  : m.sourceType === 'BAR'
                                    ? 'bg-[#926699]/15 text-[#926699] border-[#926699]/30'
                                    : 'bg-white/60 text-[#347048]/60 border-[#347048]/20'
                              }`}>
                                {m.sourceType === 'BOOKING'
                                  ? 'Reserva'
                                  : m.sourceType === 'BAR'
                                    ? 'Bar'
                                    : formatMovementSourceTypeLabel(m.sourceType)}
                              </span>
                            ) : null}
                        </div>
                    </div>
                    <div className={`text-xl font-black italic tracking-tighter ${
                        m.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                        {m.type === 'INCOME' ? '+' : '-'}${m.amount.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
  {/* FORMULARIO AGREGAR RÁPIDO */}
        <div className="bg-[#EBE1D8] border-4 border-white p-6 rounded-[2.5rem] shadow-2xl h-fit">
          <h3 className="text-xl font-black text-[#926699] mb-8 flex items-center gap-3 uppercase italic tracking-tight">
            <Plus size={24} strokeWidth={3} className="bg-[#926699] text-[#EBE1D8] rounded-lg p-1" /> Nuevo Registro
          </h3>
          
          <form onSubmit={handleAddMovement} className="space-y-6">
            <div>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Concepto / Detalle</label>
              <input 
                type="text" 
                placeholder="Ej: Retiro, Compra Insumos..."
                className="w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-4 text-[#347048] font-bold focus:outline-none shadow-sm placeholder-[#347048]/20 transition-all"
                value={newMove.description}
                onChange={e => setNewMove({...newMove, description: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="relative z-10">
                <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Monto ($)</label>
                <input 
                  type="number" 
                  placeholder="0"
                  className="w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-4 text-[#347048] font-black focus:outline-none shadow-sm transition-all"
                  value={newMove.amount}
                  onChange={e => setNewMove({...newMove, amount: e.target.value})}
                />
              </div>
              <div className="relative focus-within:z-[100] z-20">
                <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Operación</label>
                <CustomSelect 
                    value={newMove.type}
                    onChange={(val: string) => setNewMove({...newMove, type: val})}
                    placeholder="Seleccionar..."
                    options={[
                        { value: 'INCOME', label: 'Ingreso (+)' },
                        { value: 'EXPENSE', label: 'Gasto (-)' }
                    ]}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={!canSubmitMovement}
              className="w-full py-4 bg-[#B9CF32] hover:bg-[#aebd2b] text-[#347048] font-black rounded-[1.5rem] shadow-xl shadow-[#B9CF32]/20 transition-all hover:-translate-y-1 active:scale-95 uppercase tracking-widest text-sm italic mt-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              Registrar Movimiento
            </button>
            {movementError && (
              <p className="text-xs font-bold text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{movementError}</p>
            )}
            {!currentShift && (
              <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Abrí la caja para habilitar registros.</p>
            )}
          </form>
        </div>

        {/* FORMULARIO VENTA DE PRODUCTOS */}
        <div className="bg-[#EBE1D8] border-4 border-white p-6 rounded-[2.5rem] shadow-2xl h-fit">
          <h3 className="text-xl font-black text-[#347048] mb-8 flex items-center gap-3 uppercase italic tracking-tight">
            <Receipt size={22} strokeWidth={3} className="text-[#B9CF32]" /> Venta de productos
          </h3>

          <form onSubmit={handleProductSale} className="space-y-6">
            <div className="relative z-30" ref={clientWrapperRef}>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Cliente</label>
              <input
                type="text"
                placeholder="Buscar por nombre, DNI o teléfono..."
                className="w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-4 text-[#347048] font-bold placeholder-[#347048]/20 focus:outline-none shadow-sm transition-all"
                value={productSale.clientQuery}
                onChange={(e) => handleClientSearchChange(e.target.value)}
              />
              {showDropdown && searchResults.length > 0 && (
                <ul className="absolute z-[110] w-full mt-2 bg-white border-2 border-[#347048]/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto custom-scrollbar">
                  {searchResults.map((client) => (
                    <li
                      key={client.id}
                      onClick={() => selectClient(client)}
                      className="px-4 py-3 hover:bg-[#B9CF32]/20 cursor-pointer text-[#347048] border-b border-[#347048]/5 last:border-0 transition-colors"
                    >
                      <div className="font-black text-sm">{String(client?.name || 'Cliente')}</div>
                      <div className="text-[10px] font-bold text-[#347048]/60 flex gap-3 mt-1 uppercase">
                        {client.phone && (
                          <span className="flex items-center gap-1">
                            <Phone size={12} strokeWidth={2.5} /> {client.phone}
                          </span>
                        )}
                        {client.dni && (
                          <span className="flex items-center gap-1">
                            <IdCard size={12} strokeWidth={2.5} /> {client.dni}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {selectedClient && (
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#347048]/60">
                  Cliente seleccionado: {String(selectedClient?.name || '')}
                </p>
              )}
              {!selectedClient && (
                <div className="mt-2 space-y-2">
                  <button
                    type="button"
                    onClick={handleOpenCreateClientModal}
                    className="h-10 px-3 rounded-xl bg-white border border-[#347048]/20 text-[#347048] text-[10px] font-black uppercase tracking-widest hover:bg-[#347048]/5 transition-all"
                  >
                    Crear cliente nuevo
                  </button>
                  {createClientIfMissing && (
                    <div className="rounded-xl border border-[#347048]/15 bg-white p-3 text-[#347048]">
                      <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Cliente a crear</p>
                      <p className="text-sm font-black mt-1">{productSale.clientQuery}</p>
                      <p className="text-[11px] font-bold text-[#347048]/70 mt-1">
                        Tel: {productSale.guestPhone} · DNI: {productSale.guestDni}{productSale.guestEmail ? ` · Email: ${productSale.guestEmail}` : ''}{productSale.guestIsProfessor ? ' · Profesor' : ''}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={handleOpenCreateClientModal}
                          className="px-2 py-1 rounded-lg bg-[#347048]/10 text-[#347048] text-[10px] font-black uppercase tracking-widest"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCreateClientIfMissing(false);
                            setProductSale((prev) => ({ ...prev, guestPhone: '', guestDni: '', guestEmail: '', guestIsProfessor: false }));
                          }}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-red-50 text-red-600 border border-red-200"
                          title="Quitar"
                          aria-label="Quitar"
                        >
                          <Trash2 size={14} strokeWidth={2.6} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="relative z-20">
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Producto</label>
              <ProductSearch
                key={`sale-product-search-${saleProductSearchKey}`}
                products={products}
                disabled={!currentShift || productsLoading}
                placeholder={productsLoading ? 'Cargando productos...' : 'Buscá o escribí un producto / detalle'}
                onSelect={(product) => {
                  if (Number(product.stock ?? 0) <= 0) {
                    setSaleError('Ese producto no tiene stock disponible.');
                    return;
                  }
                  setSaleError('');
                  setSelectedSaleProduct(product);
                  setProductSale((prev) => ({
                    ...prev,
                    productQuery: product.name,
                    manualUnitPrice: String(Number(product.price || 0))
                  }));
                }}
                selectedName={selectedSaleProduct?.name}
                onInputChange={(value) => {
                  setProductSale((prev) => ({ ...prev, productQuery: value }));
                  if (!selectedSaleProduct) return;
                  if (value.trim().toLowerCase() !== selectedSaleProduct.name.trim().toLowerCase()) {
                    setSelectedSaleProduct(null);
                  }
                }}
              />
              {selectedSaleProduct ? (
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#347048]/60">
                  Producto seleccionado: {selectedSaleProduct.name} · stock {Number(selectedSaleProduct.stock ?? 0)} · ${Number(selectedSaleProduct.price || 0).toLocaleString()}
                </p>
              ) : (
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-[#347048]/45">
                  Si no existe en catálogo, escribilo igual y cargá un precio manual.
                </p>
              )}
            </div>

            <div className="grid grid-cols-[0.85fr_1.15fr_1fr] gap-4 items-end">
              <div>
                <label className="mb-2 ml-1 flex min-h-[2.25rem] items-end text-[10px] font-black uppercase tracking-widest text-[#347048]/60 leading-tight">
                  Cantidad
                </label>
                <input
                  type="number"
                  min={1}
                  placeholder="1"
                  onWheel={(event) => {
                    event.currentTarget.blur();
                  }}
                  className="no-spinner w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-3 text-[#347048] text-base font-black tabular-nums focus:outline-none shadow-sm transition-all"
                  value={productSale.quantity}
                  onChange={(e) => setProductSale({ ...productSale, quantity: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-2 ml-1 flex min-h-[2.25rem] items-end text-[10px] font-black uppercase tracking-widest text-[#347048]/60 leading-tight">
                  {selectedSaleProduct ? 'Precio catálogo' : 'Precio manual'}
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="0"
                  onWheel={(event) => {
                    event.currentTarget.blur();
                  }}
                  className="no-spinner w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-3 text-[#347048] text-base text-right font-black tabular-nums focus:outline-none shadow-sm transition-all disabled:opacity-60"
                  value={selectedSaleProduct ? String(Number(selectedSaleProduct.price || 0)) : productSale.manualUnitPrice}
                  onChange={(e) => {
                    if (selectedSaleProduct) return;
                    setProductSale({ ...productSale, manualUnitPrice: e.target.value });
                  }}
                  disabled={Boolean(selectedSaleProduct)}
                />
              </div>
              <div>
                <div className="mb-2 min-h-[2.25rem]" aria-hidden="true" />
                <button
                  type="button"
                  onClick={handleAddProductToSaleCart}
                  disabled={!currentShift}
                  className="w-full h-14 rounded-2xl bg-[#347048] text-[#EBE1D8] font-black text-[10px] uppercase tracking-widest hover:bg-[#B9CF32] hover:text-[#347048] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Agregar al carrito
                </button>
              </div>
              {saleCart.length > 0 ? (
                <div className="col-span-3 rounded-2xl border border-[#347048]/15 bg-white p-4 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#347048]/60">Carrito</p>
                  <div className="space-y-2 max-h-44 overflow-y-auto">
                    {saleRemainingItems.length > 0 ? (
                      saleRemainingItems.map((item: any) => (
                        <div key={String(item.itemKey)} className="flex items-center justify-between gap-3 rounded-xl border border-[#347048]/10 bg-white/60 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-[#347048] truncate">
                              {Number(item.quantity || 0)}x {String(item.productName || 'Producto')}
                            </p>
                            {Boolean(item.isCustom) ? (
                              <p className="text-[10px] font-black text-[#926699] uppercase tracking-widest">
                                Item manual
                              </p>
                            ) : null}
                            {Number(item.discountAmount || 0) > 0.009 ? (
                              <p className="text-[10px] font-black text-emerald-700">
                                Descuento: -${Number(item.discountAmount || 0).toLocaleString()}
                              </p>
                            ) : null}
                            {Number(item.remainingAmount || 0) <= 0.009 ? (
                              <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">
                                Pagado
                              </p>
                            ) : Number(item.paidAmount || 0) > 0.009 ? (
                              <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">
                                Parcial · resta ${Number(item.remainingAmount || 0).toLocaleString()}
                              </p>
                            ) : (
                              <p className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest">
                                Pendiente
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-[#347048]">
                              ${Number(item.finalTotal || 0).toLocaleString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveSaleCartItem(String(item.itemKey))}
                              className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-red-50 text-red-600 border border-red-200"
                              title="Quitar"
                              aria-label="Quitar"
                            >
                              <Trash2 size={14} strokeWidth={2.6} />
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      saleCart.map((entry) => {
                        return (
                          <div key={String(entry.itemKey)} className="flex items-center justify-between gap-3 rounded-xl border border-[#347048]/10 bg-white/60 px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-xs font-black text-[#347048] truncate">
                                {Number(entry.quantity || 0)}x {String(entry.productName || 'Producto')}
                              </p>
                              {entry.isCustom ? (
                                <p className="text-[10px] font-black text-[#926699] uppercase tracking-widest">
                                  Item manual
                                </p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-[#347048]">
                                ${Number((Number(entry.unitPrice || 0) * Number(entry.quantity || 0)).toFixed(2)).toLocaleString()}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleRemoveSaleCartItem(String(entry.itemKey))}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-red-50 text-red-600 border border-red-200"
                                title="Quitar"
                                aria-label="Quitar"
                              >
                                <Trash2 size={14} strokeWidth={2.6} />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
              <div className="col-span-3 rounded-2xl border border-[#347048]/15 bg-white/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-[#347048]/60 uppercase tracking-widest">Cobro de la venta</p>
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#347048]/70">
                    Total ${saleTotalAmount.toLocaleString()}
                  </span>
                </div>
                {salePayments.length === 0 ? (
                  <p className="text-[11px] font-bold text-[#347048]/60">Sin tramos cargados.</p>
                ) : (
                  <div className="space-y-2 max-h-36 overflow-y-auto">
                    {salePayments.map((payment, index) => (
                      <div key={`sale-payment-${index}`} className="rounded-xl border border-[#347048]/10 bg-white px-3 py-2 text-[11px] font-black text-[#347048]">
                        <div className="flex items-center justify-between">
                          <span>
                            {payment.method === 'CASH'
                              ? 'Efectivo'
                              : payment.method === 'CARD'
                                ? 'Tarjeta'
                                : payment.channel === 'VIRTUAL_WALLET'
                                  ? 'QR / Billetera'
                                  : 'Transferencia'}
                          </span>
                          <div className="flex items-center gap-2">
                            <span>${Number(payment.amount || 0).toLocaleString()}</span>
                            <button
                              type="button"
                              onClick={() => setSalePayments((prev) => prev.filter((_, idx) => idx !== index))}
                              className="h-8 w-8 inline-flex items-center justify-center rounded-lg bg-red-50 text-red-600 border border-red-200"
                              title="Quitar"
                              aria-label="Quitar"
                            >
                              <Trash2 size={14} strokeWidth={2.6} />
                            </button>
                          </div>
                        </div>
                        {Array.isArray(payment.allocations) && payment.allocations.length > 0 ? (
                          <p className="mt-1 text-[10px] font-black text-[#347048]/60">
                            {payment.allocations
                              .map((allocation) => {
                                const item = saleRemainingItems.find((entry: any) => String(entry.itemKey) === String(allocation.itemKey))
                                  || (saleQuote?.items || []).find((entry: any) => String(entry.itemKey) === String(allocation.itemKey));
                                return `${item ? `${Number(item.quantity || 0)}x ${String(item.productName || 'Producto')}` : `Item ${allocation.itemKey}`}: $${Number(allocation.amount || 0).toLocaleString()}`;
                              })
                              .join(' · ')}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                  <span className="text-[#347048]/60">Cargado</span>
                  <span className="text-[#347048]">${saleConfiguredTotal.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                  <span className="text-[#347048]/60">Restante</span>
                  <span className={saleRemaining <= 0.01 ? 'text-emerald-700' : 'text-[#926699]'}>
                    ${saleRemaining.toLocaleString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleOpenSalePaymentCalculator}
                  disabled={!currentShift || saleCart.length === 0 || saleRemaining <= 0.01}
                  className="w-full h-11 rounded-xl bg-[#347048] text-[#EBE1D8] hover:bg-[#B9CF32] hover:text-[#347048] text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Abrir payment calculator
                </button>
              </div>
            </div>

            {saleError && (
              <p className="text-xs font-bold text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{saleError}</p>
            )}

            <button
              type="submit"
              disabled={!canSubmitSale}
              className="w-full py-4 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-[1.5rem] shadow-xl shadow-[#347048]/20 transition-all hover:-translate-y-1 active:scale-95 uppercase tracking-widest text-sm italic mt-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              Registrar venta
            </button>
            {!currentShift && (
              <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Abrí la caja para registrar ventas POS.</p>
            )}
          </form>
        </div>

        </div>
      </div>
    </div>
      <AppModal
        show={showCreateClientModal}
        title="Crear cliente para esta venta"
        onClose={() => setShowCreateClientModal(false)}
        onConfirm={handleConfirmCreateClientDraft}
        confirmText="Guardar cliente"
        cancelText="Cancelar"
        message={(
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Nombre completo</label>
              <input
                type="text"
                value={newClientDraft.name}
                onChange={(e) => setNewClientDraft((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                placeholder="Nombre y apellido"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Teléfono</label>
                <input
                  type="text"
                  value={newClientDraft.phone}
                  onChange={(e) => setNewClientDraft((prev) => ({ ...prev, phone: e.target.value }))}
                  className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                  placeholder="Ej: 3511234567"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">DNI</label>
                <input
                  type="text"
                  value={newClientDraft.dni}
                  onChange={(e) => setNewClientDraft((prev) => ({ ...prev, dni: e.target.value }))}
                  className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                  placeholder="Ej: 30111222"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Email</label>
              <input
                type="email"
                value={newClientDraft.email}
                onChange={(e) => setNewClientDraft((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                placeholder="cliente@email.com"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-black text-[#347048]">
              <input
                type="checkbox"
                checked={Boolean(newClientDraft.isProfessor)}
                onChange={(e) => setNewClientDraft((prev) => ({ ...prev, isProfessor: e.target.checked }))}
                className="h-4 w-4 rounded border-[#347048]/30"
              />
              Es profesor
            </label>
          </div>
        )}
      />

      <AppModal
        show={actionFeedback.show}
        title={actionFeedback.title}
        message={actionFeedback.message}
        onClose={() => setActionFeedback({ show: false, title: '', message: '' })}
        onConfirm={() => setActionFeedback({ show: false, title: '', message: '' })}
        confirmText="Aceptar"
        cancelText=""
      />

      <AppModal
        show={showMovementMethodPicker}
        title="Seleccionar medio de pago"
        onClose={() => {
          if (movementSubmitting) return;
          setShowMovementMethodPicker(false);
        }}
        onConfirm={() => {
          if (movementSubmitting) return;
          setShowMovementMethodPicker(false);
        }}
        confirmText="Cancelar"
        cancelText=""
        closeOnBackdrop={!movementSubmitting}
        closeOnEscape={!movementSubmitting}
        message={(
          <div className="space-y-3">
            <p className="text-xs font-bold text-[#347048]/70">
              Elegí cómo se registró este movimiento.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleConfirmMovementWithMethod('CASH')}
                disabled={movementSubmitting}
                className="h-14 rounded-xl bg-white border-2 border-[#347048]/15 text-[#347048] font-black text-[10px] uppercase tracking-widest hover:border-[#B9CF32] transition-all disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Banknote size={14} strokeWidth={2.5} />
                  Efectivo
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmMovementWithMethod('TRANSFER')}
                disabled={movementSubmitting}
                className="h-14 rounded-xl bg-white border-2 border-[#347048]/15 text-[#347048] font-black text-[10px] uppercase tracking-widest hover:border-[#B9CF32] transition-all disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <CreditCard size={14} strokeWidth={2.5} />
                  Transferencia
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmMovementWithMethod('CARD')}
                disabled={movementSubmitting}
                className="h-14 rounded-xl bg-white border-2 border-[#347048]/15 text-[#347048] font-black text-[10px] uppercase tracking-widest hover:border-[#B9CF32] transition-all disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <CreditCard size={14} strokeWidth={2.5} />
                  Tarjeta
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmMovementWithMethod('TRANSFER')}
                disabled={movementSubmitting}
                className="h-14 rounded-xl bg-white border-2 border-[#347048]/15 text-[#347048] font-black text-[10px] uppercase tracking-widest hover:border-[#B9CF32] transition-all disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <CreditCard size={14} strokeWidth={2.5} />
                  QR / Billetera
                </span>
              </button>
            </div>
          </div>
        )}
      />

      {showSalePaymentCalculator && saleTotalAmount > 0 && saleQuote && Array.isArray(saleQuote.items) && (
        <PaymentCalculator
          courtPending={0}
          courtBaseTotal={0}
          cartItems={saleRemainingItems
            .filter((item: any) => Number(item.remainingAmount || 0) > 0.009)
            .map((item: any) => ({
              id: String(item.itemKey),
              productName: `${Number(item.quantity || 0)}x ${String(item.productName || 'Producto')}`,
              quantity: 1,
              price: Math.max(0, Number(item.remainingAmount || 0))
            }))}
          alreadyPaid={0}
          grandTotal={Math.max(0, Number(saleRemaining || 0))}
          onClose={() => setShowSalePaymentCalculator(false)}
          onConfirm={handleSalePaymentConfirm}
          submitting={false}
          zIndexClass="z-[2147483300]"
        />
      )}

      <AppModal
        show={showMovementModal}
        title={selectedMovement?.type === 'INCOME' ? 'Detalle del ingreso' : 'Detalle del egreso'}
        onClose={() => setShowMovementModal(false)}
        onConfirm={() => setShowMovementModal(false)}
        confirmText="Cerrar"
        cancelText=""
        message={selectedMovement ? (
          <div className="space-y-4 text-sm text-[#347048]">
            <div className="space-y-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Concepto</div>
              <div className="text-base font-black text-[#347048]">{buildMovementLabel(selectedMovement)}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Fecha y hora</div>
                <div className="font-bold">
                  {(() => {
                    const parsed = new Date(selectedMovement.date);
                    if (Number.isNaN(parsed.getTime())) return '--/--/---- --:--';
                    return formatDateTime24(parsed);
                  })()}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Medio</div>
                <div className="font-bold">
                  {getMovementMethodLabel(selectedMovement)}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Total</div>
                <div className="font-black text-lg text-[#347048]">${selectedMovement.amount.toLocaleString()}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Origen</div>
                <div className="font-bold">
                  {formatMovementSourceTypeLabel(selectedMovement.sourceType)}
                </div>
              </div>
            </div>

            {(Number(selectedMovement.bookingAmount || 0) > 0 || Number(selectedMovement.barAmount || 0) > 0) && (
              <div className="rounded-2xl border border-[#347048]/10 bg-white/60 p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2">Desglose</div>
                <div className="flex flex-wrap gap-2">
                  {Number(selectedMovement.bookingAmount || 0) > 0 && (
                    <span className="px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-[#B9CF32]/20 text-[#347048] border border-[#B9CF32]/30">
                      Reserva ${Number(selectedMovement.bookingAmount || 0).toLocaleString()}
                    </span>
                  )}
                  {Number(selectedMovement.barAmount || 0) > 0 && (
                    <span className="px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-[#926699]/15 text-[#926699] border border-[#926699]/30">
                      Bar ${Number(selectedMovement.barAmount || 0).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
            )}

            {Array.isArray(selectedMovement.allocations) && selectedMovement.allocations.length > 0 && (
              <div className="rounded-2xl border border-[#347048]/10 bg-white/60 p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2">Detalle de items</div>
                <div className="space-y-2 max-h-[30vh] md:max-h-[38vh] overflow-y-auto custom-scrollbar pr-1">
                  {selectedMovement.allocations.map((allocation) => (
                    <div key={`${allocation.accountItemId}-${allocation.amount}`} className="flex items-center justify-between gap-3 text-xs">
                      <div className="flex flex-col">
                        <span className="font-black text-[#347048]">
                          {allocation.description || allocation.type || 'Item'}
                          {allocation.quantity ? ` x${allocation.quantity}` : ''}
                        </span>
                        {allocation.unitPrice ? (
                          <span className="text-[10px] font-bold text-[#347048]/60">Unitario ${Number(allocation.unitPrice || 0).toLocaleString()}</span>
                        ) : null}
                      </div>
                      <div className="font-black text-[#347048]">${Number(allocation.amount || 0).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      />
    </>
  );
};

export default AdminCashDashboard;
