import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ClientService } from '../services/ClientService';
import { ClubAdminService } from '../services/ClubAdminService';
import { ClubService } from '../services/ClubService';
import { getAccountById, registerPayment } from '../services/AccountService';
import { Phone, DollarSign, Users, Trophy, Search, X, CheckCircle, Receipt, Plus, Pencil, Trash2 } from 'lucide-react';
import PaymentCalculator, { type PaymentCalculatorResult } from './PaymentCalculator';
import AppModal from './AppModal';
import { getActiveClubSlug, normalizeSessionUser } from '../utils/session';
import { reportUiError } from '../utils/uiError';
import { buildCanonicalPhone, DEFAULT_PHONE_COUNTRY_ISO2, normalizePhoneCountryIso2, PHONE_COUNTRY_OPTIONS, splitCanonicalPhone } from '../utils/phone';

const formatDate = (dateInput: any) => {
  if (!dateInput) return '-';
  // Si viene YYYY-MM-DD (fecha local del club desde el backend), formatear sin timezone
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(dateInput);
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
};

const formatDateTime = (dateInput: any) => {
  if (!dateInput) return '-';
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

const bookingStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado'
};

const accountStatusLabel: Record<string, string> = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada'
};

const paymentStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagado',
  DEBT: 'Fiado',
  PARTIAL: 'Parcial'
};

const accountSourceTypeLabel: Record<string, string> = {
  BOOKING: 'Reserva',
  BAR: 'Bar',
  TABLE: 'Mesa',
  MANUAL: 'Manual',
  OTHER: 'Otro'
};

const accountItemTypeLabel: Record<string, string> = {
  BOOKING: 'Cancha',
  PRODUCT: 'Producto',
  BAR: 'Bar',
  CONSUMPTION: 'Consumo',
  OTHER: 'Otro'
};

const formatRawTypeFallback = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatAccountSourceType = (value: unknown) => {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return '-';
  return accountSourceTypeLabel[key] || formatRawTypeFallback(key);
};

const formatAccountItemType = (value: unknown) => {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return '-';
  return accountItemTypeLabel[key] || formatRawTypeFallback(key);
};

const getClientRoles = (client: any): string[] => {
  const roles: string[] = [];
  if (Boolean(client?.isProfessor)) roles.push('Profesor');
  if (roles.length === 0) roles.push('Cliente');
  return roles;
};

const getEntryReference = (entry: any) => {
  const accountId = String(entry?.id || '').trim();
  if (accountId) return `C-${accountId.slice(-6).toUpperCase()}`;
  return 'C-?';
};

const sortByCreationDesc = (a: any, b: any) => {
  const createdA = new Date(a?.createdAt || `${a?.date || ''}T${a?.time || '00:00'}:00`).getTime();
  const createdB = new Date(b?.createdAt || `${b?.date || ''}T${b?.time || '00:00'}:00`).getTime();
  if (Number.isFinite(createdA) && Number.isFinite(createdB) && createdA !== createdB) {
    return createdB - createdA;
  }
  return Number(b?.id || 0) - Number(a?.id || 0);
};

const buildClientBookingHistory = (client: any) => {
  const rows = Array.isArray(client?.bookings) ? client.bookings : [];
  const normalized = rows
    .map((entry: any) => ({
      bookingId: entry?.bookingId ?? entry?.id ?? null,
      status: String(entry?.bookingStatus || entry?.status || '').trim().toUpperCase(),
      date: entry?.date || entry?.startDateTime || null,
      time: entry?.time || null,
      courtName: entry?.courtName || '-',
      amount: Number(entry?.totalAmount || entry?.amount || entry?.price || 0)
    }))
    .filter((entry) => entry.bookingId != null);

  const dedup = new Map<string, (typeof normalized)[number]>();
  for (const entry of normalized) {
    const key = String(entry.bookingId);
    if (!dedup.has(key)) dedup.set(key, entry);
  }
  return Array.from(dedup.values()).sort((a, b) => {
    const ta = new Date(a.date || '').getTime();
    const tb = new Date(b.date || '').getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return tb - ta;
    return Number(b.bookingId) - Number(a.bookingId);
  });
};

interface ClientsPageProps {
  clubSlug?: string;
}

const EPSILON = 0.009;

type PendingAccountItem = {
  id: string;
  type: string;
  description: string;
  quantity: number;
  total: number;
  paid: number;
  remaining: number;
};

type PendingAccountBreakdown = {
  total: number;
  paid: number;
  remaining: number;
  items: PendingAccountItem[];
  bookingPendingItems: PendingAccountItem[];
  consumptionPendingItems: PendingAccountItem[];
  courtPending: number;
  consumptionPending: number;
  totalPending: number;
};

type ClientViewScope = 'all' | 'debt_open';

const buildPendingBreakdown = (detail: any): PendingAccountBreakdown => {
  const items = Array.isArray(detail?.items) ? detail.items : [];
  const payments = Array.isArray(detail?.payments) ? detail.payments : [];

  const allocatedByItem = new Map<string, number>();
  for (const paymentEntry of payments) {
    const allocations = Array.isArray(paymentEntry?.allocations) ? paymentEntry.allocations : [];
    for (const allocation of allocations) {
      const itemId = String(allocation?.accountItemId || '').trim();
      if (!itemId) continue;
      const prev = Number(allocatedByItem.get(itemId) || 0);
      allocatedByItem.set(itemId, Number((prev + Number(allocation?.amount || 0)).toFixed(2)));
    }
  }

  const normalizedItems: PendingAccountItem[] = items.map((item: any) => {
    const id = String(item?.id || '');
    const total = Number(item?.total || 0);
    const paid = Math.max(0, Number(allocatedByItem.get(id) || 0));
    const remaining = Math.max(0, Number((total - paid).toFixed(2)));
    return {
      id,
      type: String(item?.type || 'OTHER'),
      description: String(item?.description || 'Concepto'),
      quantity: Math.max(1, Number(item?.quantity || 1)),
      total,
      paid: Number(paid.toFixed(2)),
      remaining
    };
  });

  const bookingPendingItems = normalizedItems.filter((item) => item.type === 'BOOKING' && item.remaining > EPSILON);
  const consumptionPendingItems = normalizedItems.filter((item) => item.type !== 'BOOKING' && item.remaining > EPSILON);
  const courtPending = Number(bookingPendingItems.reduce((sum, item) => sum + item.remaining, 0).toFixed(2));
  const consumptionPending = Number(consumptionPendingItems.reduce((sum, item) => sum + item.remaining, 0).toFixed(2));
  const totalPending = Number((courtPending + consumptionPending).toFixed(2));

  return {
    total: Number(detail?.total || 0),
    paid: Number(detail?.paid || 0),
    remaining: Number(detail?.remaining || 0),
    items: normalizedItems,
    bookingPendingItems,
    consumptionPendingItems,
    courtPending,
    consumptionPending,
    totalPending
  };
};

export default function ClientsPage({ clubSlug }: ClientsPageProps = {}) {
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDebtor, setSelectedDebtor] = useState<any>(null);
  const [selectedClientDetail, setSelectedClientDetail] = useState<any>(null);
  const [selectedClientHistory, setSelectedClientHistory] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewScope, setViewScope] = useState<ClientViewScope>('all');
  const [showPayMethodModal, setShowPayMethodModal] = useState(false);
  const [debtTarget, setDebtTarget] = useState<{ accountId: string } | null>(null);
  const [submittingCalculator, setSubmittingCalculator] = useState(false);
  const [selectedAccountDetail, setSelectedAccountDetail] = useState<any>(null);
  const [showAccountDetailModal, setShowAccountDetailModal] = useState(false);
  const [accountBreakdownById, setAccountBreakdownById] = useState<Record<string, PendingAccountBreakdown>>({});
  const [loadingAccountDetailById, setLoadingAccountDetailById] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);
  const debtBackdropMouseDownRef = useRef(false);
  const clientDetailBackdropMouseDownRef = useRef(false);
  const historyBackdropMouseDownRef = useRef(false);
  const [showClientFormModal, setShowClientFormModal] = useState(false);
  const [clientFormSubmitting, setClientFormSubmitting] = useState(false);
  const [clientToEdit, setClientToEdit] = useState<any | null>(null);
  const [clientForm, setClientForm] = useState({
    name: '',
    phoneCountryIso2: DEFAULT_PHONE_COUNTRY_ISO2,
    phone: '',
    dni: '',
    email: '',
    isProfessor: false
  });
  const [clubPhoneCountryIso2, setClubPhoneCountryIso2] = useState(DEFAULT_PHONE_COUNTRY_ISO2);
  const [selectedClientDiscountAssignments, setSelectedClientDiscountAssignments] = useState<any[]>([]);
  const [loadingSelectedClientDiscountAssignments, setLoadingSelectedClientDiscountAssignments] = useState(false);
  const [deleteClientModal, setDeleteClientModal] = useState<{ show: boolean; client: any | null; submitting: boolean }>({
    show: false,
    client: null,
    submitting: false
  });

  // --- LÓGICA DEL APPMODAL ---
  const [modalState, setModalState] = useState<{
    show: boolean; title?: string; message?: ReactNode; cancelText?: string; confirmText?: string;
    isWarning?: boolean; onConfirm?: () => Promise<void> | void; onCancel?: () => Promise<void> | void;
    closeOnBackdrop?: boolean; closeOnEscape?: boolean;
  }>({ show: false });

  const closeModal = () => setModalState((prev) => ({ ...prev, show: false, onConfirm: undefined, onCancel: undefined }));
  const showInfo = (message: ReactNode, title = 'Información') => setModalState({ show: true, title, message, cancelText: '', confirmText: 'OK' });
  const showError = (message: ReactNode) => setModalState({ show: true, title: 'Error', message, isWarning: true, cancelText: '', confirmText: 'Aceptar' });
  const resolveClubSlug = useCallback(() => {
    return clubSlug || getActiveClubSlug(normalizeSessionUser(null)) || '';
  }, [clubSlug]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const slug = resolveClubSlug();
        if (!slug) return;
        const club = await ClubService.getClubBySlug(slug);
        if (cancelled) return;
        const iso = normalizePhoneCountryIso2(club?.country);
        setClubPhoneCountryIso2(iso);
        setClientForm((prev) => ({ ...prev, phoneCountryIso2: prev.phoneCountryIso2 || iso }));
      } catch {
        if (!cancelled) setClubPhoneCountryIso2(DEFAULT_PHONE_COUNTRY_ISO2);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolveClubSlug]);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      const resolvedSlug = resolveClubSlug() || undefined;
      const data = await ClientService.listDebtors(resolvedSlug, { scope: viewScope });
      setClients(data);
      return data;
    } catch (error: any) {
      reportUiError({ area: 'ClientsPage', action: 'loadClients' }, error);
      showError(error?.message || 'No se pudo cargar la lista de clientes.');
    }
    finally { setLoading(false); }
    return null;
  }, [resolveClubSlug, viewScope]);

  const openCreateClientModal = () => {
    setClientToEdit(null);
    setClientForm({ name: '', phoneCountryIso2: clubPhoneCountryIso2, phone: '', dni: '', email: '', isProfessor: false });
    setShowClientFormModal(true);
  };

  const copyToClipboard = async (value: string, label: string) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } else {
        throw new Error('Clipboard no disponible');
      }
      showInfo(`${label} copiado: ${text}`, 'Copiado');
    } catch {
      showError(`No se pudo copiar ${label.toLowerCase()}.`);
    }
  };

  const openEditClientModal = (client: any) => {
    const splitPhone = splitCanonicalPhone(String(client?.phone || ''), clubPhoneCountryIso2);
    setClientToEdit(client);
    setClientForm({
      name: String(client?.name || ''),
      phoneCountryIso2: splitPhone.countryIso2 || clubPhoneCountryIso2,
      phone: String(splitPhone.localNumber || ''),
      dni: String(client?.dni && client.dni !== '-' ? client.dni : ''),
      email: String(client?.email || ''),
      isProfessor: Boolean(client?.isProfessor)
    });
    setShowClientFormModal(true);
  };

  const submitClientForm = async () => {
    const slug = resolveClubSlug();
    if (!slug) {
      showError('No se pudo resolver el club activo para guardar el cliente.');
      return;
    }

    const name = String(clientForm.name || '').trim();
    const phoneLocal = String(clientForm.phone || '').trim();
    const canonicalPhone = buildCanonicalPhone({
      countryIso2: clientForm.phoneCountryIso2 || clubPhoneCountryIso2,
      localNumber: phoneLocal
    });
    const dni = String(clientForm.dni || '').trim();
    const email = String(clientForm.email || '').trim();

    if (name.length < 2) {
      showError('Ingresá un nombre válido.');
      return;
    }
    if (phoneLocal.length > 0 && !canonicalPhone) {
      showError('Si cargás teléfono, debe ser válido.');
      return;
    }
    if (dni.length > 0 && dni.length < 6) {
      showError('Si cargás DNI, debe tener al menos 6 dígitos.');
      return;
    }

    try {
      setClientFormSubmitting(true);
      const payload = {
        name,
        phone: canonicalPhone || undefined,
        phoneCountryCode: clientForm.phoneCountryIso2 || undefined,
        phoneNumberLocal: phoneLocal || undefined,
        dni: dni || undefined,
        email: email || undefined,
        isProfessor: Boolean(clientForm.isProfessor)
      };
      if (clientToEdit?.id) {
        await ClientService.updateByClubSlug(slug, String(clientToEdit.id), payload);
      } else {
        await ClientService.createByClubSlug(slug, payload);
      }
      setShowClientFormModal(false);
      await loadClients();
      showInfo(clientToEdit?.id ? 'Cliente actualizado correctamente.' : 'Cliente creado correctamente.', 'Clientes');
    } catch (error: any) {
      showError(error?.message || 'No se pudo guardar el cliente.');
    } finally {
      setClientFormSubmitting(false);
    }
  };

  const askDeleteClient = (client: any) => {
    setDeleteClientModal({ show: true, client, submitting: false });
  };

  const confirmDeleteClient = async () => {
    const slug = resolveClubSlug();
    if (!slug || !deleteClientModal.client?.id) {
      setDeleteClientModal({ show: false, client: null, submitting: false });
      return;
    }
    try {
      setDeleteClientModal((prev) => ({ ...prev, submitting: true }));
      await ClientService.deleteByClubSlug(slug, String(deleteClientModal.client.id));
      setDeleteClientModal({ show: false, client: null, submitting: false });
      await loadClients();
      showInfo('Cliente eliminado correctamente.', 'Clientes');
    } catch (error: any) {
      setDeleteClientModal((prev) => ({ ...prev, submitting: false }));
      showError(error?.message || 'No se pudo eliminar el cliente.');
    }
  };

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  useEffect(() => {
    setSelectedDebtor(null);
    setSelectedClientDetail(null);
    setSelectedClientHistory(null);
    setSelectedClientDiscountAssignments([]);
    setShowPayMethodModal(false);
    setDebtTarget(null);
  }, [viewScope]);

  useEffect(() => {
    const loadClientDiscountAssignments = async () => {
      if (!selectedClientDetail?.id) {
        setSelectedClientDiscountAssignments([]);
        return;
      }

      const slug = resolveClubSlug();
      if (!slug) {
        setSelectedClientDiscountAssignments([]);
        return;
      }

      try {
        setLoadingSelectedClientDiscountAssignments(true);
        const rows = await ClubAdminService.listClientDiscountAssignments(slug, String(selectedClientDetail.id));
        setSelectedClientDiscountAssignments(Array.isArray(rows) ? rows : []);
      } catch {
        setSelectedClientDiscountAssignments([]);
      } finally {
        setLoadingSelectedClientDiscountAssignments(false);
      }
    };

    void loadClientDiscountAssignments();
  }, [selectedClientDetail?.id, resolveClubSlug]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredClients = clients.filter(client => {
    const term = searchTerm.toLowerCase();
    return client.name.toLowerCase().includes(term) || (client.phone && client.phone.includes(term)) || (client.dni && client.dni.toLowerCase().includes(term));
  });

  const totalDebt = clients.reduce((sum, c) => sum + c.totalDebt, 0);
  const totalClients = clients.length;
  const topClient = clients.reduce((prev, current) => (prev.totalBookings > current.totalBookings) ? prev : current, {name: '-', totalBookings: 0});

  const ensureAccountBreakdown = useCallback(async (accountId: string) => {
    const key = String(accountId || '').trim();
    if (!key) return null;
    if (accountBreakdownById[key]) return accountBreakdownById[key];
    if (loadingAccountDetailById[key]) return null;

    try {
      setLoadingAccountDetailById((prev) => ({ ...prev, [key]: true }));
      const detail = await getAccountById(key);
      const breakdown = buildPendingBreakdown(detail);
      setAccountBreakdownById((prev) => ({ ...prev, [key]: breakdown }));
      return breakdown;
    } catch (error) {
      reportUiError({ area: 'ClientsPage', action: 'ensureAccountBreakdown' }, error);
      return null;
    } finally {
      setLoadingAccountDetailById((prev) => ({ ...prev, [key]: false }));
    }
  }, [accountBreakdownById, loadingAccountDetailById]);

  const handleOpenPayModal = async (target: { accountId: string }) => {
    const selectedEntry = selectedDebtorPendingEntries.find((entry: any) => String(entry.id) === String(target.accountId));

    if (!selectedEntry || Number(selectedEntry.amount || 0) <= 0.01) {
      showInfo('Este registro ya no tiene deuda pendiente.', 'Sin deuda');
      return;
    }

    await ensureAccountBreakdown(String(target.accountId));
    setDebtTarget(target);
    setShowPayMethodModal(true);
  };

  const processDebtPayment = async (result: PaymentCalculatorResult) => {
    if (!debtTarget) return;
    try {
      setSubmittingCalculator(true);
      const bookingInfo = selectedDebtorPendingEntries.find((entry: any) => String(entry.id) === String(debtTarget.accountId));

      if (!bookingInfo || Number(bookingInfo.amount || 0) <= 0.01) {
        showInfo('Este registro ya no tiene deuda pendiente.', 'Sin deuda');
        setShowPayMethodModal(false);
        setDebtTarget(null);
        return;
      }

      const breakdown = accountBreakdownById[String(bookingInfo.id)];
      const itemAllocationMap = new Map<string, number>(
        (result.itemAllocations || [])
          .map((entry) => [String(entry.key), Number(entry.amount || 0)] as const)
          .filter(([, amount]) => amount > EPSILON)
      );

      const allocations: Array<{ accountItemId: string; amount: number }> = [];
      for (const item of breakdown?.consumptionPendingItems || []) {
        const allocated = Number(itemAllocationMap.get(String(item.id)) || 0);
        if (allocated > EPSILON) {
          allocations.push({
            accountItemId: String(item.id),
            amount: Number(Math.min(item.remaining, allocated).toFixed(2))
          });
        }
      }

      let remainingCourtToAllocate = Math.max(0, Number(result.courtAmount || 0));
      for (const item of breakdown?.bookingPendingItems || []) {
        if (remainingCourtToAllocate <= EPSILON) break;
        const amount = Math.min(item.remaining, remainingCourtToAllocate);
        if (amount > EPSILON) {
          allocations.push({
            accountItemId: String(item.id),
            amount: Number(amount.toFixed(2))
          });
          remainingCourtToAllocate = Number((remainingCourtToAllocate - amount).toFixed(2));
        }
      }

      await registerPayment({
        accountId: String(bookingInfo.id),
        amount: Number(result.amount || 0),
        method: result.method,
        allocations: allocations.length > 0 ? allocations : undefined
      });

      await loadClients();
    } catch (error) {
      showError("No se pudo procesar el cobro. Intenta nuevamente.");
    } finally {
      setSubmittingCalculator(false);
    }
  };

  const selectedDebtorPendingEntries = (selectedDebtor?.history || [])
    .slice()
    .sort(sortByCreationDesc)
    .filter((entry: any) => Number(entry.amount || 0) > 0.01);
  const selectedDebtEntry = selectedDebtorPendingEntries.find((entry: any) => entry.id === debtTarget?.accountId);
  const selectedDebtBreakdown = selectedDebtEntry ? accountBreakdownById[String(selectedDebtEntry.id)] : null;
  const selectedAccountBreakdown = selectedAccountDetail ? accountBreakdownById[String(selectedAccountDetail.id)] : null;
  const selectedClientBookingsHistory = selectedClientHistory ? buildClientBookingHistory(selectedClientHistory) : [];

  const openAccountDetail = async (account: any) => {
    await ensureAccountBreakdown(String(account?.id || ''));
    setSelectedAccountDetail(account);
    setShowAccountDetailModal(true);
  };
  
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      
      {/* TARJETAS KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border-4 border-white p-6 rounded-[2rem] shadow-xl flex items-center justify-between">
             <div><h3 className="text-[#347048]/40 text-[10px] font-black uppercase tracking-widest mb-1">Total Clientes</h3><p className="text-4xl font-black text-[#347048] italic tracking-tighter">{totalClients}</p></div>
             <div className="bg-[#347048]/5 p-4 rounded-2xl text-[#347048]"><Users size={28} /></div>
          </div>
          <div className="bg-white border-4 border-white p-6 rounded-[2rem] shadow-xl flex items-center justify-between">
             <div><h3 className="text-[#926699]/60 text-[10px] font-black uppercase tracking-widest mb-1">Más Fiel</h3><p className="text-xl font-black text-[#926699] italic tracking-tight truncate max-w-[150px] uppercase">{topClient.name}</p></div>
             <div className="bg-[#926699]/10 p-4 rounded-2xl text-[#926699]"><Trophy size={28} /></div>
          </div>
          <div className={`border-4 p-6 rounded-[2rem] shadow-xl flex items-center justify-between transition-colors ${totalDebt > 0 ? 'bg-white border-red-100' : 'bg-white border-emerald-100'}`}>
             <div><h3 className={`${totalDebt > 0 ? 'text-red-500' : 'text-emerald-600'} text-[10px] font-black uppercase tracking-widest mb-1`}>{totalDebt > 0 ? 'Fiado / A Cobrar' : 'Cuentas al Día'}</h3><p className={`text-4xl font-black italic tracking-tighter ${totalDebt > 0 ? 'text-red-600' : 'text-emerald-600'}`}>${totalDebt.toLocaleString()}</p></div>
             <div className={`${totalDebt > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600'} p-4 rounded-2xl`}><DollarSign size={28} strokeWidth={2.5} /></div>
          </div>
      </div>

      {/* TABLA + BUSCADOR */}
      <div className="bg-white/40 backdrop-blur-sm border-2 border-white rounded-[2rem] p-6 overflow-hidden shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 px-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tight">
                <Receipt className="text-[#B9CF32]" /> Directorio de Clientes
              </h2>
              <div className="inline-flex rounded-xl border border-[#347048]/15 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setViewScope('all')}
                  className={`h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition ${
                    viewScope === 'all'
                      ? 'bg-[#347048] text-white'
                      : 'text-[#347048]/65 hover:text-[#347048]'
                  }`}
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={() => setViewScope('debt_open')}
                  className={`h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition ${
                    viewScope === 'debt_open'
                      ? 'bg-[#347048] text-white'
                      : 'text-[#347048]/65 hover:text-[#347048]'
                  }`}
                >
                  Con deuda/cuenta abierta
                </button>
              </div>
              <button
                type="button"
                onClick={openCreateClientModal}
                className="h-9 w-9 rounded-lg bg-white border border-[#347048]/20 text-[#347048] hover:bg-[#347048]/5 transition-all shadow-sm flex items-center justify-center"
                title="Nuevo cliente"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="relative w-full md:w-80 group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-colors group-focus-within:text-[#B9CF32] text-[#347048]/40"><Search size={18} strokeWidth={2.5} /></div>
                <input type="text" className="block w-full pl-12 pr-4 py-3 border-2 border-transparent focus:border-[#B9CF32] rounded-xl bg-white text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none transition-all shadow-sm" placeholder="Buscar por Nombre, DNI o Tel..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute inset-y-0 right-2 my-auto h-8 w-8 bg-white rounded-full shadow-sm flex items-center justify-center text-[#347048]/40 hover:text-[#347048] hover:scale-110 transition-transform"
                    aria-label="Limpiar búsqueda"
                  >
                    <X size={14} strokeWidth={3} />
                  </button>
                )}
            </div>
        </div>
        
        {loading ? <div className="py-20 flex justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-4 border-[#347048]"></div></div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-y-2">
              <thead>
                <tr className="text-[10px] font-black uppercase tracking-[0.2em] text-[#347048]/40">
                  <th className="px-6 py-2">Cliente</th>
                  <th className="px-6 py-2">DNI</th>
                  <th className="px-6 py-2">Contacto</th>
                  <th className="px-6 py-2">Historial (Cuentas)</th>
                  <th className="px-6 py-2">Saldo</th>
                  <th className="px-6 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.length > 0 ? (
                    filteredClients.map((client) => {
                      
                      const dniFinal = (client.dni && client.dni !== '-') ? client.dni : null;
                      const historyCount = Array.isArray(client.history) ? client.history.length : 0;
                      const totalBookings = Number(client.totalBookings || 0);
                      const bookingsWithoutAccount = Math.max(0, totalBookings - historyCount);

                      return (
                        <tr
                          key={client.id}
                          className="bg-white/80 hover:bg-white transition-all duration-150 shadow-sm hover:shadow-md hover:shadow-[#347048]/10 group cursor-pointer"
                          onClick={() => setSelectedClientDetail(client)}
                        >
                            
                            <td className="px-6 py-4 font-black text-[#347048] first:rounded-l-2xl uppercase tracking-tight italic">
                              <span className="group-hover:text-[#2b6a43] transition-colors">{client.name}</span>
                            </td>
                            
                            <td className="px-6 py-4">
                                {/* 2. Y ACÁ LO MOSTRAMOS SÚPER FÁCIL */}
                                {dniFinal ? (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void copyToClipboard(String(dniFinal), 'DNI');
                                      }}
                                      className="bg-[#347048]/5 border border-[#347048]/10 px-2 py-1 rounded-lg text-[#347048] font-bold text-xs hover:bg-[#347048]/10 transition-colors cursor-copy"
                                      title="Copiar DNI"
                                    >
                                        {dniFinal}
                                    </button>
                                ) : (
                                    <span className="opacity-20">-</span>
                                )}
                            </td>
                            
                            <td className="px-6 py-4 text-[#347048]/70 font-bold text-xs uppercase">
                                {client.phone ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void copyToClipboard(String(client.phone), 'Teléfono');
                                    }}
                                    className="flex items-center gap-2 hover:text-[#347048] transition-colors cursor-copy"
                                    title="Copiar teléfono"
                                  >
                                    <Phone size={12} className="text-[#B9CF32]" />
                                    {client.phone}
                                  </button>
                                ) : '-'}
                            </td>
                            
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-2">
                                <span className="inline-flex whitespace-nowrap text-[10px] font-black bg-[#926699]/10 text-[#926699] px-3 py-1 rounded-full border border-[#926699]/20 uppercase tracking-widest">
                                  {historyCount} Cuentas
                                </span>
                                {bookingsWithoutAccount > 0 ? (
                                  <span className="inline-flex whitespace-nowrap text-[10px] font-black bg-amber-50 text-amber-700 px-3 py-1 rounded-full border border-amber-200 uppercase tracking-widest">
                                    {bookingsWithoutAccount} sin cuenta
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            
                            <td className="px-6 py-4">
                              {client.totalDebt > 0 ? (
                                  <span className="inline-flex items-center gap-2 whitespace-nowrap bg-red-50 text-red-600 px-3 py-1.5 rounded-xl text-[10px] font-black border border-red-100 uppercase tracking-wider italic">DEBE: ${client.totalDebt.toLocaleString()}</span>
                              ) : (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-emerald-600 text-[10px] font-black uppercase tracking-wider"><CheckCircle size={12}/> Al día</span>
                              )}
                            </td>
                            
                            <td className="px-6 py-4 last:rounded-r-2xl">
                              <div className="flex flex-nowrap justify-end gap-3">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openEditClientModal(client);
                                  }}
                                  className="h-8 w-8 rounded-lg bg-white border border-[#926699]/20 hover:bg-[#926699]/5 text-[#926699] transition flex items-center justify-center"
                                  title="Editar cliente"
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    askDeleteClient(client);
                                  }}
                                  className="h-8 w-8 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-600 transition flex items-center justify-center"
                                  title="Dar de baja"
                                >
                                  <Trash2 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedClientHistory(client);
                                  }}
                                  className="h-8 w-8 rounded-lg bg-white border border-[#347048]/15 hover:bg-[#347048]/5 text-[#347048] transition flex items-center justify-center"
                                  title="Ver historial"
                                >
                                  <Receipt size={12} />
                                </button>
                                {client.totalDebt > 0 && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setSelectedDebtor(client);
                                    }}
                                    className="h-8 w-8 rounded-lg bg-red-600 hover:bg-red-500 text-white transition flex items-center justify-center shadow-sm"
                                    title="Saldar deuda"
                                  >
                                    <DollarSign size={13} strokeWidth={3} />
                                  </button>
                                )}
                              </div>
                            </td>

                        </tr>
                      ); // <-- Fin del return de la fila
                    }) // <-- Fin del map
                ) : (
                    <tr><td colSpan={6} className="p-20 text-center text-[#347048]/30 font-black uppercase tracking-[0.3em] italic">Sin coincidencias</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL DETALLE DE CLIENTE */}
      {mounted && selectedClientDetail && createPortal(
        <div
          className="fixed inset-0 bg-[#347048]/60 flex items-center justify-center z-[2147483000] p-4 animate-in fade-in"
          onMouseDown={(event) => {
            clientDetailBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onTouchStart={(event) => {
            clientDetailBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            const startedOnBackdrop = clientDetailBackdropMouseDownRef.current;
            clientDetailBackdropMouseDownRef.current = false;
            if (startedOnBackdrop && event.target === event.currentTarget) {
              setSelectedClientDetail(null);
            }
          }}
        >
          <div className="bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-8 border-b border-[#347048]/10 flex items-center justify-between bg-[#EBE1D8]">
              <div>
                <h3 className="text-2xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tighter">
                  {selectedClientDetail.name}
                  {selectedClientDetail.isProfessor ? (
                    <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#926699]/10 text-[#926699] border border-[#926699]/20 not-italic">
                      Profesor
                    </span>
                  ) : null}
                </h3>
                <p className="text-[10px] font-black text-[#347048]/40 mt-1 uppercase tracking-widest">Detalle del cliente</p>
              </div>
              <button
                onClick={() => setSelectedClientDetail(null)}
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                title="Cerrar ventana"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>

            <div className="p-8 overflow-y-auto space-y-4 custom-scrollbar bg-white/40">
              <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45 mb-2">Roles</div>
                <div className="flex flex-wrap gap-2">
                  {getClientRoles(selectedClientDetail).map((role) => (
                    <span
                      key={role}
                      className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        role === 'Profesor'
                          ? 'bg-[#926699]/10 text-[#926699] border-[#926699]/20'
                          : 'bg-[#347048]/5 text-[#347048] border-[#347048]/15'
                      }`}
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">DNI</div>
                  <div className="mt-1 text-[12px] font-black uppercase tracking-wide text-[#347048]">
                    {selectedClientDetail.dni && selectedClientDetail.dni !== '-' ? selectedClientDetail.dni : 'No informado'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Teléfono</div>
                  <div className="mt-1 text-[12px] font-black uppercase tracking-wide text-[#347048]">
                    {selectedClientDetail.phone || 'No informado'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3 md:col-span-2">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Email</div>
                  <div className="mt-1 text-[12px] font-black tracking-wide text-[#347048] break-all">
                    {selectedClientDetail.email || 'No informado'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Total reservas</div>
                  <div className="mt-1 text-[18px] font-black italic tracking-tight text-[#347048]">
                    {Number(selectedClientDetail.totalBookings || 0)}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Saldo actual</div>
                  <div className={`mt-1 text-[18px] font-black italic tracking-tight ${Number(selectedClientDetail.totalDebt || 0) > 0.009 ? 'text-red-600' : 'text-emerald-600'}`}>
                    ${Number(selectedClientDetail.totalDebt || 0).toLocaleString()}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Próxima reserva</div>
                  <div className="mt-1 text-[12px] font-black uppercase tracking-wide text-[#347048]">
                    {selectedClientDetail.nextBookingAt ? formatDateTime(selectedClientDetail.nextBookingAt) : 'Sin próxima reserva'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Última reserva</div>
                  <div className="mt-1 text-[12px] font-black uppercase tracking-wide text-[#347048]">
                    {selectedClientDetail.lastBookingAt ? formatDateTime(selectedClientDetail.lastBookingAt) : 'Sin historial de reservas'}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45 mb-2">Asignaciones de descuentos</div>
                {loadingSelectedClientDiscountAssignments ? (
                  <p className="text-[11px] font-bold text-[#347048]/60">Cargando asignaciones...</p>
                ) : selectedClientDiscountAssignments.length === 0 ? (
                  <p className="text-center text-[#347048]/30 font-black py-6 uppercase italic">Sin registros</p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                    {selectedClientDiscountAssignments.map((assignment: any, index: number) => (
                      <div key={String(assignment?.id || `${assignment?.policyId || 'policy'}-${index}`)} className="rounded-xl border border-[#347048]/10 bg-white p-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-black text-[#347048]">
                            {String(assignment?.policy?.name || assignment?.policyName || assignment?.policyId || 'Política')}
                          </p>
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                            assignment?.isActive ? 'bg-[#B9CF32]/30 text-[#347048] border-[#B9CF32]/40' : 'bg-[#926699]/10 text-[#926699] border-[#926699]/30'
                          }`}>
                            {assignment?.isActive ? 'Activa' : 'Inactiva'}
                          </span>
                        </div>
                        {assignment?.notes ? (
                          <p className="text-[10px] font-bold text-[#347048]/65 mt-1">{String(assignment.notes)}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-[#347048]/10 bg-[#EBE1D8] flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedClientHistory(selectedClientDetail);
                  setSelectedClientDetail(null);
                }}
                className="h-10 px-4 rounded-xl bg-[#347048] text-white text-[10px] font-black uppercase tracking-widest"
              >
                Ver historiales
              </button>
              <button
                type="button"
                onClick={() => setSelectedClientDetail(null)}
                className="h-10 px-4 rounded-xl bg-white border border-[#347048]/20 text-[#347048] text-[10px] font-black uppercase tracking-widest"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL DETALLE DE DEUDA */}
      {mounted && selectedDebtor && createPortal(
        <div
          className="fixed inset-0 bg-[#347048]/60 flex items-center justify-center z-[2147483100] p-4 animate-in fade-in"
          onMouseDown={(event) => {
            debtBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onTouchStart={(event) => {
            debtBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            const startedOnBackdrop = debtBackdropMouseDownRef.current;
            debtBackdropMouseDownRef.current = false;
            if (startedOnBackdrop && event.target === event.currentTarget) {
              setSelectedDebtor(null);
            }
          }}
        >
            <div className="bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]">
                <div className="p-8 border-b border-[#347048]/10 bg-[#EBE1D8] flex justify-between items-center">
                    <div>
                        <h3 className="text-2xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tighter">Deuda de {selectedDebtor.name}</h3>
                        <p className="text-[#347048]/60 text-xs font-bold mt-1 uppercase tracking-widest italic">Total Pendiente: <span className="text-red-600 font-black text-lg ml-2">${selectedDebtor.totalDebt}</span></p>
                    </div>
                    <button
                      onClick={() => setSelectedDebtor(null)}
                      className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                      title="Cerrar ventana"
                    >
                      <X size={20} strokeWidth={3} />
                    </button>
                </div>

                <div className="p-8 flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-4 bg-white/40">
                  {selectedDebtorPendingEntries.length > 0 ? selectedDebtorPendingEntries.map((account: any) => {
                      const paymentStatus = String(account.paymentStatus || '');
                      const accountStatus = String(account.accountStatus || account.status || '');
                      const isPending = Number(account.amount || 0) > 0.01;

                      return (
                        <div
                          key={account.id}
                          role="button"
                          onClick={() => openAccountDetail(account)}
                          className="bg-white p-5 rounded-[1.5rem] border-2 border-[#347048]/5 flex justify-between items-center shadow-sm cursor-pointer hover:scale-[1.01] transition-transform"
                        >
                          <div className="flex flex-col flex-1">
                            <div className="flex items-center gap-3 mb-3">
                              <span className="font-black text-[#347048] text-sm bg-[#347048]/5 px-3 py-1 rounded-lg italic">{getEntryReference(account)}</span>
                              <span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">{formatDate(account.date)}</span>
                            </div>
                            <div className="text-sm font-black uppercase tracking-tight flex justify-between mb-2 pr-10 text-[#347048]">
                              <span>Cuenta {formatAccountSourceType(account.sourceType)}</span>
                              <span className="text-xs opacity-60 font-mono">${Number(account.totalAmount || 0).toLocaleString()}</span>
                            </div>
                            <div className="text-[11px] font-bold text-[#347048]/70 uppercase tracking-wide pr-10">
                              {account.bookingId
                                ? `Reserva #${account.bookingId} · Cancha: ${account.courtName || '-'}`
                                : `Origen: ${formatAccountSourceType(account.sourceType)}${account.sourceId ? ` #${account.sourceId}` : ''}`}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${accountStatus === 'OPEN' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                {accountStatusLabel[accountStatus] || accountStatus || 'Cuenta'}
                              </span>
                              <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${['DEBT', 'PARTIAL'].includes(paymentStatus) ? 'bg-red-50 text-red-500 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                {paymentStatusLabel[paymentStatus] || paymentStatus || 'Pago'}
                              </span>
                              <span className="px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-[#347048]/5 text-[#347048]/80 border-[#347048]/10">
                                Pagado ${Number(account.paidAmount || 0).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-6 pl-8 border-l-2 border-dashed border-[#347048]/10">
                            <div className="text-right">
                              <div className={`text-2xl font-black font-mono italic tracking-tighter ${isPending ? 'text-red-600' : 'text-emerald-600'}`}>
                                ${Number(account.amount || 0).toLocaleString()}
                              </div>
                              <div className="text-[9px] text-[#347048]/40 uppercase font-black tracking-widest">
                                {isPending ? 'Pendiente' : 'Saldado'}
                              </div>
                            </div>
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenPayModal({ accountId: String(account.id) });
                              }}
                              className="bg-[#B9CF32] hover:bg-[#aebd2b] text-[#347048] h-12 w-12 flex items-center justify-center rounded-2xl shadow-lg transition-all active:scale-95"
                            >
                              <DollarSign size={24} strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      );
                    }) : (
                      <p className="text-center text-[#347048]/40 font-black py-8 uppercase italic">Sin deuda pendiente</p>
                    )}
                </div>
            </div>
        </div>
          ,
          document.body
          )}

      {showPayMethodModal && selectedDebtEntry && (
        <PaymentCalculator
          courtPending={selectedDebtBreakdown ? Number(selectedDebtBreakdown.courtPending || 0) : Number(selectedDebtEntry.amount || 0)}
          courtBaseTotal={selectedDebtBreakdown ? Number(selectedDebtBreakdown.courtPending || 0) : Number(selectedDebtEntry.amount || 0)}
          cartItems={selectedDebtBreakdown
            ? selectedDebtBreakdown.consumptionPendingItems.map((item) => {
                const qty = Math.max(1, Number(item.quantity || 1));
                return {
                  id: String(item.id),
                  productName: item.description,
                  quantity: qty,
                  price: Number((item.remaining / qty).toFixed(2))
                };
              })
            : []}
          alreadyPaid={0}
          grandTotal={selectedDebtBreakdown ? Number(selectedDebtBreakdown.totalPending || 0) : Number(selectedDebtEntry.amount || 0)}
          onClose={() => {
            if (submittingCalculator) return;
            setShowPayMethodModal(false);
            setDebtTarget(null);
          }}
          onConfirm={processDebtPayment}
          submitting={submittingCalculator}
          zIndexClass="z-[2147483300]"
        />
      )}

      {/* HISTORIAL COMPLETO */}
      {mounted && selectedClientHistory && createPortal(
        <div
          className="fixed inset-0 bg-[#347048]/60 flex items-center justify-center z-[2147483200] p-4 animate-in fade-in"
          onMouseDown={(event) => {
            historyBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onTouchStart={(event) => {
            historyBackdropMouseDownRef.current = event.target === event.currentTarget;
          }}
          onClick={(event) => {
            const startedOnBackdrop = historyBackdropMouseDownRef.current;
            historyBackdropMouseDownRef.current = false;
            if (startedOnBackdrop && event.target === event.currentTarget) {
              setSelectedClientHistory(null);
            }
          }}
        >
          <div className="bg-[#EBE1D8] border-4 border-white rounded-[2.5rem] w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-8 border-b border-[#347048]/10 flex items-center justify-between bg-[#EBE1D8]">
              <div>
                <h3 className="text-2xl font-black text-[#347048] flex items-center gap-3 uppercase italic tracking-tighter">Historial de cuentas: {selectedClientHistory.name}</h3>
                <p className="text-[10px] font-black text-[#347048]/40 mt-1 uppercase tracking-widest">DNI: {selectedClientHistory.dni || '-'} · Tel: {selectedClientHistory.phone || '-'}</p>
              </div>
              <button
                onClick={() => setSelectedClientHistory(null)}
                className="bg-red-50 p-2.5 rounded-full shadow-sm hover:scale-110 transition-transform text-red-500 hover:text-white hover:bg-red-500 border border-red-100"
                title="Cerrar ventana"
              >
                <X size={20} strokeWidth={3} />
              </button>
            </div>
            <div className="p-8 overflow-y-auto space-y-4 custom-scrollbar bg-white/40">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Próxima reserva</div>
                  <div className="mt-1 text-[12px] font-black uppercase tracking-wide text-[#347048]">
                    {selectedClientHistory.nextBookingAt ? formatDateTime(selectedClientHistory.nextBookingAt) : 'Sin próxima reserva'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Última reserva</div>
                  <div className="mt-1 text-[12px] font-black uppercase tracking-wide text-[#347048]">
                    {selectedClientHistory.lastBookingAt ? formatDateTime(selectedClientHistory.lastBookingAt) : 'Sin historial de reservas'}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Total reservas</div>
                  <div className="mt-1 text-[18px] font-black italic tracking-tight text-[#347048]">
                    {Number(selectedClientHistory.totalBookings || 0)}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                  <div className="text-[9px] font-black uppercase tracking-widest text-[#347048]/45">Saldo actual</div>
                  <div className={`mt-1 text-[18px] font-black italic tracking-tight ${Number(selectedClientHistory.totalDebt || 0) > 0.009 ? 'text-red-600' : 'text-emerald-600'}`}>
                    ${Number(selectedClientHistory.totalDebt || 0).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2">Historial de reservas</div>
                {selectedClientBookingsHistory.length > 0 ? (
                  <div className="space-y-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                    {selectedClientBookingsHistory.map((booking: any) => (
                      <div key={String(booking.bookingId)} className="bg-white p-3 rounded-xl border border-[#347048]/10">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-black text-[#347048]">Reserva #{booking.bookingId}</p>
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full border bg-[#347048]/5 text-[#347048]/80 border-[#347048]/10">
                            {bookingStatusLabel[booking.status] || booking.status || 'Sin estado'}
                          </span>
                        </div>
                        <p className="text-[11px] font-bold text-[#347048]/70 mt-1">
                          {formatDate(booking.date)}{booking.time ? ` · ${booking.time}` : ''} · {booking.courtName || '-'}
                        </p>
                        <p className="text-[10px] font-black text-[#347048]/45 uppercase tracking-widest mt-1">
                          Monto: ${Number(booking.amount || 0).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-[#347048]/30 font-black py-6 uppercase italic">Sin registros</p>
                )}
              </div>
              <div className="rounded-2xl border border-[#347048]/10 bg-white/80 p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50 mb-2">Historial de cuentas</div>
              {selectedClientHistory.history?.length > 0 ? (
                selectedClientHistory.history
                  .slice()
                  .sort(sortByCreationDesc)
                  .map((account: any) => {
                    const accountStatus = account.accountStatus || account.status;
                    const pStatus = account.paymentStatus;
                    return (
                      <div
                        key={String(account.id)}
                        role="button"
                        onClick={() => openAccountDetail(account)}
                        className="bg-white p-5 rounded-[1.5rem] border border-[#347048]/5 flex justify-between items-center shadow-sm cursor-pointer hover:scale-[1.01] transition-transform"
                      >
                        <div className="flex flex-col gap-2 flex-1">
                          <div className="flex items-center gap-3"><span className="font-black text-[#347048] text-sm italic">{getEntryReference(account)}</span><span className="text-[10px] font-black text-[#347048]/40 uppercase tracking-widest">{formatDate(account.date)} · {account.time}</span></div>
                          <div className="text-xs font-black text-[#347048] uppercase tracking-tight">
                            Cuenta {formatAccountSourceType(account.sourceType)} {account.sourceId ? `#${account.sourceId}` : ''}
                            <span className="opacity-40 ml-2 font-mono">${Number(account.totalAmount || 0).toLocaleString()}</span>
                          </div>
                          {account.bookingId && (
                            <div className="text-[10px] font-bold text-[#347048]/60 uppercase tracking-widest">
                              Reserva #{account.bookingId} · Cancha: {account.courtName || '-'}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2 mt-1">
                            <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${accountStatus === 'OPEN' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>{accountStatusLabel[accountStatus] ?? accountStatus}</span>
                            {account.bookingStatus && (
                              <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border bg-[#347048]/5 text-[#347048]/70 border-[#347048]/10">{bookingStatusLabel[account.bookingStatus] ?? account.bookingStatus}</span>
                            )}
                            {pStatus && (
                              <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${['DEBT', 'PARTIAL'].includes(pStatus) ? 'bg-red-50 text-red-500 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>{paymentStatusLabel[pStatus] ?? pStatus}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right pl-6 border-l border-dashed border-[#347048]/10"><div className="text-xl font-black text-[#347048] italic tracking-tighter">${Number(account.totalAmount || 0).toLocaleString()}</div><div className="text-[9px] font-black text-[#347048]/40 uppercase">{Number(account.amount || 0) > 0 ? `DEBE $${Number(account.amount).toLocaleString()}` : 'SALDADO'}</div></div>
                      </div>
                    );
                })
              ) : <p className="text-center text-[#347048]/30 font-black py-6 uppercase italic">Sin registros</p>}
              </div>
            </div>
            
          </div>
        </div>,
        document.body
      )}

      {/* COMPONENTE MODAL GLOBAL PARA ALERTAS */}
      <AppModal
        show={showAccountDetailModal}
        title="Detalle de la cuenta"
        onClose={() => setShowAccountDetailModal(false)}
        onConfirm={() => setShowAccountDetailModal(false)}
        confirmText="Cerrar"
        cancelText=""
        zIndexClass="z-[2147483500]"
        message={selectedAccountDetail ? (
          <div className="space-y-4 text-sm text-[#347048] max-h-[60vh] overflow-y-auto pr-1 custom-scrollbar">
            <div className="space-y-1">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Referencia</div>
              <div className="text-base font-black text-[#347048]">{getEntryReference(selectedAccountDetail)}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Fecha</div>
                <div className="font-bold">{formatDate(selectedAccountDetail.date)} · {selectedAccountDetail.time || '--:--'}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Origen</div>
                <div className="font-bold">{formatAccountSourceType(selectedAccountDetail.sourceType)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Total</div>
                <div className="font-black text-lg text-[#347048]">${Number(selectedAccountDetail.totalAmount || 0).toLocaleString()}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Pendiente</div>
                <div className={`font-black text-lg ${Number(selectedAccountDetail.amount || 0) > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>
                  ${Number(selectedAccountDetail.amount || 0).toLocaleString()}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-[#347048]/10 bg-white/60 p-3 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Estado</div>
              <div className="flex flex-wrap gap-2">
                <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-md border ${String(selectedAccountDetail.accountStatus || selectedAccountDetail.status) === 'OPEN' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                  {accountStatusLabel[String(selectedAccountDetail.accountStatus || selectedAccountDetail.status)] || String(selectedAccountDetail.accountStatus || selectedAccountDetail.status)}
                </span>
                <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-md border ${['DEBT', 'PARTIAL'].includes(String(selectedAccountDetail.paymentStatus || '')) ? 'bg-red-50 text-red-500 border-red-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                  {paymentStatusLabel[String(selectedAccountDetail.paymentStatus || '')] || String(selectedAccountDetail.paymentStatus || '-')}
                </span>
              </div>
              {selectedAccountDetail.bookingId && (
                <div className="text-xs font-bold text-[#347048]/80">
                  Reserva #{selectedAccountDetail.bookingId} · Cancha: {selectedAccountDetail.courtName || '-'}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-[#347048]/10 bg-white/60 p-3 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">Conceptos de la cuenta</div>
              {loadingAccountDetailById[String(selectedAccountDetail.id)] ? (
                <div className="text-xs font-bold text-[#347048]/60">Cargando detalle...</div>
              ) : selectedAccountBreakdown?.items?.length ? (
                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {selectedAccountBreakdown.items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs border-b border-[#347048]/10 pb-2 last:border-b-0 last:pb-0">
                      <div className="flex flex-col">
                        <span className="font-black text-[#347048]">
                          {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.description}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#347048]/50">
                          Tipo: {formatAccountItemType(item.type)}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="font-black text-[#347048]">${Number(item.total || 0).toLocaleString()}</div>
                        <div className={`text-[10px] font-black uppercase tracking-widest ${item.remaining > EPSILON ? 'text-red-500' : 'text-emerald-600'}`}>
                          {item.remaining > EPSILON ? `Debe $${Number(item.remaining).toLocaleString()}` : 'Saldado'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs font-bold text-[#347048]/60">Sin items registrados en esta cuenta.</div>
              )}
            </div>
          </div>
        ) : null}
      />
      <AppModal
        show={showClientFormModal}
        title={clientToEdit ? 'Editar cliente' : 'Alta de cliente'}
        confirmText={clientFormSubmitting ? 'Guardando...' : (clientToEdit ? 'Guardar cambios' : 'Crear cliente')}
        cancelText="Cancelar"
        confirmDisabled={
          clientFormSubmitting ||
          String(clientForm.name || '').trim().length < 2 ||
          (String(clientForm.phone || '').trim().length > 0 &&
            !buildCanonicalPhone({
              countryIso2: clientForm.phoneCountryIso2 || clubPhoneCountryIso2,
              localNumber: String(clientForm.phone || '').trim()
            })) ||
          (String(clientForm.dni || '').trim().length > 0 && String(clientForm.dni || '').trim().length < 6)
        }
        onClose={() => {
          if (clientFormSubmitting) return;
          setShowClientFormModal(false);
        }}
        onCancel={() => {
          if (clientFormSubmitting) return;
          setShowClientFormModal(false);
        }}
        onConfirm={() => {
          if (clientFormSubmitting) return;
          void submitClientForm();
        }}
        message={(
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Nombre completo</label>
              <input
                type="text"
                value={clientForm.name}
                onChange={(e) => setClientForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                placeholder="Nombre y apellido"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Teléfono</label>
                <div className="flex items-center gap-2">
                  <select
                    value={clientForm.phoneCountryIso2}
                    onChange={(e) => setClientForm((prev) => ({ ...prev, phoneCountryIso2: normalizePhoneCountryIso2(e.target.value) }))}
                    className="h-11 w-28 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-2 text-xs font-black text-[#347048] focus:outline-none shadow-sm transition-all"
                  >
                    {PHONE_COUNTRY_OPTIONS.map((option) => (
                      <option key={option.iso2} value={option.iso2}>
                        {option.callingCode} {option.iso2}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={clientForm.phone}
                    onChange={(e) => setClientForm((prev) => ({ ...prev, phone: e.target.value.replace(/[^\d]/g, '') }))}
                    className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                    placeholder="Número local"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">DNI</label>
                <input
                  type="text"
                  value={clientForm.dni}
                  onChange={(e) => setClientForm((prev) => ({ ...prev, dni: e.target.value }))}
                  className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                  placeholder="Ej: 30111222"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-[#347048]/60 mb-1">Email</label>
              <input
                type="email"
                value={clientForm.email}
                onChange={(e) => setClientForm((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full h-11 bg-white border-2 border-transparent focus:border-[#B9CF32] rounded-xl px-3 text-[#347048] font-bold placeholder-[#347048]/30 focus:outline-none shadow-sm transition-all"
                placeholder="cliente@email.com"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-black text-[#347048]">
              <input
                type="checkbox"
                checked={Boolean(clientForm.isProfessor)}
                onChange={(e) => setClientForm((prev) => ({ ...prev, isProfessor: e.target.checked }))}
                className="h-4 w-4 rounded border-[#347048]/30"
              />
              Es profesor
            </label>
          </div>
        )}
      />

      <AppModal
        show={deleteClientModal.show}
        title="Eliminar cliente"
        isWarning
        confirmText={deleteClientModal.submitting ? 'Eliminando...' : 'Sí, eliminar'}
        cancelText="Cancelar"
        onClose={() => {
          if (deleteClientModal.submitting) return;
          setDeleteClientModal({ show: false, client: null, submitting: false });
        }}
        onCancel={() => {
          if (deleteClientModal.submitting) return;
          setDeleteClientModal({ show: false, client: null, submitting: false });
        }}
        onConfirm={() => {
          if (deleteClientModal.submitting) return;
          void confirmDeleteClient();
        }}
        message={`Vas a eliminar a ${deleteClientModal.client?.name || 'este cliente'}. Esta acción no se puede deshacer.`}
      />
      <AppModal 
        show={modalState.show} 
        onClose={closeModal} 
        onCancel={modalState.onCancel} 
        title={modalState.title} 
        message={modalState.message}
        cancelText={modalState.cancelText} 
        confirmText={modalState.confirmText} 
        isWarning={modalState.isWarning}
        onConfirm={modalState.onConfirm} 
        closeOnBackdrop={modalState.closeOnBackdrop} 
        closeOnEscape={modalState.closeOnEscape} 
      />
    </div>
  );
}
