import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Wallet, ArrowUpCircle, ArrowDownCircle, Banknote, CreditCard, Plus, Receipt, History, ChevronDown, Check, Phone, IdCard } from 'lucide-react';
import { searchClients } from '../../services/BookingService';
import { ClubService } from '../../services/ClubService';
import { getActiveClubSlug, normalizeSessionUser } from '../../utils/session';
import { CashService } from '../../services/CashService';
import { formatDateTime24, formatTime24 } from '../../utils/dateTime';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import AppModal from '../AppModal';

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

type SplitSalePaymentDraft = {
  method: 'CASH' | 'TRANSFER' | 'CARD';
  channel?: 'BANK_ACCOUNT' | 'VIRTUAL_WALLET';
  amount: string;
};

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

  // Formulario
  const [newMove, setNewMove] = useState({ description: '', amount: '', type: 'INCOME', method: 'CASH' as 'CASH' | 'TRANSFER' | 'CARD' });
  const [productSale, setProductSale] = useState({ productId: '', quantity: '1', method: 'CASH' as 'CASH' | 'TRANSFER' | 'CARD', channel: 'BANK_ACCOUNT' as 'BANK_ACCOUNT' | 'VIRTUAL_WALLET', clientQuery: '' });
  const [splitSaleEnabled, setSplitSaleEnabled] = useState(false);
  const [splitSalePayments, setSplitSalePayments] = useState<SplitSalePaymentDraft[]>([{ method: 'CASH', amount: '' }]);

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

  const fetchCash = async () => {
    setMovementError('');
    try {
      const data = await CashService.getSummary();
      if (data && data.balance) setBalance(data.balance);
      if (data && data.movements) {
        const normalizedMovements: Movement[] = (Array.isArray(data.movements) ? data.movements : []).map((movement: any) => ({
          id: Number(movement?.id || 0),
          date: String(movement?.createdAt || movement?.date || new Date().toISOString()),
          type: movement?.type === 'PAYMENT_IN' || movement?.type === 'DEPOSIT' || movement?.type === 'INCOME' ? 'INCOME' : 'EXPENSE',
          amount: Number(movement?.amount || 0),
          description: String(movement?.concept || movement?.description || 'Movimiento'),
          method: movement?.method === 'CASH' ? 'CASH' : movement?.method === 'CARD' ? 'CARD' : 'TRANSFER',
          channel: movement?.channel ?? movement?.payment?.channel ?? movement?.refund?.payment?.channel ?? null,
          sourceType: movement?.sourceType ?? movement?.payment?.account?.sourceType ?? null,
          sourceId: movement?.sourceId ?? movement?.payment?.account?.sourceId ?? null,
          accountId: movement?.accountId ?? movement?.payment?.account?.id ?? null,
          bookingAmount: Number(movement?.bookingAmount || 0),
          barAmount: Number(movement?.barAmount || 0),
          paymentId: movement?.paymentId ?? movement?.payment?.id ?? movement?.refund?.payment?.id ?? movement?.refund?.paymentId ?? null,
          refundId: movement?.refundId ?? movement?.refund?.id ?? null,
          booking: movement?.booking ?? null,
          allocations: ((movement?.payment?.allocations || movement?.refund?.payment?.allocations || []) as any[]).map((allocation: any) => ({
            accountItemId: String(allocation?.accountItemId || ''),
            amount: Number(allocation?.amount || 0),
            type: allocation?.accountItem?.type ?? null,
            description: allocation?.accountItem?.description ?? null,
            quantity: Number(allocation?.accountItem?.quantity || 0),
            unitPrice: Number(allocation?.accountItem?.unitPrice || 0),
            total: Number(allocation?.accountItem?.total || 0)
          }))
        }));

        setMovements(normalizedMovements);
      }

    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'fetchCash' }, error);
      setMovementError(extractErrorMessage(error, 'No se pudieron cargar los movimientos de caja.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCash(); }, []);

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
        setSearchResults(results || []);
        setShowDropdown(true);
      } catch (error) {
        reportUiError({ area: 'AdminCashDashboard', action: 'searchClients' }, error);
        setSaleError(extractErrorMessage(error, 'No se pudo buscar clientes en este momento.'));
      }
    }, 300);
  };

  const selectClient = (client: any) => {
    const fullName = `${client.firstName || ''} ${client.lastName || ''}`.trim();
    setSelectedClient(client);
    setProductSale((prev) => ({ ...prev, clientQuery: fullName || client.firstName || '' }));
    setShowDropdown(false);
  };

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setMovementError('');
    if (!currentShift) {
      setOpenShiftError('Primero tenés que abrir la caja para registrar movimientos.');
      return;
    }
    if (!newMove.amount || !newMove.description) return;

    try {
      await CashService.createMovement({
        amount: newMove.amount,
        description: newMove.description,
        type: newMove.type as 'INCOME' | 'EXPENSE',
        method: newMove.method as 'CASH' | 'TRANSFER' | 'CARD'
      });

      setNewMove({ description: '', amount: '', type: 'INCOME', method: 'CASH' });
      fetchCash();
    } catch (error) {
      reportUiError({ area: 'AdminCashDashboard', action: 'addMovement' }, error);
      setMovementError(extractErrorMessage(error, 'No se pudo registrar el movimiento.'));
    }
  };

  const handleProductSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaleError('');

    if (!currentShift) {
      setSaleError('Primero tenés que abrir la caja para registrar ventas.');
      return;
    }

    const qty = Number(productSale.quantity);
    if (!productSale.productId || !Number.isFinite(qty) || qty <= 0) {
      setSaleError('Seleccioná un producto y cantidad válida.');
      return;
    }

    const selectedProduct = products.find((product) => Number(product.id) === Number(productSale.productId));
    if (!selectedProduct) {
      setSaleError('El producto seleccionado no es válido.');
      return;
    }

    const totalAmount = Number(selectedProduct.price) * qty;

    const parsedSplitPayments = splitSalePayments
      .map((payment) => ({
        method: payment.method,
        channel: payment.method === 'TRANSFER' ? (payment.channel || 'BANK_ACCOUNT') : undefined,
        amount: Number(payment.amount)
      }))
      .filter((payment) => Number.isFinite(payment.amount) && payment.amount > 0);

    const hasDebtInSale = false;
    const fallbackGuestName = productSale.clientQuery.trim();

    if (splitSaleEnabled) {
      if (parsedSplitPayments.length === 0) {
        setSaleError('Agregá al menos un tramo de pago válido.');
        return;
      }
      const splitTotal = parsedSplitPayments.reduce((sum, payment) => sum + payment.amount, 0);
      if (Math.abs(splitTotal - totalAmount) > 0.01) {
        setSaleError('La suma de los pagos debe coincidir con el total de la venta.');
        return;
      }
    }

    if (hasDebtInSale && !selectedClient && !fallbackGuestName) {
      setSaleError('Para registrar fiado, seleccioná un cliente o escribí al menos un nombre.');
      return;
    }

    try {
      await CashService.createProductSale({
        productId: Number(productSale.productId),
        quantity: qty,
        method: productSale.method,
        channel: productSale.method === 'TRANSFER' ? productSale.channel : undefined,
        ...(splitSaleEnabled ? { payments: parsedSplitPayments } : {}),
        userId: selectedClient?.id,
        guestName: selectedClient
          ? `${selectedClient.firstName || ''} ${selectedClient.lastName || ''}`.trim()
          : (hasDebtInSale ? fallbackGuestName : undefined),
        guestPhone: selectedClient?.phoneNumber || selectedClient?.phone || undefined,
        guestDni: selectedClient?.dni || selectedClient?.dniNumber || selectedClient?.document || undefined
      });

      setProductSale({ productId: '', quantity: '1', method: productSale.method, channel: productSale.channel, clientQuery: '' });
  setSplitSaleEnabled(false);
  setSplitSalePayments([{ method: 'CASH', amount: '' }]);
      setSelectedClient(null);
      fetchCash();
      fetchProducts();
    } catch (error: any) {
      setSaleError(error.message || 'Error al registrar venta');
    }
  };

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
            <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">Balance Hoy</span>
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
            <span className="text-[10px] font-black text-[#347048]/50 bg-white/40 px-4 py-1.5 rounded-full border border-white/60 uppercase tracking-widest">
              Últimas 24hs
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-white/40">
            {movements.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30 italic">
                  <Receipt size={48} className="mb-4" />
                  <p className="text-lg font-black uppercase tracking-widest text-[#347048]">No hay movimientos hoy</p>
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
        <div className="bg-[#EBE1D8] border-4 border-white p-8 rounded-[2.5rem] shadow-2xl h-fit">
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

            <div>
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Medio de Pago</label>
              <div className="grid grid-cols-3 gap-3">
                <button 
                  type="button"
                  onClick={() => setNewMove({...newMove, method: 'CASH'})}
                  className={`py-3 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      newMove.method === 'CASH' 
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg scale-105' 
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                >
                  <Banknote size={16} strokeWidth={2.5} /> Efectivo
                </button>
                <button 
                  type="button"
                  onClick={() => setNewMove({...newMove, method: 'TRANSFER'})}
                  className={`py-3 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      newMove.method === 'TRANSFER' 
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg scale-105' 
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                >
                  <CreditCard size={16} strokeWidth={2.5} /> Transferencia
                </button>
                <button
                  type="button"
                  onClick={() => setNewMove({...newMove, method: 'CARD'})}
                  className={`py-3 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      newMove.method === 'CARD'
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg scale-105'
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                >
                  <CreditCard size={16} strokeWidth={2.5} /> Tarjeta
                </button>
              </div>
            </div>

            <button type="submit" className="w-full py-4 bg-[#B9CF32] hover:bg-[#aebd2b] text-[#347048] font-black rounded-[1.5rem] shadow-xl shadow-[#B9CF32]/20 transition-all hover:-translate-y-1 active:scale-95 uppercase tracking-widest text-sm italic mt-2">
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
        <div className="bg-[#EBE1D8] border-4 border-white p-8 rounded-[2.5rem] shadow-2xl h-fit">
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
                      <div className="font-black text-sm">{client.firstName} {client.lastName}</div>
                      <div className="text-[10px] font-bold text-[#347048]/60 flex gap-3 mt-1 uppercase">
                        {client.phoneNumber && (
                          <span className="flex items-center gap-1">
                            <Phone size={12} strokeWidth={2.5} /> {client.phoneNumber}
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
                  Cliente seleccionado: {selectedClient.firstName} {selectedClient.lastName}
                </p>
              )}
            </div>

            <div className="relative z-20">
              <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Producto</label>
              <CustomSelect
                value={productSale.productId}
                onChange={(val: string) => setProductSale({ ...productSale, productId: val })}
                placeholder={productsLoading ? 'Cargando productos...' : 'Seleccionar producto'}
                options={products.map((product) => ({
                  value: String(product.id),
                  label: `${product.name} (${product.stock})`,
                  disabled: product.stock <= 0
                }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Cantidad</label>
                <input
                  type="number"
                  min={1}
                  placeholder="1"
                  onWheel={(event) => {
                    event.currentTarget.blur();
                  }}
                  className="w-full h-14 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-2xl px-4 text-[#347048] font-black focus:outline-none shadow-sm transition-all"
                  value={productSale.quantity}
                  onChange={(e) => setProductSale({ ...productSale, quantity: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-[10px] font-black text-[#347048]/60 uppercase tracking-widest mb-2 ml-1">Medio de pago</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setProductSale({ ...productSale, method: 'CASH' })}
                    className={`h-14 w-full px-4 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      productSale.method === 'CASH'
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg scale-105'
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                  >
                    <Banknote
                      size={16}
                      strokeWidth={2.5}
                      className={productSale.method === 'CASH' ? 'text-[#B9CF32]' : 'text-[#347048]/40'}
                    />
                    Efectivo
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductSale({ ...productSale, method: 'TRANSFER', channel: 'BANK_ACCOUNT' })}
                    className={`h-14 w-full px-4 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      productSale.method === 'TRANSFER' && productSale.channel === 'BANK_ACCOUNT'
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg scale-105'
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                  >
                    <CreditCard
                      size={16}
                      strokeWidth={2.5}
                      className={productSale.method === 'TRANSFER' ? 'text-[#B9CF32]' : 'text-[#347048]/40'}
                    />
                    Transferencia
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductSale({ ...productSale, method: 'CARD' })}
                    className={`h-14 w-full px-4 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      productSale.method === 'CARD'
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg scale-105'
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                  >
                    <CreditCard
                      size={16}
                      strokeWidth={2.5}
                      className={productSale.method === 'CARD' ? 'text-[#B9CF32]' : 'text-[#347048]/40'}
                    />
                    Tarjeta
                  </button>
                  <button
                    type="button"
                    onClick={() => setProductSale({ ...productSale, method: 'TRANSFER', channel: 'VIRTUAL_WALLET' })}
                    className={`h-14 w-full px-4 flex items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${
                      productSale.method === 'TRANSFER' && productSale.channel === 'VIRTUAL_WALLET'
                        ? 'bg-[#347048] border-[#347048] text-[#B9CF32] shadow-lg scale-105'
                        : 'bg-white border-transparent text-[#347048]/40 hover:bg-white/80'}`}
                  >
                    <CreditCard
                      size={16}
                      strokeWidth={2.5}
                      className={productSale.method === 'TRANSFER' && productSale.channel === 'VIRTUAL_WALLET' ? 'text-[#B9CF32]' : 'text-[#347048]/40'}
                    />
                    QR / Billetera
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSplitSaleEnabled((prev) => !prev)}
                  className="mt-2 w-full h-10 rounded-xl border-2 border-[#347048]/20 bg-white text-[#347048] text-[10px] font-black uppercase tracking-widest"
                >
                  {splitSaleEnabled ? 'Usar pago simple' : 'Dividir pago'}
                </button>

                {splitSaleEnabled && (
                  <div className="mt-2 space-y-2">
                    {splitSalePayments.map((payment, index) => (
                      <div key={`split-sale-${index}`} className="grid grid-cols-12 gap-2">
                        <select
                          value={payment.method}
                          onChange={(e) => {
                            const method = e.target.value as 'CASH' | 'TRANSFER' | 'CARD';
                            setSplitSalePayments((prev) => prev.map((item, idx) => idx === index ? { ...item, method, channel: method === 'TRANSFER' ? (item.channel || 'BANK_ACCOUNT') : undefined } : item));
                          }}
                          className="col-span-4 h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-xs font-black uppercase tracking-wider"
                        >
                          <option value="CASH">Efectivo</option>
                          <option value="TRANSFER">Transferencia</option>
                          <option value="CARD">Tarjeta</option>
                        </select>
                        {payment.method === 'TRANSFER' ? (
                          <select
                            value={payment.channel || 'BANK_ACCOUNT'}
                            onChange={(e) => setSplitSalePayments((prev) => prev.map((item, idx) => idx === index ? { ...item, channel: e.target.value as 'BANK_ACCOUNT' | 'VIRTUAL_WALLET' } : item))}
                            className="col-span-3 h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-2 text-[10px] font-black uppercase tracking-wider"
                          >
                            <option value="BANK_ACCOUNT">Banco</option>
                            <option value="VIRTUAL_WALLET">Billetera</option>
                          </select>
                        ) : (
                          <div className="col-span-3 h-11" />
                        )}
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={payment.amount}
                          onChange={(e) => setSplitSalePayments((prev) => prev.map((item, idx) => idx === index ? { ...item, amount: e.target.value } : item))}
                          className="col-span-3 h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-sm font-black"
                          placeholder="Monto"
                        />
                        <button
                          type="button"
                          onClick={() => setSplitSalePayments((prev) => prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index))}
                          className="col-span-2 h-11 rounded-xl border border-red-200 text-red-500 font-black text-xs"
                          disabled={splitSalePayments.length === 1}
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSplitSalePayments((prev) => [...prev, { method: 'TRANSFER', channel: 'BANK_ACCOUNT', amount: '' }])}
                      className="w-full h-10 rounded-xl border border-[#347048]/20 bg-white text-[#347048] text-[10px] font-black uppercase tracking-widest"
                    >
                      + Agregar tramo
                    </button>
                  </div>
                )}
              </div>
            </div>

            {saleError && (
              <p className="text-xs font-bold text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-xl">{saleError}</p>
            )}

            <button type="submit" className="w-full py-4 bg-[#347048] hover:bg-[#B9CF32] text-[#EBE1D8] hover:text-[#347048] font-black rounded-[1.5rem] shadow-xl shadow-[#347048]/20 transition-all hover:-translate-y-1 active:scale-95 uppercase tracking-widest text-sm italic mt-2">
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
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
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
