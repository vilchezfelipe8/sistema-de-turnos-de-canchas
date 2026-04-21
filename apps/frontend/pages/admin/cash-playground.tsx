import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CreditCard,
  FileText,
  Landmark,
  MessageSquare,
  Receipt,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Trophy,
  Wallet,
  X,
  Users,
} from 'lucide-react';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { CashService } from '../../services/CashService';
import { formatDateTime24 } from '../../utils/dateTime';
import { extractErrorMessage, reportUiError } from '../../utils/uiError';
import { hasAdminAccess } from '../../utils/session';

const sidebarItems = [
  { label: 'Calendario', icon: CalendarDays },
  { label: 'Clientes', icon: Users },
  { label: 'Pagos', icon: CreditCard, active: true },
  { label: 'Reservas', icon: Receipt },
  { label: 'Partidos', icon: Trophy },
  { label: 'Tienda', icon: ShoppingBag },
  { label: 'Chats', icon: MessageSquare },
  { label: 'Facturacion', icon: FileText },
  { label: 'Ajustes', icon: Settings },
];

type CashPeriod = 'hoy' | 'semana' | 'mes';
type MovementTypeFilter = 'ALL' | 'INCOME' | 'EXPENSE';
type MovementMethodFilter = 'ALL' | 'CASH' | 'TRANSFER' | 'CARD';
type CashView = 'live' | 'movements' | 'closures';
type CashActionSidebarView = 'none' | 'open_shift' | 'close_shift' | 'movement_create' | 'close_report';

type Movement = {
  id: number;
  date: string;
  type: 'INCOME' | 'EXPENSE';
  amount: number;
  description: string;
  method: 'CASH' | 'TRANSFER' | 'CARD';
};

type Balance = {
  total: number;
  cash: number;
  digital: number;
  income: number;
  expense: number;
};

type CashRegister = {
  id: string;
  name: string;
  location?: string | null;
};

type CashShift = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  openingAmount: number;
  cashRegister?: {
    id: string;
    name: string;
    location?: string | null;
  };
};

type CashShiftCloseReport = {
  shift: {
    id: string;
    openedAt?: string;
    closedAt?: string | null;
  };
  expectedCash: number;
  countedCash: number;
  difference: number;
};

const toDateLabel = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getCashDateRange = (period: CashPeriod, offset = 0) => {
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
    rawEnd: end,
  };
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;

const shortId = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 8) return raw;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
};

const formatMovementConcept = (movement: any) => {
  const rawConcept = String(movement?.concept || '').trim();
  const sourceType = String(movement?.sourceType || '').toUpperCase();
  const accountId = String(movement?.accountId || '').trim();
  const paymentId = String(movement?.paymentId || '').trim();
  const refundId = String(movement?.refundId || '').trim();
  const booking = movement?.booking;

  const paymentMatch = rawConcept.match(/^pago\s+cuenta\s+(.+)$/i);
  if (paymentMatch) {
    if (sourceType === 'BOOKING' && booking) {
      const court = String(booking?.courtName || '').trim();
      const client = String(booking?.clientName || '').trim();
      if (court && client) return `Pago reserva ${court} - ${client}`;
      if (court) return `Pago reserva ${court}`;
      if (client) return `Pago reserva - ${client}`;
      return 'Pago de reserva';
    }

    if (sourceType === 'BAR') {
      return 'Pago de consumos';
    }

    return `Pago de cuenta ${accountId ? `#${shortId(accountId)}` : ''}`.trim();
  }

  const refundMatch = rawConcept.match(/^refund\s+pago\s+(.+)$/i);
  if (refundMatch) {
    const reference = refundId || paymentId || refundMatch[1];
    return `Reintegro de pago ${reference ? `#${shortId(reference)}` : ''}`.trim();
  }

  if (!rawConcept) return 'Movimiento de caja';
  return rawConcept;
};

const movementMethodLabel = (method: Movement['method']) => {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'CARD') return 'Tarjeta';
  return 'Transferencia';
};

export default function AdminCashPlaygroundPage() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });
  const [activeView, setActiveView] = useState<CashView>('live');
  const [activePeriod, setActivePeriod] = useState<CashPeriod>('hoy');
  const [periodOffset, setPeriodOffset] = useState(0);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingShift, setLoadingShift] = useState(true);
  const [submittingMovement, setSubmittingMovement] = useState(false);
  const [openingShift, setOpeningShift] = useState(false);
  const [closingShift, setClosingShift] = useState(false);

  const [balance, setBalance] = useState<Balance>({
    total: 0,
    cash: 0,
    digital: 0,
    income: 0,
    expense: 0,
  });
  const [movements, setMovements] = useState<Movement[]>([]);
  const [currentShift, setCurrentShift] = useState<CashShift | null>(null);
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([]);

  const [summaryError, setSummaryError] = useState('');
  const [shiftError, setShiftError] = useState('');
  const [movementError, setMovementError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<MovementTypeFilter>('ALL');
  const [methodFilter, setMethodFilter] = useState<MovementMethodFilter>('ALL');
  const [showFilters, setShowFilters] = useState(false);
  const [denseMode, setDenseMode] = useState(true);
  const [sidebarView, setSidebarView] = useState<CashActionSidebarView>('none');
  const [lastCloseReport, setLastCloseReport] = useState<CashShiftCloseReport | null>(null);

  const [openShiftForm, setOpenShiftForm] = useState({
    cashRegisterId: '',
    openingAmount: '',
  });
  const [closeShiftForm, setCloseShiftForm] = useState({
    countedCash: '',
  });
  const [newMovement, setNewMovement] = useState({
    type: 'INCOME' as 'INCOME' | 'EXPENSE',
    description: '',
    amount: '',
    method: 'CASH' as 'CASH' | 'TRANSFER' | 'CARD',
  });

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/cash-playground')}`);
  }, [authChecked, user, router]);

  const loadSummary = useCallback(async () => {
    setSummaryError('');
    setLoadingSummary(true);
    try {
      const { startDate, endDate } = getCashDateRange(activePeriod, periodOffset);
      const data = await CashService.getSummary({ startDate, endDate });
      const nextBalance = data?.balance || {};
      setBalance({
        total: Number(nextBalance.total || 0),
        cash: Number(nextBalance.cash || 0),
        digital: Number(nextBalance.digital || 0),
        income: Number(nextBalance.income || 0),
        expense: Number(nextBalance.expense || 0),
      });
      const normalizedMovements: Movement[] = (Array.isArray(data?.movements) ? data.movements : []).map((item: any) => {
        const type = String(item?.type || 'INCOME');
        const normalizedType: Movement['type'] =
          type === 'WITHDRAW' || type === 'REFUND' || type === 'EXPENSE' ? 'EXPENSE' : 'INCOME';
        return {
          id: Number(item?.id || 0),
          date: String(item?.createdAt || ''),
          type: normalizedType,
          amount: Number(item?.amount || 0),
          description: formatMovementConcept(item),
          method: (['CASH', 'TRANSFER', 'CARD'].includes(String(item?.method))
            ? item.method
            : 'CASH') as Movement['method'],
        };
      });
      setMovements(normalizedMovements.filter((item) => Number.isFinite(item.id) && item.id > 0));
    } catch (error) {
      reportUiError({ area: 'CashPlayground', action: 'loadSummary' }, error);
      setSummaryError(extractErrorMessage(error, 'No se pudo cargar el resumen de caja.'));
    } finally {
      setLoadingSummary(false);
    }
  }, [activePeriod, periodOffset]);

  const loadShiftContext = useCallback(async () => {
    setShiftError('');
    setLoadingShift(true);
    try {
      const [shift, registers] = await Promise.all([
        CashService.getCurrentShift(),
        CashService.getCashRegisters(),
      ]);
      setCurrentShift(shift || null);
      const normalizedRegisters = Array.isArray(registers) ? registers : [];
      setCashRegisters(normalizedRegisters);
      if (!shift && normalizedRegisters.length > 0) {
        setOpenShiftForm((prev) => ({
          ...prev,
          cashRegisterId: prev.cashRegisterId || String(normalizedRegisters[0].id),
        }));
      }
    } catch (error) {
      reportUiError({ area: 'CashPlayground', action: 'loadShiftContext' }, error);
      setShiftError(extractErrorMessage(error, 'No se pudo cargar el estado del turno de caja.'));
    } finally {
      setLoadingShift(false);
    }
  }, []);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    void loadSummary();
  }, [authChecked, user, loadSummary]);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    void loadShiftContext();
  }, [authChecked, user, loadShiftContext]);

  const periodLabel = useMemo(() => {
    const { rawStart, rawEnd } = getCashDateRange(activePeriod, periodOffset);
    if (activePeriod === 'hoy') {
      if (periodOffset === 0) return 'Hoy';
      if (periodOffset === -1) return 'Ayer';
      return rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
    if (activePeriod === 'semana') {
      return `${rawStart.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })} - ${rawEnd.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}`;
    }
    return rawStart.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  }, [activePeriod, periodOffset]);

  const filteredMovements = useMemo(() => {
    const normalizedQuery = searchTerm.trim().toLowerCase();
    return movements.filter((movement) => {
      const matchesType = typeFilter === 'ALL' || movement.type === typeFilter;
      const matchesMethod = methodFilter === 'ALL' || movement.method === methodFilter;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        movement.description.toLowerCase().includes(normalizedQuery) ||
        movementMethodLabel(movement.method).toLowerCase().includes(normalizedQuery);
      return matchesType && matchesMethod && matchesSearch;
    });
  }, [movements, searchTerm, typeFilter, methodFilter]);

  const filteredNetAmount = useMemo(
    () =>
      filteredMovements.reduce(
        (total, movement) => total + (movement.type === 'INCOME' ? movement.amount : -movement.amount),
        0
      ),
    [filteredMovements]
  );

  const filteredIncomeAmount = useMemo(
    () => filteredMovements.filter((movement) => movement.type === 'INCOME').reduce((sum, movement) => sum + movement.amount, 0),
    [filteredMovements]
  );

  const filteredExpenseAmount = useMemo(
    () => filteredMovements.filter((movement) => movement.type === 'EXPENSE').reduce((sum, movement) => sum + movement.amount, 0),
    [filteredMovements]
  );

  const filteredAverageAmount = useMemo(() => {
    if (filteredMovements.length === 0) return 0;
    const absoluteTotal = filteredMovements.reduce((sum, movement) => sum + Math.abs(movement.amount), 0);
    return absoluteTotal / filteredMovements.length;
  }, [filteredMovements]);

  const handleOpenShift = async (event: React.FormEvent) => {
    event.preventDefault();
    setShiftError('');
    setSuccessMessage('');

    const openingAmount = Number(openShiftForm.openingAmount);
    if (!openShiftForm.cashRegisterId) {
      setShiftError('Selecciona una caja registradora.');
      return;
    }
    if (!Number.isFinite(openingAmount) || openingAmount < 0) {
      setShiftError('Ingresa un monto de apertura valido.');
      return;
    }

    try {
      setOpeningShift(true);
      await CashService.openShift({
        cashRegisterId: openShiftForm.cashRegisterId,
        openingAmount,
      });
      setSuccessMessage('Turno de caja abierto correctamente.');
      setSidebarView('none');
      await Promise.all([loadShiftContext(), loadSummary()]);
    } catch (error) {
      reportUiError({ area: 'CashPlayground', action: 'openShift' }, error);
      setShiftError(extractErrorMessage(error, 'No se pudo abrir la caja.'));
    } finally {
      setOpeningShift(false);
    }
  };

  const handleCloseShift = async (event: React.FormEvent) => {
    event.preventDefault();
    setShiftError('');
    setSuccessMessage('');

    const countedCash = Number(closeShiftForm.countedCash);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      setShiftError('Ingresa un monto contado valido.');
      return;
    }

    try {
      setClosingShift(true);
      const closedShift = await CashService.closeCurrentShift({ countedCash });
      if (closedShift?.id) {
        try {
          const report = await CashService.getShiftReport(String(closedShift.id));
          setLastCloseReport(report);
        } catch {
          setLastCloseReport(null);
        }
      }
      setCloseShiftForm({ countedCash: '' });
      setSuccessMessage('Turno de caja cerrado correctamente.');
      setSidebarView('none');
      await Promise.all([loadShiftContext(), loadSummary()]);
    } catch (error) {
      reportUiError({ area: 'CashPlayground', action: 'closeShift' }, error);
      setShiftError(extractErrorMessage(error, 'No se pudo cerrar la caja.'));
    } finally {
      setClosingShift(false);
    }
  };

  const handleCreateMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    setMovementError('');
    setSuccessMessage('');

    const amount = Number(newMovement.amount);
    if (!currentShift) {
      setMovementError('Primero debes abrir la caja para registrar movimientos.');
      return;
    }
    if (newMovement.description.trim().length < 3) {
      setMovementError('Describe el movimiento con al menos 3 caracteres.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setMovementError('Ingresa un monto valido mayor a 0.');
      return;
    }

    try {
      setSubmittingMovement(true);
      await CashService.createMovement({
        amount,
        description: newMovement.description.trim(),
        type: newMovement.type,
        method: newMovement.method,
      });
      setNewMovement({
        type: 'INCOME',
        description: '',
        amount: '',
        method: 'CASH',
      });
      setSuccessMessage('Movimiento registrado correctamente.');
      setSidebarView('none');
      await loadSummary();
    } catch (error) {
      reportUiError({ area: 'CashPlayground', action: 'createMovement' }, error);
      setMovementError(extractErrorMessage(error, 'No se pudo registrar el movimiento.'));
    } finally {
      setSubmittingMovement(false);
    }
  };

  const actionSidebarOpen = sidebarView !== 'none';

  const closeActionSidebar = useCallback(() => {
    if (openingShift || closingShift || submittingMovement) return;
    setSidebarView('none');
  }, [openingShift, closingShift, submittingMovement]);

  useEffect(() => {
    if (!actionSidebarOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeActionSidebar();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [actionSidebarOpen, closeActionSidebar]);

  if (!authChecked || !user) {
    return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  }

  if (!hasAdminAccess(user)) {
    return <NotFound message="No tenes permiso para acceder al panel de administracion." />;
  }

  return (
    <>
      <Head>
        <title>Caja Playground | TuCancha Admin</title>
      </Head>

      <div className="h-screen w-full overflow-hidden bg-[radial-gradient(circle_at_top_left,#edf6ff_0%,#f6f8fb_48%,#f2f4f8_100%)] text-[#1a1a1a]">
        <div className="flex h-full w-full">
          <aside className="hidden h-full w-[110px] flex-col items-center border-r border-[#e5e7eb] bg-white py-6 lg:flex">
            <div className="mb-8 text-[11px] font-bold tracking-[0.22em] text-[#2a2f5b]">TUCANCHA</div>
            <nav className="w-full space-y-1 px-2">
              {sidebarItems.map(({ label, icon: Icon, active }) => (
                <button
                  key={label}
                  type="button"
                  className={`w-full rounded-xl px-3 py-2 text-left text-[11px] transition ${
                    active ? 'bg-[#eef1ff] text-[#2b3fa8]' : 'text-[#8b92a0] hover:bg-[#f4f5f7]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Icon size={14} />
                    <span className="truncate">{label}</span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <section className={`min-w-0 flex-1 transition ${actionSidebarOpen ? 'pointer-events-none select-none opacity-80' : 'opacity-100'}`}>
            <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
              <header className="rounded-2xl border border-[#dce3ef] bg-white/90 px-4 py-3 shadow-[0_8px_28px_rgba(27,39,94,0.06)] backdrop-blur">
                <div className="flex flex-wrap items-center gap-3 md:gap-4">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#1f4ed8] text-white shadow-[0_10px_24px_rgba(31,78,216,0.35)]">
                    <Wallet size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="truncate text-base font-semibold text-[#1f2937]">Caja Operativa</h1>
                    <p className="text-xs text-[#64748b]">Nueva experiencia visual, reutilizando la misma logica y endpoints.</p>
                  </div>

                  <div className="flex items-center gap-1 rounded-xl border border-[#dbe2ee] bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setActiveView('live')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        activeView === 'live' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Caja en vivo
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('movements')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        activeView === 'movements' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Movimientos
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('closures')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        activeView === 'closures' ? 'bg-[#eef2ff] text-[#1f4ed8]' : 'text-[#64748b] hover:bg-[#f8fafc]'
                      }`}
                    >
                      Cierres
                    </button>
                  </div>

                  <div className="ml-auto flex items-center gap-1 rounded-xl border border-[#dbe2ee] bg-[#f8fafc] p-1">
                    {(['hoy', 'semana', 'mes'] as CashPeriod[]).map((period) => (
                      <button
                        key={period}
                        type="button"
                        onClick={() => {
                          setActivePeriod(period);
                          setPeriodOffset(0);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                          activePeriod === period
                            ? 'bg-white text-[#1f4ed8] shadow-sm'
                            : 'text-[#64748b] hover:text-[#334155]'
                        }`}
                      >
                        {period === 'hoy' ? 'Hoy' : period === 'semana' ? 'Semana' : 'Mes'}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setDenseMode((prev) => !prev)}
                    className="h-8 rounded-xl border border-[#dbe2ee] bg-white px-3 text-xs font-semibold text-[#334155] transition hover:bg-[#f8fafc]"
                  >
                    {denseMode ? 'Modo comodo' : 'Modo compacto'}
                  </button>

                  <div className="flex items-center gap-1 rounded-xl border border-[#dbe2ee] bg-white px-1 py-1">
                    <button
                      type="button"
                      onClick={() => setPeriodOffset((prev) => prev - 1)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-[#64748b] transition hover:bg-[#f1f5f9]"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="min-w-[120px] text-center text-xs font-semibold text-[#334155]">{periodLabel}</span>
                    <button
                      type="button"
                      onClick={() => setPeriodOffset((prev) => prev + 1)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-[#64748b] transition hover:bg-[#f1f5f9]"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <article className={`rounded-2xl border border-[#dbe2ee] bg-white ${denseMode ? 'p-3' : 'p-4'}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Saldo Total</p>
                  <p className={`mt-2 font-semibold text-[#0f172a] ${denseMode ? 'text-lg' : 'text-xl'}`}>{formatMoney(balance.total)}</p>
                </article>
                <article className={`rounded-2xl border border-[#dbe2ee] bg-white ${denseMode ? 'p-3' : 'p-4'}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Ingresos</p>
                  <p className={`mt-2 flex items-center gap-1 font-semibold text-[#15803d] ${denseMode ? 'text-lg' : 'text-xl'}`}><ArrowUpRight size={18} />{formatMoney(balance.income)}</p>
                </article>
                <article className={`rounded-2xl border border-[#dbe2ee] bg-white ${denseMode ? 'p-3' : 'p-4'}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Egresos</p>
                  <p className={`mt-2 flex items-center gap-1 font-semibold text-[#b91c1c] ${denseMode ? 'text-lg' : 'text-xl'}`}><ArrowDownRight size={18} />{formatMoney(balance.expense)}</p>
                </article>
                <article className={`rounded-2xl border border-[#dbe2ee] bg-white ${denseMode ? 'p-3' : 'p-4'}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Caja Efectivo</p>
                  <p className={`mt-2 font-semibold text-[#0f172a] ${denseMode ? 'text-lg' : 'text-xl'}`}>{formatMoney(balance.cash)}</p>
                </article>
                <article className={`rounded-2xl border border-[#dbe2ee] bg-white ${denseMode ? 'p-3' : 'p-4'}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Caja Digital</p>
                  <p className={`mt-2 font-semibold text-[#0f172a] ${denseMode ? 'text-lg' : 'text-xl'}`}>{formatMoney(balance.digital)}</p>
                </article>
              </div>

              {(summaryError || shiftError || movementError || successMessage) && (
                <div className="space-y-2">
                  {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{successMessage}</div>}
                  {summaryError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{summaryError}</div>}
                  {shiftError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{shiftError}</div>}
                  {movementError && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{movementError}</div>}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto">
                {activeView === 'live' && (
                  <div className="grid min-h-full grid-cols-1 gap-4 xl:grid-cols-[340px_1fr]">
                    <div className="space-y-4">
                      <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                        <h2 className="text-sm font-semibold text-[#1e293b]">Turno De Caja</h2>
                        {loadingShift ? (
                          <p className="mt-3 text-xs text-[#64748b]">Cargando estado de caja...</p>
                        ) : currentShift ? (
                          <div className="mt-3 space-y-3">
                            <div className="rounded-xl border border-[#dbe2ee] bg-[#f8fafc] p-3 text-xs text-[#334155]">
                              <p><span className="font-semibold">Caja:</span> {currentShift.cashRegister?.name || '-'}</p>
                              <p><span className="font-semibold">Apertura:</span> {formatDateTime24(currentShift.openedAt)}</p>
                              <p><span className="font-semibold">Monto inicial:</span> {formatMoney(currentShift.openingAmount)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCloseShiftForm({ countedCash: '' });
                                setSidebarView('close_shift');
                              }}
                              className="h-10 w-full rounded-xl bg-[#0f172a] text-sm font-semibold text-white transition hover:bg-[#1e293b]"
                            >
                              Cerrar Caja
                            </button>
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs text-[#64748b]">No hay turno activo. Abre caja desde el panel lateral.</p>
                            <button
                              type="button"
                              onClick={() => setSidebarView('open_shift')}
                              className="h-10 w-full rounded-xl bg-[#1f4ed8] text-sm font-semibold text-white transition hover:bg-[#1e40af]"
                            >
                              Abrir Caja
                            </button>
                          </div>
                        )}
                      </article>

                    </div>

                    <article className="min-h-0 rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-[#1e293b]">Panel Operativo</h2>
                        <span className="text-xs text-[#64748b]">Sin datos duplicados</span>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Estado actual</p>
                          <p className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${currentShift ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                            {currentShift ? 'Caja abierta' : 'Caja cerrada'}
                          </p>
                          <p className="mt-2 text-xs text-[#475569]">
                            {currentShift
                              ? 'Gestiona apertura y cierre aqui; registra movimientos desde la vista Movimientos.'
                              : 'Abre caja para iniciar la operacion diaria.'}
                          </p>
                        </div>

                        <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-3">
                          <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Flujo recomendado</p>
                          <ol className="mt-1 space-y-1 text-xs text-[#475569]">
                            <li>1. Apertura y monto inicial</li>
                            <li>2. Registrar movimientos puntuales</li>
                            <li>3. Cierre con arqueo final</li>
                          </ol>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveView('movements');
                            setSidebarView('movement_create');
                          }}
                          className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafc]"
                        >
                          Registrar movimiento
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveView('movements')}
                          className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafc]"
                        >
                          Ir a Movimientos
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveView('closures')}
                          className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafc]"
                        >
                          Ir a Cierres
                        </button>
                      </div>
                    </article>
                  </div>
                )}

                {activeView === 'movements' && (
                  <article className="min-h-0 rounded-2xl border border-[#dbe2ee] bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-[#1e293b]">Movimientos</h2>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSidebarView('movement_create')}
                          className="h-8 rounded-lg bg-[#1f4ed8] px-2.5 text-xs font-semibold text-white shadow-[0_6px_16px_rgba(31,78,216,0.28)] transition hover:bg-[#1e40af]"
                        >
                          Nuevo movimiento
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowFilters((prev) => !prev)}
                          className="h-8 rounded-lg border border-[#dbe2ee] bg-white px-2.5 text-xs font-semibold text-[#475569] transition hover:bg-[#f8fafc]"
                        >
                          {showFilters ? 'Ocultar filtros' : 'Mostrar filtros'}
                        </button>
                        <div className="inline-flex items-center gap-2 text-xs text-[#64748b]">
                          <Landmark size={14} />
                          <span>{loadingSummary ? 'Actualizando...' : `${filteredMovements.length} de ${movements.length}`}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Resultado visible</p>
                        <p className={`mt-1 text-sm font-semibold ${filteredNetAmount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {filteredNetAmount >= 0 ? '+' : '-'}{formatMoney(Math.abs(filteredNetAmount))}
                        </p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Ingresos visibles</p>
                        <p className="mt-1 text-sm font-semibold text-emerald-700">{formatMoney(filteredIncomeAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Egresos visibles</p>
                        <p className="mt-1 text-sm font-semibold text-red-700">{formatMoney(filteredExpenseAmount)}</p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Ticket promedio</p>
                        <p className="mt-1 text-sm font-semibold text-[#0f172a]">{formatMoney(filteredAverageAmount)}</p>
                      </div>
                    </div>

                    {showFilters && (
                      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_160px_auto]">
                        <label className="relative">
                          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Buscar por concepto o metodo"
                            className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#1f4ed8]"
                          />
                        </label>

                        <select
                          value={typeFilter}
                          onChange={(event) => setTypeFilter(event.target.value as MovementTypeFilter)}
                          className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                        >
                          <option value="ALL">Todos los tipos</option>
                          <option value="INCOME">Solo ingresos</option>
                          <option value="EXPENSE">Solo egresos</option>
                        </select>

                        <select
                          value={methodFilter}
                          onChange={(event) => setMethodFilter(event.target.value as MovementMethodFilter)}
                          className="h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                        >
                          <option value="ALL">Todos los metodos</option>
                          <option value="CASH">Efectivo</option>
                          <option value="TRANSFER">Transferencia</option>
                          <option value="CARD">Tarjeta</option>
                        </select>

                        <button
                          type="button"
                          onClick={() => {
                            setSearchTerm('');
                            setTypeFilter('ALL');
                            setMethodFilter('ALL');
                          }}
                          className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-xs font-semibold text-[#475569] transition hover:bg-[#f8fafc]"
                        >
                          Limpiar filtros
                        </button>
                      </div>
                    )}

                    <div className={`overflow-auto rounded-xl border border-[#e6ebf2] ${denseMode ? 'max-h-[68vh]' : 'max-h-[62vh]'}`}>
                      {filteredMovements.length === 0 ? (
                        <div className="p-8 text-center text-sm text-[#64748b]">
                          {movements.length === 0
                            ? 'No hay movimientos para el periodo seleccionado.'
                            : 'No hay coincidencias con los filtros actuales.'}
                        </div>
                      ) : (
                        <table className={`w-full min-w-[680px] ${denseMode ? 'text-[13px]' : 'text-sm'}`}>
                          <thead className="sticky top-0 bg-[#f8fafc] text-xs uppercase tracking-wide text-[#64748b]">
                            <tr>
                              <th className="px-3 py-2 text-left">Fecha</th>
                              <th className="px-3 py-2 text-left">Concepto</th>
                              <th className="px-3 py-2 text-left">Metodo</th>
                              <th className="px-3 py-2 text-left">Tipo</th>
                              <th className="px-3 py-2 text-right">Monto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredMovements.map((movement) => (
                              <tr key={movement.id} className="border-t border-[#eef2f7] transition hover:bg-[#f8fbff]">
                                <td className={`px-3 text-xs text-[#475569] ${denseMode ? 'py-1.5' : 'py-2'}`}>{formatDateTime24(movement.date)}</td>
                                <td className={`px-3 text-[#0f172a] ${denseMode ? 'py-1.5' : 'py-2'}`}>{movement.description}</td>
                                <td className={`px-3 text-[#475569] ${denseMode ? 'py-1.5' : 'py-2'}`}>{movementMethodLabel(movement.method)}</td>
                                <td className={`px-3 ${denseMode ? 'py-1.5' : 'py-2'}`}>
                                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${movement.type === 'INCOME' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                    {movement.type === 'INCOME' ? 'Ingreso' : 'Egreso'}
                                  </span>
                                </td>
                                <td className={`px-3 text-right font-semibold ${denseMode ? 'py-1.5' : 'py-2'} ${movement.type === 'INCOME' ? 'text-emerald-700' : 'text-red-700'}`}>
                                  {movement.type === 'INCOME' ? '+' : '-'}{formatMoney(movement.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </article>
                )}

                {activeView === 'closures' && (
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      <h2 className="text-sm font-semibold text-[#1e293b]">Estado de cierre</h2>
                      {currentShift ? (
                        <div className="mt-3 space-y-2 text-sm text-[#334155]">
                          <p>Hay una caja abierta. Para cerrar y generar arqueo, usa la vista Caja en vivo.</p>
                          <button
                            type="button"
                            onClick={() => setActiveView('live')}
                            className="h-9 rounded-xl bg-[#1f4ed8] px-3 text-sm font-semibold text-white transition hover:bg-[#1e40af]"
                          >
                            Ir a Caja en vivo
                          </button>
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-[#64748b]">No hay caja abierta en este momento.</p>
                      )}
                    </article>

                    <article className="rounded-2xl border border-[#dbe2ee] bg-white p-4">
                      <h2 className="text-sm font-semibold text-[#1e293b]">Ultimo arqueo generado</h2>
                      {lastCloseReport ? (
                        <>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Esperado</p>
                            <p className="mt-1 text-sm font-semibold text-[#0f172a]">{formatMoney(lastCloseReport.expectedCash)}</p>
                          </div>
                          <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Contado</p>
                            <p className="mt-1 text-sm font-semibold text-[#0f172a]">{formatMoney(lastCloseReport.countedCash)}</p>
                          </div>
                          <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                            <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Diferencia</p>
                            <p className={`mt-1 text-sm font-semibold ${Number(lastCloseReport.difference || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {Number(lastCloseReport.difference || 0) >= 0 ? '+' : '-'}{formatMoney(Math.abs(Number(lastCloseReport.difference || 0)))}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSidebarView('close_report')}
                          className="mt-3 h-9 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm font-semibold text-[#334155] transition hover:bg-[#f8fafc]"
                        >
                          Ver detalle del arqueo
                        </button>
                        </>
                      ) : (
                        <p className="mt-3 text-sm text-[#64748b]">Aun no hay un arqueo generado en esta sesion.</p>
                      )}
                    </article>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {actionSidebarOpen && (
        <button
          type="button"
          aria-label="Cerrar panel"
          className="fixed inset-0 z-[2147483200] bg-[#0f172a]/35 backdrop-blur-[2px]"
          onClick={closeActionSidebar}
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-[2147483300] w-full max-w-[560px] border-l border-[#dbe2ee] bg-white shadow-[-16px_0_48px_rgba(15,23,42,0.2)] transition-transform duration-300 ${
          actionSidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-[#eef0f5] px-6 py-5">
            <div>
              <h2 className="text-[25px] leading-none font-black tracking-[-0.02em] text-[#181d2f]">
                {sidebarView === 'open_shift' && 'Abrir caja'}
                {sidebarView === 'close_shift' && 'Cerrar caja'}
                {sidebarView === 'movement_create' && 'Registrar movimiento'}
                {sidebarView === 'close_report' && 'Detalle de arqueo'}
              </h2>
              <p className="mt-3 text-[13px] leading-snug text-[#7d879d]">
                {sidebarView === 'open_shift' && 'Configura caja registradora y monto inicial.'}
                {sidebarView === 'close_shift' && 'Ingresa el efectivo contado para cerrar el turno.'}
                {sidebarView === 'movement_create' && 'Crea ingresos o egresos sin saturar la vista principal.'}
                {sidebarView === 'close_report' && 'Resumen ampliado del ultimo cierre registrado.'}
              </p>
              <span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${currentShift ? 'bg-[#e8f8ec] text-[#16733f]' : 'bg-[#eef2ff] text-[#3155df]'}`}>
                {currentShift ? 'Caja abierta' : 'Caja cerrada'}
              </span>
            </div>
            <button
              type="button"
              onClick={closeActionSidebar}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#e4e7ee] text-[#798194] hover:bg-[#f7f8fb]"
              aria-label="Cerrar"
            >
              <X size={15} />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {sidebarView === 'open_shift' && (
              <form className="space-y-3" onSubmit={handleOpenShift}>
                <div>
                  <label className="text-xs font-medium text-[#475569]">Caja registradora</label>
                  <select
                    value={openShiftForm.cashRegisterId}
                    onChange={(event) => setOpenShiftForm((prev) => ({ ...prev, cashRegisterId: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  >
                    <option value="">Seleccionar</option>
                    {cashRegisters.map((register) => (
                      <option key={register.id} value={register.id}>
                        {register.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-[#475569]">Monto inicial</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={openShiftForm.openingAmount}
                    onChange={(event) => setOpenShiftForm((prev) => ({ ...prev, openingAmount: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                    placeholder="0"
                  />
                </div>

                <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3 text-xs text-[#475569]">
                  Al abrir caja comienza el turno operativo y podras registrar movimientos.
                </div>

                <button
                  type="submit"
                  disabled={openingShift}
                  className="h-10 w-full rounded-xl bg-[#1f4ed8] text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {openingShift ? 'Abriendo...' : 'Confirmar apertura'}
                </button>
              </form>
            )}

            {sidebarView === 'close_shift' && (
              <form className="space-y-3" onSubmit={handleCloseShift}>
                <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3 text-xs text-[#334155]">
                  <p><span className="font-semibold">Caja:</span> {currentShift?.cashRegister?.name || '-'}</p>
                  <p><span className="font-semibold">Apertura:</span> {currentShift?.openedAt ? formatDateTime24(currentShift.openedAt) : '-'}</p>
                  <p><span className="font-semibold">Monto inicial:</span> {formatMoney(Number(currentShift?.openingAmount || 0))}</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-[#475569]">Dinero contado al cierre</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={closeShiftForm.countedCash}
                    onChange={(event) => setCloseShiftForm({ countedCash: event.target.value })}
                    className="mt-1 h-10 w-full rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                    placeholder="0"
                  />
                </div>

                <button
                  type="submit"
                  disabled={closingShift || !currentShift}
                  className="h-10 w-full rounded-xl bg-[#0f172a] text-sm font-semibold text-white transition hover:bg-[#1e293b] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {closingShift ? 'Cerrando...' : 'Confirmar cierre'}
                </button>
              </form>
            )}

            {sidebarView === 'movement_create' && (
              <form className="grid grid-cols-1 gap-3" onSubmit={handleCreateMovement}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    value={newMovement.type}
                    onChange={(event) => setNewMovement((prev) => ({ ...prev, type: event.target.value as 'INCOME' | 'EXPENSE' }))}
                    className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  >
                    <option value="INCOME">Ingreso</option>
                    <option value="EXPENSE">Egreso</option>
                  </select>

                  <select
                    value={newMovement.method}
                    onChange={(event) => setNewMovement((prev) => ({ ...prev, method: event.target.value as 'CASH' | 'TRANSFER' | 'CARD' }))}
                    className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  >
                    <option value="CASH">Efectivo</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CARD">Tarjeta</option>
                  </select>
                </div>

                <input
                  type="text"
                  value={newMovement.description}
                  onChange={(event) => setNewMovement((prev) => ({ ...prev, description: event.target.value }))}
                  className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  placeholder="Descripcion"
                />

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newMovement.amount}
                  onChange={(event) => setNewMovement((prev) => ({ ...prev, amount: event.target.value }))}
                  className="h-10 rounded-xl border border-[#dbe2ee] bg-white px-3 text-sm outline-none focus:border-[#1f4ed8]"
                  placeholder="Monto"
                />

                {!currentShift && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    Debes abrir una caja para registrar movimientos.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submittingMovement || !currentShift}
                  className="h-10 rounded-xl bg-[#1f4ed8] px-4 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingMovement ? 'Guardando...' : 'Guardar movimiento'}
                </button>
              </form>
            )}

            {sidebarView === 'close_report' && (
              <div className="space-y-3">
                {lastCloseReport ? (
                  <>
                    <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] p-3 text-xs text-[#334155]">
                      <p><span className="font-semibold">Turno:</span> {lastCloseReport.shift?.id || '-'}</p>
                      <p><span className="font-semibold">Apertura:</span> {lastCloseReport.shift?.openedAt ? formatDateTime24(lastCloseReport.shift.openedAt) : '-'}</p>
                      <p><span className="font-semibold">Cierre:</span> {lastCloseReport.shift?.closedAt ? formatDateTime24(lastCloseReport.shift.closedAt) : '-'}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Esperado</p>
                        <p className="mt-1 text-sm font-semibold text-[#0f172a]">{formatMoney(lastCloseReport.expectedCash)}</p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Contado</p>
                        <p className="mt-1 text-sm font-semibold text-[#0f172a]">{formatMoney(lastCloseReport.countedCash)}</p>
                      </div>
                      <div className="rounded-xl border border-[#e6ebf2] bg-[#f8fafc] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-[#64748b]">Diferencia</p>
                        <p className={`mt-1 text-sm font-semibold ${Number(lastCloseReport.difference || 0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {Number(lastCloseReport.difference || 0) >= 0 ? '+' : '-'}{formatMoney(Math.abs(Number(lastCloseReport.difference || 0)))}
                        </p>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-xl border border-[#e6ebf2] p-8 text-center text-sm text-[#64748b]">
                    Aun no hay un arqueo generado en esta sesion.
                  </div>
                )}
              </div>
            )}

            {sidebarView !== 'close_report' && (
              <section className="mt-4 rounded-2xl border border-[#e6ebf2] bg-[#f8fafc] p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Flujo recomendado</p>
                <ol className="mt-2 space-y-1 text-xs text-[#475569]">
                  <li>1. Abrir caja y validar monto inicial.</li>
                  <li>2. Registrar ingresos/egresos durante la operacion.</li>
                  <li>3. Cerrar caja con arqueo y revisar diferencia.</li>
                </ol>
              </section>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
