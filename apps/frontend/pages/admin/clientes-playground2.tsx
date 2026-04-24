import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DollarSign,
  X,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import AdminPlaygroundShell from '../../components/admin/AdminPlaygroundShell';
import NotFound from '../../components/NotFound';
import RouteTransitionScreen from '../../components/RouteTransitionScreen';
import { useValidateAuth } from '../../hooks/useValidateAuth';
import { getPendingLogoutRedirect } from '../../services/AuthService';
import { ClientService } from '../../services/ClientService';
import { ClubAdminService } from '../../services/ClubAdminService';
import { type PaymentChannel, type PaymentMethod, getAccountById, registerPayment } from '../../services/AccountService';
import { formatDateTime24 } from '../../utils/dateTime';
import { getActiveClubSlug, hasAdminAccess, normalizeSessionUser } from '../../utils/session';
import { reportUiError } from '../../utils/uiError';
import {
  buildCanonicalPhone,
  DEFAULT_PHONE_COUNTRY_ISO2,
  normalizePhoneCountryIso2,
  PHONE_COUNTRY_OPTIONS,
  splitCanonicalPhone,
} from '../../utils/phone';

type ClientsView = 'directory' | 'debt' | 'history';
type ClientScope = 'all' | 'debt_open';
type ClientActionSidebarView = 'none' | 'client_create' | 'client_edit' | 'client_profile' | 'client_delete' | 'debt_detail';

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

type ItemSplit = {
  paying: number;
  total: number;
};

type PaymentTransferChannel = Extract<PaymentChannel, 'BANK_ACCOUNT' | 'VIRTUAL_WALLET'>;
type PayConceptView = 'all' | 'booking' | 'consumption' | 'selected';
type PaymentQuickPreset = 'FULL' | 'COURT_ONLY' | 'CUSTOM_ITEMS';
type PaymentModalState =
  | { flow: 'playtomicPayment'; step: 'form' | 'preconfirm' | 'result' }
  | null;
type PlaytomicPaymentResultModal = {
  variant: 'success' | 'partial' | 'error';
  title: string;
  detail: string;
  requestedAmount: number;
  appliedAmount: number;
  remainingAfter: number;
  methodLabel: string;
  appliedItems: Array<{ label: string; amount: number }>;
};

const EPSILON = 0.009;

const formatDate = (dateInput: any) => {
  if (!dateInput) return '-';
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, d] = dateInput.split('-');
    return `${d}/${m}/${y}`;
  }
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatMoney = (value: number) => `$${Number(value || 0).toLocaleString('es-AR')}`;
const roundMoney = (value: number) => Number(Math.max(0, Number(value || 0)).toFixed(2));

const formatRawTypeFallback = (value: string) =>
  String(value || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const formatAccountSourceType = (value: unknown) => {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return '-';
  if (key === 'BOOKING') return 'Reserva';
  if (key === 'BAR') return 'Bar';
  if (key === 'TABLE') return 'Mesa';
  if (key === 'MANUAL') return 'Manual';
  return formatRawTypeFallback(key);
};

const bookingStatusLabel: Record<string, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Completado',
  CANCELLED: 'Cancelado',
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
      amount: Number(entry?.totalAmount || entry?.amount || entry?.price || 0),
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
      remaining,
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
    totalPending,
  };
};

const buildAutoPaymentAllocations = (targetAmount: number, breakdown: PendingAccountBreakdown | null | undefined) => {
  const result: Record<string, number> = {};
  if (!breakdown) return result;

  let remaining = roundMoney(targetAmount);
  const orderedItems = [...(breakdown.bookingPendingItems || []), ...(breakdown.consumptionPendingItems || [])];

  for (const item of orderedItems) {
    if (remaining <= EPSILON) break;
    const allocation = roundMoney(Math.min(Number(item.remaining || 0), remaining));
    result[String(item.id)] = allocation;
    remaining = roundMoney(remaining - allocation);
  }

  return result;
};

const getClientName = (client: any) => String(client?.name || '').trim() || 'Sin nombre';

const buildConsumptionQuickUnits = (quantity: number) => {
  const normalized = Math.max(1, Math.trunc(Number(quantity) || 1));
  if (normalized === 1) return [1];
  if (normalized === 2) return [1, 2];
  return [1, 2, normalized];
};

export default function AdminClientesPlayground2Page() {
  const router = useRouter();
  const { authChecked, user } = useValidateAuth({ requireAdmin: true });

  const [activeView, setActiveView] = useState<ClientsView>('directory');
  const [scope, setScope] = useState<ClientScope>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [selectedClientId, setSelectedClientId] = useState<string>('');

  const [sidebarView, setSidebarView] = useState<ClientActionSidebarView>('none');
  const [editingClientId, setEditingClientId] = useState<string>('');
  const [submittingClient, setSubmittingClient] = useState(false);
  const [clubPhoneCountryIso2, setClubPhoneCountryIso2] = useState(DEFAULT_PHONE_COUNTRY_ISO2);
  const [clientForm, setClientForm] = useState({
    name: '',
    phoneCountryIso2: DEFAULT_PHONE_COUNTRY_ISO2,
    phone: '',
    dni: '',
    email: '',
    isProfessor: false,
  });

  const [deletingClient, setDeletingClient] = useState(false);

  const [paying, setPaying] = useState(false);
  const [debtTargetAccountId, setDebtTargetAccountId] = useState('');
  const [payAmount, setPayAmount] = useState('0');
  const [splitTotalParticipants, setSplitTotalParticipants] = useState(4);
  const [itemSplitById, setItemSplitById] = useState<Record<string, ItemSplit>>({});
  const [payItemAllocations, setPayItemAllocations] = useState<Record<string, number>>({});
  const [payConceptView, setPayConceptView] = useState<PayConceptView>('all');
  const [consumptionSearchTerm, setConsumptionSearchTerm] = useState('');
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH');
  const [transferChannel, setTransferChannel] = useState<PaymentTransferChannel>('BANK_ACCOUNT');
  const [activePaymentModal, setActivePaymentModal] = useState<PaymentModalState>(null);
  const [playtomicResultModal, setPlaytomicResultModal] = useState<PlaytomicPaymentResultModal | null>(null);
  const [simplifiedPaymentMethodDraft, setSimplifiedPaymentMethodDraft] = useState<PaymentMethod>('CASH');
  const [simplifiedPaymentQuickPreset, setSimplifiedPaymentQuickPreset] = useState<PaymentQuickPreset>('FULL');
  const [simplifiedPaymentSelectedItemIdsDraft, setSimplifiedPaymentSelectedItemIdsDraft] = useState<string[]>([]);
  const [simplifiedPaymentAmountDraft, setSimplifiedPaymentAmountDraft] = useState('');
  const [accountBreakdownById, setAccountBreakdownById] = useState<Record<string, PendingAccountBreakdown>>({});
  const [loadingAccountById, setLoadingAccountById] = useState<Record<string, boolean>>({});

  const [selectedClientDiscountAssignments, setSelectedClientDiscountAssignments] = useState<any[]>([]);
  const [loadingDiscountAssignments, setLoadingDiscountAssignments] = useState(false);

  const resolveClubSlug = useCallback(() => {
    try {
      if (typeof window === 'undefined') return '';
      const raw = localStorage.getItem('user');
      if (!raw) return '';
      const normalized = normalizeSessionUser(JSON.parse(raw));
      return getActiveClubSlug(normalized) || '';
    } catch {
      return '';
    }
  }, []);

  useEffect(() => {
    if (!authChecked || user) return;
    if (getPendingLogoutRedirect()) return;
    void router.replace(`/login?from=${encodeURIComponent(router.asPath || '/admin/clientes-playground2')}`);
  }, [authChecked, user, router]);

  useEffect(() => {
    const run = async () => {
      try {
        const slug = resolveClubSlug();
        if (!slug) return;
        const club = await ClubAdminService.getClubInfo(slug);
        const iso = normalizePhoneCountryIso2(club?.country);
        setClubPhoneCountryIso2(iso);
        setClientForm((prev) => ({ ...prev, phoneCountryIso2: prev.phoneCountryIso2 || iso }));
      } catch {
        setClubPhoneCountryIso2(DEFAULT_PHONE_COUNTRY_ISO2);
      }
    };
    void run();
  }, [resolveClubSlug]);

  useEffect(() => {
    if (activeView === 'debt') setScope('debt_open');
    else setScope('all');
  }, [activeView]);

  const loadClients = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage('');
      const slug = resolveClubSlug() || undefined;
      const rows = await ClientService.listDebtors(slug, { scope });
      const normalized = Array.isArray(rows) ? rows : [];
      setClients(normalized);

      if (normalized.length > 0) {
        setSelectedClientId((prev) => {
          if (prev && normalized.some((client) => String(client.id) === prev)) return prev;
          return String(normalized[0].id);
        });
      } else {
        setSelectedClientId('');
      }
      return normalized;
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'loadClients' }, error);
      setErrorMessage(String(error?.message || 'No se pudo cargar la lista de clientes.'));
      return [];
    } finally {
      setLoading(false);
    }
  }, [resolveClubSlug, scope]);

  useEffect(() => {
    if (!authChecked || !user || !hasAdminAccess(user)) return;
    void loadClients();
  }, [authChecked, user, loadClients]);

  const clientsWithOpenDebt = useMemo(
    () => clients.filter((client) => Number(client?.totalDebt || 0) > EPSILON),
    [clients]
  );

  const filteredClients = useMemo(() => {
    const source = activeView === 'debt' ? clientsWithOpenDebt : clients;
    const q = searchTerm.trim().toLowerCase();
    if (!q) return source;
    return source.filter((client) => {
      const name = getClientName(client).toLowerCase();
      const phone = String(client?.phone || '').toLowerCase();
      const dni = String(client?.dni || '').toLowerCase();
      const email = String(client?.email || '').toLowerCase();
      return name.includes(q) || phone.includes(q) || dni.includes(q) || email.includes(q);
    });
  }, [activeView, clients, clientsWithOpenDebt, searchTerm]);

  useEffect(() => {
    if (activeView !== 'debt') return;
    if (filteredClients.length === 0) {
      setSelectedClientId('');
      return;
    }
    const selectedStillValid = filteredClients.some((client) => String(client.id) === String(selectedClientId));
    if (!selectedStillValid) {
      setSelectedClientId(String(filteredClients[0].id));
    }
  }, [activeView, filteredClients, selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => String(client.id) === String(selectedClientId)) || null,
    [clients, selectedClientId]
  );

  const totalClients = clients.length;
  const totalDebt = clients.reduce((sum, client) => sum + Number(client?.totalDebt || 0), 0);
  const topClient = clients.reduce(
    (best, current) => (Number(best?.totalBookings || 0) > Number(current?.totalBookings || 0) ? best : current),
    { name: '-', totalBookings: 0 }
  );

  const openCreateClient = () => {
    setEditingClientId('');
    setClientForm({
      name: '',
      phoneCountryIso2: clubPhoneCountryIso2,
      phone: '',
      dni: '',
      email: '',
      isProfessor: false,
    });
    setSidebarView('client_create');
  };

  const openEditClient = (client: any) => {
    const splitPhone = splitCanonicalPhone(String(client?.phone || ''), clubPhoneCountryIso2);
    setEditingClientId(String(client?.id || ''));
    setClientForm({
      name: getClientName(client),
      phoneCountryIso2: splitPhone.countryIso2 || clubPhoneCountryIso2,
      phone: String(splitPhone.localNumber || ''),
      dni: String(client?.dni && client?.dni !== '-' ? client.dni : ''),
      email: String(client?.email || ''),
      isProfessor: Boolean(client?.isProfessor),
    });
    setSidebarView('client_edit');
  };

  const openClientProfile = (client: any) => {
    setSelectedClientId(String(client?.id || ''));
    setSidebarView('client_profile');
  };

  const openDeleteClient = (client: any) => {
    setSelectedClientId(String(client?.id || ''));
    setSidebarView('client_delete');
  };

  const submitClient = async () => {
    const slug = resolveClubSlug();
    if (!slug) {
      setErrorMessage('No se pudo resolver el club activo.');
      return;
    }

    const name = String(clientForm.name || '').trim();
    const phoneLocal = String(clientForm.phone || '').trim();
    const canonicalPhone = buildCanonicalPhone({
      countryIso2: clientForm.phoneCountryIso2 || clubPhoneCountryIso2,
      localNumber: phoneLocal,
    });
    const dni = String(clientForm.dni || '').trim();
    const email = String(clientForm.email || '').trim();

    if (name.length < 2) {
      setErrorMessage('Ingresa un nombre valido.');
      return;
    }
    if (phoneLocal.length > 0 && !canonicalPhone) {
      setErrorMessage('Si cargas telefono, debe ser valido.');
      return;
    }
    if (dni.length > 0 && dni.length < 6) {
      setErrorMessage('Si cargas DNI, debe tener al menos 6 digitos.');
      return;
    }

    try {
      setSubmittingClient(true);
      setErrorMessage('');
      const payload = {
        name,
        phone: canonicalPhone || undefined,
        phoneCountryCode: clientForm.phoneCountryIso2 || undefined,
        phoneNumberLocal: phoneLocal || undefined,
        dni: dni || undefined,
        email: email || undefined,
        isProfessor: Boolean(clientForm.isProfessor),
      };

      if (editingClientId) {
        await ClientService.updateByClubSlug(slug, editingClientId, payload);
        setSuccessMessage('Cliente actualizado correctamente.');
      } else {
        await ClientService.createByClubSlug(slug, payload);
        setSuccessMessage('Cliente creado correctamente.');
      }

      setSidebarView('none');
      const updated = await loadClients();
      if (editingClientId) {
        const found = updated.find((client: any) => String(client.id) === editingClientId);
        if (found) setSelectedClientId(String(found.id));
      }
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'submitClient' }, error);
      setErrorMessage(String(error?.message || 'No se pudo guardar el cliente.'));
    } finally {
      setSubmittingClient(false);
    }
  };

  const deleteSelectedClient = async () => {
    const slug = resolveClubSlug();
    if (!slug || !selectedClient?.id) {
      setSidebarView('none');
      return;
    }
    try {
      setDeletingClient(true);
      await ClientService.deleteByClubSlug(slug, String(selectedClient.id));
      setSidebarView('none');
      setSuccessMessage('Cliente eliminado correctamente.');
      await loadClients();
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'deleteClient' }, error);
      setErrorMessage(String(error?.message || 'No se pudo eliminar el cliente.'));
    } finally {
      setDeletingClient(false);
    }
  };

  const ensureAccountBreakdown = useCallback(
    async (accountId: string, forceRefresh = false) => {
      const key = String(accountId || '').trim();
      if (!key) return null;
      if (!forceRefresh && accountBreakdownById[key]) return accountBreakdownById[key];
      if (loadingAccountById[key]) return null;

      try {
        setLoadingAccountById((prev) => ({ ...prev, [key]: true }));
        const detail = await getAccountById(key);
        const breakdown = buildPendingBreakdown(detail);
        setAccountBreakdownById((prev) => ({ ...prev, [key]: breakdown }));
        return breakdown;
      } catch (error) {
        reportUiError({ area: 'ClientesPlayground', action: 'ensureAccountBreakdown' }, error);
        return null;
      } finally {
        setLoadingAccountById((prev) => ({ ...prev, [key]: false }));
      }
    },
    [accountBreakdownById, loadingAccountById]
  );

  const selectedDebtorPendingEntries = useMemo(() => {
    if (!selectedClient) return [];
    return (Array.isArray(selectedClient.history) ? selectedClient.history : [])
      .slice()
      .sort(sortByCreationDesc)
      .filter((entry: any) => Number(entry?.amount || 0) > EPSILON);
  }, [selectedClient]);

  const selectedDebtEntry = useMemo(
    () => selectedDebtorPendingEntries.find((entry: any) => String(entry?.id) === String(debtTargetAccountId)) || null,
    [selectedDebtorPendingEntries, debtTargetAccountId]
  );

  const selectedDebtBreakdown = selectedDebtEntry ? accountBreakdownById[String(selectedDebtEntry.id)] : null;

  const selectedDebtTotalPending = useMemo(() => {
    if (selectedDebtBreakdown) return Number(selectedDebtBreakdown.totalPending || 0);
    return Number(selectedDebtEntry?.amount || 0);
  }, [selectedDebtBreakdown, selectedDebtEntry]);

  const openDebtDetail = async (accountId: string) => {
    setDebtTargetAccountId(accountId);
    await ensureAccountBreakdown(accountId, true);
    setSidebarView('debt_detail');
  };

  const openPaySidebar = async (accountId: string) => {
    setDebtTargetAccountId(accountId);
    const breakdown = await ensureAccountBreakdown(accountId, true);
    const fallbackEntry = selectedDebtorPendingEntries.find((entry: any) => String(entry?.id) === String(accountId));
    const total = breakdown ? Number(breakdown.totalPending || 0) : Number(fallbackEntry?.amount || 0);
    const normalizedTotal = roundMoney(Math.max(0, total));
    setPayAmount(String(normalizedTotal.toFixed(2)));
    setSplitTotalParticipants(4);
    setItemSplitById({});
    setPayItemAllocations(buildAutoPaymentAllocations(normalizedTotal, breakdown));
    setPayConceptView('all');
    setConsumptionSearchTerm('');
    setPayMethod('CASH');
    setTransferChannel('BANK_ACCOUNT');
    setSimplifiedPaymentMethodDraft('CASH');
    setSimplifiedPaymentQuickPreset('FULL');
    const allIds = Object.keys(buildAutoPaymentAllocations(normalizedTotal, breakdown));
    setSimplifiedPaymentSelectedItemIdsDraft(allIds);
    setSimplifiedPaymentAmountDraft(String(normalizedTotal.toFixed(2)));
    setSidebarView('none');
    setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' });
  };

  const recalculatePayAmountFromAllocations = (allocations: Record<string, number>) => {
    const total = roundMoney(Object.values(allocations).reduce((sum, value) => sum + Number(value || 0), 0));
    setPayAmount(String(total.toFixed(2)));
  };

  const applyItemSplitAmount = (
    itemId: string,
    itemTotal: number,
    itemRemaining: number,
    payingCount: number,
    totalCount: number = splitTotalParticipants
  ) => {
    const normalizedTotal = Math.max(1, Math.trunc(Number(totalCount) || 1));
    const normalizedPaying = Math.max(1, Math.min(normalizedTotal, Math.trunc(Number(payingCount) || 1)));
    const splitFromOriginalTotal = roundMoney(Math.max(0, Number(itemTotal || 0)) * (normalizedPaying / normalizedTotal));
    const target = roundMoney(Math.min(Math.max(0, Number(itemRemaining || 0)), splitFromOriginalTotal));

    setItemSplitById((prev) => ({
      ...prev,
      [String(itemId)]: {
        paying: normalizedPaying,
        total: normalizedTotal,
      },
    }));

    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: target };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const applyConsumptionUnitsAmount = (
    itemId: string,
    itemRemaining: number,
    itemQuantity: number,
    unitsToCharge: number
  ) => {
    const normalizedQuantity = Math.max(1, Math.trunc(Number(itemQuantity) || 1));
    const normalizedUnits = Math.max(0, Math.min(normalizedQuantity, Math.trunc(Number(unitsToCharge) || 0)));
    const unitAmount = Number(itemRemaining || 0) / normalizedQuantity;
    const target = roundMoney(Math.max(0, unitAmount * normalizedUnits));

    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: target };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const skipItemForNow = (itemId: string) => {
    const totalParticipants = Math.max(1, Math.trunc(Number(splitTotalParticipants) || 1));
    setItemSplitById((prev) => ({
      ...prev,
      [String(itemId)]: {
        paying: 0,
        total: totalParticipants,
      },
    }));
    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: 0 };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const updateItemAllocation = (itemId: string, maxRemaining: number, rawAmount: string) => {
    const parsed = Number(rawAmount || 0);
    const bounded = Number.isFinite(parsed)
      ? roundMoney(Math.min(Math.max(0, parsed), Math.max(0, Number(maxRemaining || 0))))
      : 0;

    setPayItemAllocations((prev) => {
      const next = { ...prev, [String(itemId)]: bounded };
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const applyAllConsumptionAllocations = (mode: 'skip' | 'full') => {
    if (!selectedDebtBreakdown) return;
    const q = consumptionSearchTerm.trim().toLowerCase();
    const targetItems = selectedDebtBreakdown.consumptionPendingItems.filter((item) => {
      if (!q) return true;
      return String(item.description || '').toLowerCase().includes(q);
    });

    setPayItemAllocations((prev) => {
      const next = { ...prev };
      for (const item of targetItems) {
        next[String(item.id)] = mode === 'skip' ? 0 : roundMoney(Number(item.remaining || 0));
      }
      recalculatePayAmountFromAllocations(next);
      return next;
    });
  };

  const toggleConsumptionSelection = (item: PendingAccountItem, checked: boolean) => {
    const target = checked ? roundMoney(Number(item.remaining || 0)) : 0;
    updateItemAllocation(String(item.id), Number(item.remaining || 0), String(target));
  };

  const isItemSkipped = (itemId: string) => roundMoney(Number(payItemAllocations[String(itemId)] || 0)) <= EPSILON;

  const isBookingPresetActive = (itemId: string, payingCount: number) => {
    const split = itemSplitById[String(itemId)];
    if (!split) return false;
    if (payingCount === splitTotalParticipants) {
      return split.total === splitTotalParticipants && split.paying === splitTotalParticipants;
    }
    return split.total === splitTotalParticipants && split.paying === payingCount;
  };

  const isBookingFullActive = (item: PendingAccountItem) => {
    const allocated = roundMoney(Number(payItemAllocations[String(item.id)] || 0));
    return Math.abs(allocated - roundMoney(Number(item.remaining || 0))) <= EPSILON;
  };

  const isConsumptionUnitsPresetActive = (item: PendingAccountItem, units: number) => {
    const allocated = roundMoney(Number(payItemAllocations[String(item.id)] || 0));
    const normalizedQuantity = Math.max(1, Math.trunc(Number(item.quantity) || 1));
    const normalizedUnits = Math.max(0, Math.min(normalizedQuantity, Math.trunc(Number(units) || 0)));
    const expected = roundMoney(Number(item.remaining || 0) * (normalizedUnits / normalizedQuantity));
    return Math.abs(allocated - expected) <= EPSILON;
  };

  const processDebtPayment = async () => {
    if (!selectedDebtEntry) return;

    try {
      const amount = Number(payAmount || 0);
      if (!Number.isFinite(amount) || amount <= EPSILON) {
        setErrorMessage('Ingresa un monto de cobro valido.');
        return;
      }

      const debtTotal = Math.max(0, Number(selectedDebtTotalPending || 0));
      if (amount - debtTotal > EPSILON) {
        setErrorMessage('El monto no puede superar el saldo pendiente.');
        return;
      }

      if (payMethod === 'TRANSFER' && !transferChannel) {
        setErrorMessage('Selecciona el canal para la transferencia.');
        return;
      }

      setPaying(true);
      setErrorMessage('');
      const breakdown = accountBreakdownById[String(selectedDebtEntry.id)];
      const allocations: Array<{ accountItemId: string; amount: number }> = [];
      if (breakdown) {
        const allPendingItems = [...breakdown.bookingPendingItems, ...breakdown.consumptionPendingItems];
        const zeroAllocationItems = allPendingItems.filter(
          (item) => Number(item.remaining || 0) > EPSILON && roundMoney(Number(payItemAllocations[String(item.id)] || 0)) <= EPSILON
        );

        if (zeroAllocationItems.length > 0) {
          const confirmSkip = window.confirm(
            `Hay ${zeroAllocationItems.length} concepto(s) pendiente(s) marcado(s) en $0 para esta operacion. ¿Confirmas continuar?`
          );
          if (!confirmSkip) {
            return;
          }
        }

        for (const item of allPendingItems) {
          const requested = roundMoney(Number(payItemAllocations[String(item.id)] || 0));
          const allocationAmount = roundMoney(Math.min(Number(item.remaining || 0), requested));
          if (allocationAmount > EPSILON) {
            allocations.push({
              accountItemId: String(item.id),
              amount: allocationAmount,
            });
          }
        }

        const allocatedTotal = roundMoney(allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        if (Math.abs(allocatedTotal - Number(amount.toFixed(2))) > EPSILON) {
          setErrorMessage('La suma por concepto debe coincidir con el monto final a cobrar.');
          setPaying(false);
          return;
        }
      } else {
        let remainingToAllocate = Number(amount.toFixed(2));
        for (const item of breakdown?.bookingPendingItems || []) {
          if (remainingToAllocate <= EPSILON) break;
          const allocationAmount = Math.min(item.remaining, remainingToAllocate);
          if (allocationAmount > EPSILON) {
            allocations.push({
              accountItemId: String(item.id),
              amount: Number(allocationAmount.toFixed(2)),
            });
            remainingToAllocate = Number((remainingToAllocate - allocationAmount).toFixed(2));
          }
        }

        for (const item of breakdown?.consumptionPendingItems || []) {
          if (remainingToAllocate <= EPSILON) break;
          const allocationAmount = Math.min(item.remaining, remainingToAllocate);
          if (allocationAmount > EPSILON) {
            allocations.push({
              accountItemId: String(item.id),
              amount: Number(allocationAmount.toFixed(2)),
            });
            remainingToAllocate = Number((remainingToAllocate - allocationAmount).toFixed(2));
          }
        }
      }

      await registerPayment({
        accountId: String(selectedDebtEntry.id),
        amount: Number(amount.toFixed(2)),
        method: payMethod,
        channel: payMethod === 'TRANSFER' ? transferChannel : undefined,
        allocations: allocations.length > 0 ? allocations : undefined,
      });

      setActivePaymentModal(null);
      setPlaytomicResultModal(null);
      setSidebarView('none');
      setDebtTargetAccountId('');
      setPayAmount('0');
      setItemSplitById({});
      setPayItemAllocations({});
      setSuccessMessage('Pago registrado correctamente.');
      const updated = await loadClients();
      const stillExists = updated.find((client: any) => String(client.id) === String(selectedClientId));
      if (!stillExists && updated.length > 0) setSelectedClientId(String(updated[0].id));

      setAccountBreakdownById((prev) => {
        const next = { ...prev };
        delete next[String(selectedDebtEntry.id)];
        return next;
      });
    } catch (error: any) {
      reportUiError({ area: 'ClientesPlayground', action: 'processDebtPayment' }, error);
      setErrorMessage(String(error?.message || 'No se pudo registrar el pago.'));
    } finally {
      setPaying(false);
    }
  };

  const payAllocationsPreview = useMemo(() => {
    if (!selectedDebtBreakdown) {
      return { booking: 0, consumption: 0, unallocated: 0 };
    }
    const booking = roundMoney(
      selectedDebtBreakdown.bookingPendingItems.reduce(
        (sum, item) => sum + Number(payItemAllocations[String(item.id)] || 0),
        0
      )
    );
    const consumption = roundMoney(
      selectedDebtBreakdown.consumptionPendingItems.reduce(
        (sum, item) => sum + Number(payItemAllocations[String(item.id)] || 0),
        0
      )
    );
    const selectedTotal = roundMoney(booking + consumption);
    const unallocated = roundMoney(Math.max(0, Number(selectedDebtTotalPending || 0) - selectedTotal));
    return { booking, consumption, unallocated };
  }, [payItemAllocations, selectedDebtBreakdown, selectedDebtTotalPending]);

  const currentPayAmount = roundMoney(Number(payAmount || 0));

  const filteredConsumptionItems = useMemo(() => {
    const base = selectedDebtBreakdown?.consumptionPendingItems || [];
    const q = consumptionSearchTerm.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => String(item.description || '').toLowerCase().includes(q));
  }, [selectedDebtBreakdown, consumptionSearchTerm]);

  const payItemsForList = useMemo(() => {
    if (!selectedDebtBreakdown) return [] as PendingAccountItem[];
    const bookingItems = selectedDebtBreakdown.bookingPendingItems;
    const consumptionItems = filteredConsumptionItems;
    if (payConceptView === 'booking') return bookingItems;
    if (payConceptView === 'consumption') return consumptionItems;
    if (payConceptView === 'selected') {
      return [...bookingItems, ...consumptionItems].filter(
        (item) => roundMoney(Number(payItemAllocations[String(item.id)] || 0)) > EPSILON
      );
    }
    return [...bookingItems, ...consumptionItems];
  }, [selectedDebtBreakdown, filteredConsumptionItems, payConceptView, payItemAllocations]);

  const bookingItemsForList = useMemo(
    () => payItemsForList.filter((item) => item.type === 'BOOKING'),
    [payItemsForList]
  );

  const consumptionItemsForList = useMemo(
    () => payItemsForList.filter((item) => item.type !== 'BOOKING'),
    [payItemsForList]
  );

  const isPlaytomicPaymentModal = true;
  const pendingAccountItems = useMemo(
    () =>
      selectedDebtBreakdown
        ? [...selectedDebtBreakdown.bookingPendingItems, ...selectedDebtBreakdown.consumptionPendingItems].map((item) => ({
            id: String(item.id),
            type: item.type,
            description: item.description,
            remainingAmount: Number(item.remaining || 0),
          }))
        : [],
    [selectedDebtBreakdown]
  );
  const isFinancialDisplayPending = Boolean(debtTargetAccountId && loadingAccountById[String(debtTargetAccountId)]) || !selectedDebtEntry;
  const simplifiedFinancialTotal = Number(selectedDebtBreakdown?.total || selectedDebtEntry?.amount || 0);
  const simplifiedPaidAmount = Number(selectedDebtBreakdown?.paid || 0);
  const simplifiedRemainingAmount = Number(selectedDebtTotalPending || 0);
  const ownerPaymentMethodOptions = [
    { value: 'CASH', label: 'Efectivo' },
    { value: 'TRANSFER', label: 'Transferencia' },
    { value: 'CARD', label: 'Tarjeta' },
  ] as const;
  const simplifiedPaymentMethodLabel =
    ownerPaymentMethodOptions.find((option) => option.value === simplifiedPaymentMethodDraft)?.label || 'Efectivo';

  const resolvePresetItemIds = useCallback(
    (preset: PaymentQuickPreset) => {
      if (!selectedDebtBreakdown) return [] as string[];
      if (preset === 'COURT_ONLY') return selectedDebtBreakdown.bookingPendingItems.map((item) => String(item.id));
      return [...selectedDebtBreakdown.bookingPendingItems, ...selectedDebtBreakdown.consumptionPendingItems].map((item) => String(item.id));
    },
    [selectedDebtBreakdown]
  );

  const computeConceptBasedMaxAmount = useCallback(
    (preset: PaymentQuickPreset, selectedIds?: string[]) => {
      const allowedIds =
        preset === 'CUSTOM_ITEMS'
          ? new Set((selectedIds || []).map((value) => String(value || '').trim()).filter(Boolean))
          : new Set(resolvePresetItemIds(preset));
      return Number(
        pendingAccountItems
          .filter((item) => allowedIds.has(String(item.id)))
          .reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0)
          .toFixed(2)
      );
    },
    [pendingAccountItems, resolvePresetItemIds]
  );

  const applySimplifiedPaymentQuickPreset = useCallback(
    (preset: PaymentQuickPreset) => {
      setSimplifiedPaymentQuickPreset(preset);
      const nextIds = preset === 'CUSTOM_ITEMS' ? simplifiedPaymentSelectedItemIdsDraft : resolvePresetItemIds(preset);
      if (preset !== 'CUSTOM_ITEMS') {
        setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
      }
      setSimplifiedPaymentAmountDraft(String(computeConceptBasedMaxAmount(preset, nextIds).toFixed(2)));
    },
    [computeConceptBasedMaxAmount, resolvePresetItemIds, simplifiedPaymentSelectedItemIdsDraft]
  );

  const simplifiedPaymentConceptDebt = useMemo(
    () => computeConceptBasedMaxAmount(simplifiedPaymentQuickPreset, simplifiedPaymentSelectedItemIdsDraft),
    [computeConceptBasedMaxAmount, simplifiedPaymentQuickPreset, simplifiedPaymentSelectedItemIdsDraft]
  );
  const simplifiedPaymentMaxAmount = simplifiedPaymentConceptDebt;
  const simplifiedPaymentAmountNumber = Number(simplifiedPaymentAmountDraft || 0);
  const hasValidSimplifiedPaymentMethod = Boolean(simplifiedPaymentMethodDraft);
  const hasValidSimplifiedPaymentAmount =
    Number.isFinite(simplifiedPaymentAmountNumber) &&
    simplifiedPaymentAmountNumber > EPSILON &&
    simplifiedPaymentAmountNumber <= simplifiedPaymentMaxAmount + EPSILON;

  const playtomicPreviewRequestedAmount = Number(Math.max(0, simplifiedPaymentAmountNumber).toFixed(2));
  const previewRows = useMemo(() => {
    const selectedIds =
      simplifiedPaymentQuickPreset === 'CUSTOM_ITEMS'
        ? simplifiedPaymentSelectedItemIdsDraft
        : resolvePresetItemIds(simplifiedPaymentQuickPreset);
    const selectedSet = new Set(selectedIds.map((value) => String(value || '').trim()).filter(Boolean));
    let remaining = playtomicPreviewRequestedAmount;
    const rows: Array<{ id: string; label: string; amount: number }> = [];
    for (const item of pendingAccountItems) {
      if (!selectedSet.has(String(item.id))) continue;
      if (remaining <= EPSILON) break;
      const amount = Number(Math.min(Number(item.remainingAmount || 0), remaining).toFixed(2));
      if (amount <= EPSILON) continue;
      rows.push({ id: String(item.id), label: item.type === 'BOOKING' ? 'Cancha' : item.description, amount });
      remaining = Number((remaining - amount).toFixed(2));
    }
    return rows;
  }, [pendingAccountItems, playtomicPreviewRequestedAmount, resolvePresetItemIds, simplifiedPaymentQuickPreset, simplifiedPaymentSelectedItemIdsDraft]);
  const playtomicPreviewConceptRows = previewRows;
  const playtomicPreviewRemainingAfter = Number(Math.max(0, simplifiedRemainingAmount - playtomicPreviewRequestedAmount).toFixed(2));

  const queueSimplifiedPaymentFromModal = useCallback(
    async (options?: { skipPlaytomicPreconfirm?: boolean }) => {
      if (!selectedDebtEntry) return;
      if (!options?.skipPlaytomicPreconfirm) {
        setActivePaymentModal({ flow: 'playtomicPayment', step: 'preconfirm' });
        return;
      }
      try {
        setPaying(true);
        setErrorMessage('');
        const selectedIds =
          simplifiedPaymentQuickPreset === 'CUSTOM_ITEMS'
            ? simplifiedPaymentSelectedItemIdsDraft
            : resolvePresetItemIds(simplifiedPaymentQuickPreset);
        const selectedSet = new Set(selectedIds.map((value) => String(value || '').trim()).filter(Boolean));
        let remaining = Number(Math.max(0, simplifiedPaymentAmountNumber).toFixed(2));
        const allocations: Array<{ accountItemId: string; amount: number }> = [];
        const appliedItems: Array<{ label: string; amount: number }> = [];
        for (const item of pendingAccountItems) {
          if (!selectedSet.has(String(item.id))) continue;
          if (remaining <= EPSILON) break;
          const amount = Number(Math.min(Number(item.remainingAmount || 0), remaining).toFixed(2));
          if (amount <= EPSILON) continue;
          allocations.push({ accountItemId: String(item.id), amount });
          appliedItems.push({ label: item.type === 'BOOKING' ? 'Cancha' : item.description, amount });
          remaining = Number((remaining - amount).toFixed(2));
        }
        const appliedAmount = Number(allocations.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2));
        if (appliedAmount <= EPSILON) {
          setPlaytomicResultModal({
            variant: 'error',
            title: 'No se pudo registrar el cobro',
            detail: 'No hay conceptos seleccionados para aplicar el pago.',
            requestedAmount: playtomicPreviewRequestedAmount,
            appliedAmount: 0,
            remainingAfter: simplifiedRemainingAmount,
            methodLabel: simplifiedPaymentMethodLabel,
            appliedItems: [],
          });
          setActivePaymentModal({ flow: 'playtomicPayment', step: 'result' });
          return;
        }

        await registerPayment({
          accountId: String(selectedDebtEntry.id),
          amount: appliedAmount,
          method: simplifiedPaymentMethodDraft,
          channel: simplifiedPaymentMethodDraft === 'TRANSFER' ? transferChannel : undefined,
          allocations,
        });

        const updated = await loadClients();
        const stillExists = updated.find((client: any) => String(client.id) === String(selectedClientId));
        if (!stillExists && updated.length > 0) setSelectedClientId(String(updated[0].id));
        setAccountBreakdownById((prev) => {
          const next = { ...prev };
          delete next[String(selectedDebtEntry.id)];
          return next;
        });
        const remainingAfter = Number(Math.max(0, simplifiedRemainingAmount - appliedAmount).toFixed(2));
        setPlaytomicResultModal({
          variant: appliedAmount + EPSILON < playtomicPreviewRequestedAmount ? 'partial' : 'success',
          title: appliedAmount + EPSILON < playtomicPreviewRequestedAmount ? 'Cobro parcial aplicado' : 'Cobro registrado',
          detail: appliedAmount + EPSILON < playtomicPreviewRequestedAmount
            ? 'Se aplicó parcialmente por límite de conceptos seleccionados.'
            : 'El cobro se registró correctamente.',
          requestedAmount: playtomicPreviewRequestedAmount,
          appliedAmount,
          remainingAfter,
          methodLabel: simplifiedPaymentMethodLabel,
          appliedItems,
        });
        setActivePaymentModal({ flow: 'playtomicPayment', step: 'result' });
        setSuccessMessage('Pago registrado correctamente.');
      } catch (error: any) {
        reportUiError({ area: 'ClientesPlayground', action: 'queueSimplifiedPaymentFromModal' }, error);
        setPlaytomicResultModal({
          variant: 'error',
          title: 'No se pudo registrar el cobro',
          detail: String(error?.message || 'Ocurrió un error al registrar el pago.'),
          requestedAmount: playtomicPreviewRequestedAmount,
          appliedAmount: 0,
          remainingAfter: simplifiedRemainingAmount,
          methodLabel: simplifiedPaymentMethodLabel,
          appliedItems: [],
        });
        setActivePaymentModal({ flow: 'playtomicPayment', step: 'result' });
      } finally {
        setPaying(false);
      }
    },
    [
      loadClients,
      pendingAccountItems,
      playtomicPreviewRequestedAmount,
      resolvePresetItemIds,
      selectedClientId,
      selectedDebtEntry,
      simplifiedPaymentAmountNumber,
      simplifiedPaymentMethodDraft,
      simplifiedPaymentMethodLabel,
      simplifiedPaymentQuickPreset,
      simplifiedPaymentSelectedItemIdsDraft,
      simplifiedRemainingAmount,
      transferChannel,
    ]
  );

  const sidebarOpen = sidebarView !== 'none';
  const isClientFormView = sidebarView === 'client_create' || sidebarView === 'client_edit';
  const isDebtDetailView = sidebarView === 'debt_detail';
  const isDebtView = isDebtDetailView;
  const debtLoading = Boolean(debtTargetAccountId && loadingAccountById[String(debtTargetAccountId)]);

  const closeActionSidebar = useCallback(() => {
    if (deletingClient || paying || submittingClient) return;
    setSidebarView('none');
    setDebtTargetAccountId('');
    setPayItemAllocations({});
  }, [deletingClient, paying, submittingClient]);

  const closeSimplifiedPaymentModal = useCallback(() => {
    if (paying) return;
    setActivePaymentModal(null);
    setPlaytomicResultModal(null);
    setSimplifiedPaymentMethodDraft('CASH');
    setSimplifiedPaymentQuickPreset('FULL');
    setSimplifiedPaymentSelectedItemIdsDraft([]);
    setSimplifiedPaymentAmountDraft('');
  }, [paying]);

  const modalBackdropPointerDownTargetRef = useRef<EventTarget | null>(null);
  const handleModalBackdropPointerDown = useCallback((event: any) => {
    modalBackdropPointerDownTargetRef.current = event.target;
  }, []);
  const handleModalBackdropPointerUp = useCallback((event: any, onClose: () => void) => {
    const startedOnBackdrop = modalBackdropPointerDownTargetRef.current === event.currentTarget;
    const endedOnBackdrop = event.target === event.currentTarget;
    modalBackdropPointerDownTargetRef.current = null;
    if (startedOnBackdrop && endedOnBackdrop) {
      onClose();
    }
  }, []);


  useEffect(() => {
    if (!sidebarOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeActionSidebar();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [sidebarOpen, closeActionSidebar]);

  useEffect(() => {
    if (!activePaymentModal) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeSimplifiedPaymentModal();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [activePaymentModal, closeSimplifiedPaymentModal]);


  useEffect(() => {
    const run = async () => {
      if (!selectedClient?.id) {
        setSelectedClientDiscountAssignments([]);
        return;
      }
      if (activeView !== 'history') return;
      const slug = resolveClubSlug();
      if (!slug) return;
      try {
        setLoadingDiscountAssignments(true);
        const rows = await ClubAdminService.listClientDiscountAssignments(slug, String(selectedClient.id));
        setSelectedClientDiscountAssignments(Array.isArray(rows) ? rows : []);
      } catch {
        setSelectedClientDiscountAssignments([]);
      } finally {
        setLoadingDiscountAssignments(false);
      }
    };
    void run();
  }, [activeView, selectedClient?.id, resolveClubSlug]);

  const historyBookings = useMemo(() => (selectedClient ? buildClientBookingHistory(selectedClient) : []), [selectedClient]);
  const historyAccounts = useMemo(
    () => (selectedClient?.history || []).slice().sort(sortByCreationDesc),
    [selectedClient]
  );

  if (!authChecked || !user) {
    return <RouteTransitionScreen message={authChecked ? 'Redirigiendo...' : 'Validando acceso...'} />;
  }

  if (!hasAdminAccess(user)) {
    return <NotFound message="No tenes permiso para acceder al panel de administracion." />;
  }

  return (
    <>
      <Head>
        <title>Clientes Playground 2 | TuCancha Admin</title>
      </Head>

      <AdminPlaygroundShell activeItem="Clientes" user={user} contentMuted={sidebarOpen}>
        <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
              <header className="rounded-xl border border-[#dce2ee] bg-white px-4 py-3 shadow-[0_8px_26px_rgba(34,42,68,0.05)]">
                <div className="flex flex-wrap items-center gap-3 md:gap-4">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#3053e2] text-white shadow-[0_10px_24px_rgba(48,83,226,0.24)]">
                    <Users size={18} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <h1 className="truncate text-base font-semibold text-[#1f2638]">Clientes Playground</h1>
                    <p className="text-[12px] text-[#6f7890]">Estructura nueva sin dependencia de la UI legacy, con funcionalidades existentes.</p>
                  </div>

                  <div className="flex items-center gap-1 rounded-xl border border-[#dce2ee] bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setActiveView('directory')}
                      className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                        activeView === 'directory' ? 'bg-[#edf1ff] text-[#3053e2]' : 'text-[#6f7890] hover:bg-[#f8f9fd]'
                      }`}
                    >
                      Directorio
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('debt')}
                      className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                        activeView === 'debt' ? 'bg-[#edf1ff] text-[#3053e2]' : 'text-[#6f7890] hover:bg-[#f8f9fd]'
                      }`}
                    >
                      Cuentas y deuda
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveView('history')}
                      className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition ${
                        activeView === 'history' ? 'bg-[#edf1ff] text-[#3053e2]' : 'text-[#6f7890] hover:bg-[#f8f9fd]'
                      }`}
                    >
                      Perfil e historial
                    </button>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                <article className="rounded-xl border border-[#dce2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Total clientes</p>
                  <p className="mt-2 text-lg font-semibold text-[#1f2638]">{totalClients}</p>
                </article>
                <article className="rounded-xl border border-[#dce2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Cliente mas fiel</p>
                  <p className="mt-2 truncate text-lg font-semibold text-[#1f2638]">{getClientName(topClient)}</p>
                </article>
                <article className="rounded-xl border border-[#dce2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Deuda total</p>
                  <p className={`mt-2 text-lg font-semibold ${totalDebt > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatMoney(totalDebt)}</p>
                </article>
                <article className="rounded-xl border border-[#dce2ee] bg-white p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Alcance</p>
                  <div className="mt-2 inline-flex rounded-xl border border-[#dce2ee] bg-white p-1">
                    <button
                      type="button"
                      onClick={() => setScope('all')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                        scope === 'all' ? 'bg-[#edf1ff] text-[#3053e2]' : 'text-[#6f7890] hover:bg-[#f8f9fd]'
                      }`}
                    >
                      Todos
                    </button>
                    <button
                      type="button"
                      onClick={() => setScope('debt_open')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                        scope === 'debt_open' ? 'bg-[#edf1ff] text-[#3053e2]' : 'text-[#6f7890] hover:bg-[#f8f9fd]'
                      }`}
                    >
                      Con deuda
                    </button>
                  </div>
                </article>
              </div>

              {(errorMessage || successMessage) && (
                <div className="space-y-2">
                  {successMessage && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">{successMessage}</div>}
                  {errorMessage && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">{errorMessage}</div>}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-auto">
                {activeView === 'directory' && (
                  <div className="grid min-h-full grid-cols-1 gap-4">
                    <article className="rounded-xl border border-[#dce2ee] bg-white p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <label className="relative w-full max-w-[320px]">
                          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8b93a5]" />
                          <input
                            type="text"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Buscar por nombre, dni, email o telefono"
                            className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white pl-9 pr-3 text-[13px] outline-none focus:border-[#3053e2]"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={openCreateClient}
                          className="h-10 rounded-xl bg-[#3053e2] px-3 text-[13px] font-semibold text-white transition hover:bg-[#2748cc]"
                        >
                          <span className="inline-flex items-center gap-1"><Plus size={14} /> Nuevo cliente</span>
                        </button>
                      </div>

                      <div className="max-h-[66vh] overflow-auto rounded-xl border border-[#dce2ee]">
                        {loading ? (
                          <div className="p-8 text-center text-[13px] text-[#6f7890]">Cargando clientes...</div>
                        ) : filteredClients.length === 0 ? (
                          <div className="p-8 text-center text-[13px] text-[#6f7890]">No hay clientes para mostrar.</div>
                        ) : (
                          <table className="w-full min-w-[760px] text-[13px]">
                            <thead className="sticky top-0 bg-[#f8f9fd] text-[12px] uppercase tracking-wide text-[#6f7890]">
                              <tr>
                                <th className="px-3 py-2 text-left">Cliente</th>
                                <th className="px-3 py-2 text-left">DNI</th>
                                <th className="px-3 py-2 text-left">Contacto</th>
                                <th className="px-3 py-2 text-left">Reservas</th>
                                <th className="px-3 py-2 text-left">Deuda</th>
                                <th className="px-3 py-2 text-right">Acciones</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredClients.map((client) => (
                                <tr key={String(client.id)} className="border-t border-[#edf0f6] hover:bg-[#f4f6fb]">
                                  <td className="px-3 py-2 font-semibold text-[#1f2638]">{getClientName(client)}</td>
                                  <td className="px-3 py-2 text-[#4e5870]">{String(client.dni || '-')}</td>
                                  <td className="px-3 py-2 text-[#4e5870]">{String(client.phone || client.email || '-')}</td>
                                  <td className="px-3 py-2 text-[#4e5870]">{Number(client.totalBookings || 0)}</td>
                                  <td className={`px-3 py-2 font-semibold ${Number(client.totalDebt || 0) > EPSILON ? 'text-red-700' : 'text-[#6f7890]'}`}>
                                    {Number(client.totalDebt || 0) > EPSILON ? formatMoney(Number(client.totalDebt || 0)) : 'Sin deuda'}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => openClientProfile(client)}
                                        className="h-8 rounded-lg border border-[#dce2ee] bg-white px-2 text-[11px] font-semibold text-[#4e5870] hover:bg-[#f8f9fd]"
                                      >
                                        Perfil
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openEditClient(client)}
                                        className="grid h-8 w-8 place-items-center rounded-lg border border-[#dce2ee] bg-white text-[#4e5870] hover:bg-[#f8f9fd]"
                                        title="Editar"
                                      >
                                        <Pencil size={13} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openDeleteClient(client)}
                                        className="grid h-8 w-8 place-items-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                        title="Eliminar"
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </article>
                  </div>
                )}

                {activeView === 'debt' && (
                  <div className="grid min-h-full grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
                    <article className="rounded-xl border border-[#dce2ee] bg-white p-4">
                      <h2 className="text-[13px] font-semibold text-[#1f2638]">Clientes con deuda</h2>
                      <p className="mt-1 text-[12px] text-[#6f7890]">Selecciona un cliente para revisar cuentas pendientes.</p>

                      <div className="mt-3 max-h-[66vh] overflow-auto rounded-xl border border-[#dce2ee]">
                        {loading ? (
                          <div className="p-6 text-center text-[13px] text-[#6f7890]">Cargando...</div>
                        ) : filteredClients.length === 0 ? (
                          <div className="p-6 text-center text-[13px] text-[#6f7890]">No hay clientes con deuda.</div>
                        ) : (
                          <ul className="divide-y divide-[#eef2f7]">
                            {filteredClients.map((client) => (
                              <li key={String(client.id)}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedClientId(String(client.id))}
                                  className={`w-full px-3 py-3 text-left transition ${
                                    String(selectedClientId) === String(client.id) ? 'bg-[#edf1ff]' : 'hover:bg-[#f8f9fd]'
                                  }`}
                                >
                                  <p className="text-[13px] font-semibold text-[#1f2638]">{getClientName(client)}</p>
                                  <p className="text-[12px] text-red-700">Pendiente: {formatMoney(Number(client.totalDebt || 0))}</p>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>

                    <article className="rounded-xl border border-[#dce2ee] bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-[13px] font-semibold text-[#1f2638]">Cuentas pendientes</h2>
                        <span className="text-[12px] text-[#6f7890]">{selectedClient ? getClientName(selectedClient) : 'Sin seleccion'}</span>
                      </div>

                      {!selectedClient ? (
                        <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Selecciona un cliente para ver su deuda.</div>
                      ) : selectedDebtorPendingEntries.length === 0 ? (
                        <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Este cliente no tiene cuentas pendientes.</div>
                      ) : (
                        <div className="space-y-3 max-h-[66vh] overflow-auto">
                          {selectedDebtorPendingEntries.map((account: any) => (
                            <div key={String(account.id)} className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-[13px] font-semibold text-[#1f2638]">Cuenta {formatAccountSourceType(account.sourceType)} #{String(account.id)}</p>
                                  <p className="text-[12px] text-[#6f7890]">{formatDate(account.date)} {account.time ? `· ${account.time}` : ''}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[12px] text-[#6f7890]">Pendiente</p>
                                  <p className="text-[13px] font-semibold text-red-700">{formatMoney(Number(account.amount || 0))}</p>
                                </div>
                              </div>
                              <div className="mt-2 flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => void openDebtDetail(String(account.id))}
                                  className="h-8 rounded-lg border border-[#dce2ee] bg-white px-2.5 text-[12px] font-semibold text-[#4e5870] hover:bg-[#f8f9fd]"
                                >
                                  Ver detalle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openPaySidebar(String(account.id))}
                                  className="h-8 rounded-lg bg-[#3053e2] px-2.5 text-[12px] font-semibold text-white hover:bg-[#2748cc]"
                                >
                                  <span className="inline-flex items-center gap-1"><DollarSign size={13} /> Cobrar</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  </div>
                )}

                {activeView === 'history' && (
                  <div className="grid min-h-full grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
                    <article className="rounded-xl border border-[#dce2ee] bg-white p-4">
                      <h2 className="text-[13px] font-semibold text-[#1f2638]">Clientes</h2>
                      <div className="mt-2 max-h-[66vh] overflow-auto rounded-xl border border-[#dce2ee]">
                        {loading ? (
                          <div className="p-6 text-center text-[13px] text-[#6f7890]">Cargando...</div>
                        ) : filteredClients.length === 0 ? (
                          <div className="p-6 text-center text-[13px] text-[#6f7890]">Sin clientes.</div>
                        ) : (
                          <ul className="divide-y divide-[#eef2f7]">
                            {filteredClients.map((client) => (
                              <li key={String(client.id)}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedClientId(String(client.id))}
                                  className={`w-full px-3 py-3 text-left transition ${
                                    String(selectedClientId) === String(client.id) ? 'bg-[#edf1ff]' : 'hover:bg-[#f8f9fd]'
                                  }`}
                                >
                                  <p className="text-[13px] font-semibold text-[#1f2638]">{getClientName(client)}</p>
                                  <p className="text-[12px] text-[#6f7890]">{String(client.phone || client.email || '-')}</p>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </article>

                    <article className="rounded-xl border border-[#dce2ee] bg-white p-4">
                      {!selectedClient ? (
                        <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Selecciona un cliente para ver su perfil.</div>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Cliente</p>
                              <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{getClientName(selectedClient)}</p>
                            </div>
                            <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">DNI</p>
                              <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{String(selectedClient.dni || '-')}</p>
                            </div>
                            <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Telefono</p>
                              <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{String(selectedClient.phone || '-')}</p>
                            </div>
                            <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Email</p>
                              <p className="mt-1 text-[13px] font-semibold text-[#1f2638] break-all">{String(selectedClient.email || '-')}</p>
                            </div>
                            <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Total reservas</p>
                              <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{Number(selectedClient.totalBookings || 0)}</p>
                            </div>
                            <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                              <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Saldo actual</p>
                              <p className={`mt-1 text-[13px] font-semibold ${Number(selectedClient.totalDebt || 0) > EPSILON ? 'text-red-700' : 'text-[#6f7890]'}`}>
                                {Number(selectedClient.totalDebt || 0) > EPSILON ? formatMoney(Number(selectedClient.totalDebt || 0)) : 'Sin deuda'}
                              </p>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[#dce2ee] p-3">
                            <h3 className="text-[13px] font-semibold text-[#1f2638]">Asignaciones de descuentos</h3>
                            {loadingDiscountAssignments ? (
                              <p className="mt-2 text-[12px] text-[#6f7890]">Cargando asignaciones...</p>
                            ) : selectedClientDiscountAssignments.length === 0 ? (
                              <p className="mt-2 text-[12px] text-[#6f7890]">Sin asignaciones registradas.</p>
                            ) : (
                              <ul className="mt-2 space-y-1">
                                {selectedClientDiscountAssignments.map((assignment: any, index: number) => (
                                  <li key={String(assignment?.id || `${index}`)} className="rounded-lg border border-[#dce2ee] bg-[#f8f9fd] px-2 py-1.5 text-[12px] text-[#4e5870]">
                                    {String(assignment?.policy?.name || assignment?.policyName || assignment?.policyId || 'Politica')}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                            <div className="rounded-xl border border-[#dce2ee] p-3">
                              <h3 className="text-[13px] font-semibold text-[#1f2638]">Historial de reservas</h3>
                              <div className="mt-2 max-h-[280px] overflow-auto">
                                {historyBookings.length === 0 ? (
                                  <p className="text-[12px] text-[#6f7890]">Sin reservas registradas.</p>
                                ) : (
                                  <ul className="space-y-2">
                                    {historyBookings.map((booking: any) => (
                                      <li key={String(booking.bookingId)} className="rounded-lg border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2">
                                        <p className="text-[12px] font-semibold text-[#1f2638]">Reserva #{booking.bookingId}</p>
                                        <p className="text-[12px] text-[#6f7890]">{formatDate(booking.date)}{booking.time ? ` · ${booking.time}` : ''} · {booking.courtName || '-'}</p>
                                        <p className="text-[12px] text-[#4e5870]">{bookingStatusLabel[booking.status] || booking.status || 'Sin estado'} · {formatMoney(Number(booking.amount || 0))}</p>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>

                            <div className="rounded-xl border border-[#dce2ee] p-3">
                              <h3 className="text-[13px] font-semibold text-[#1f2638]">Historial de cuentas</h3>
                              <div className="mt-2 max-h-[280px] overflow-auto">
                                {historyAccounts.length === 0 ? (
                                  <p className="text-[12px] text-[#6f7890]">Sin cuentas registradas.</p>
                                ) : (
                                  <ul className="space-y-2">
                                    {historyAccounts.map((account: any) => (
                                      <li key={String(account.id)} className="rounded-lg border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2">
                                        <p className="text-[12px] font-semibold text-[#1f2638]">Cuenta {formatAccountSourceType(account.sourceType)} #{String(account.id)}</p>
                                        <p className="text-[12px] text-[#6f7890]">{formatDate(account.date)}{account.time ? ` · ${account.time}` : ''}</p>
                                        <p className="text-[12px] text-[#4e5870]">Total {formatMoney(Number(account.totalAmount || 0))} · Pendiente {formatMoney(Number(account.amount || 0))}</p>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  </div>
                )}
              </div>
        </div>
      </AdminPlaygroundShell>

      {activePaymentModal?.flow === 'playtomicPayment' && activePaymentModal.step === 'form' && (
        <div className="fixed inset-0 z-[2147483200]">
          <button
            type="button"
            className="absolute inset-0 bg-[#0d1326]/45"
            onPointerDown={handleModalBackdropPointerDown}
            onPointerUp={(event) => handleModalBackdropPointerUp(event, closeSimplifiedPaymentModal)}
            aria-label="Cerrar modal de cobro"
          />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className="flex max-h-[85vh] w-full max-w-[700px] flex-col overflow-hidden rounded-2xl border border-[#dce2ee] bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#eef1f6] px-4 py-3">
                <div>
                  <p className="text-[18px] font-semibold text-[#1f2638]">
                    {isPlaytomicPaymentModal ? 'Registrar cobro' : 'Registrar pago'}
                  </p>
                  <p className="text-[12px] text-[#707a92]">
                    Cobro sobre deuda común de la reserva. Elegí método, conceptos y monto.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSimplifiedPaymentModal}
                  className="h-8 w-8 rounded-full text-[#7e879c] grid place-items-center hover:bg-[#f3f5fa]"
                  aria-label="Cerrar"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-4 overflow-y-auto px-4 py-4">
                {debtLoading ? (
                  <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Cargando detalle de cuenta...</div>
                ) : !selectedDebtEntry ? (
                  <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Selecciona una cuenta para cobrar.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-[11px] text-[#6f7890]">
                      <div className="rounded-lg border border-[#e2e7f1] bg-[#f8f9fd] px-2 py-1.5">
                        <p>Total</p>
                        <p className="text-[13px] font-semibold text-[#273149]">
                          {isFinancialDisplayPending ? '--' : `${simplifiedFinancialTotal.toFixed(2)} $`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#e2e7f1] bg-[#f8f9fd] px-2 py-1.5">
                        <p>Pagado</p>
                        <p className="text-[13px] font-semibold text-[#16733f]">
                          {isFinancialDisplayPending ? '--' : `${simplifiedPaidAmount.toFixed(2)} $`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#e2e7f1] bg-[#f8f9fd] px-2 py-1.5">
                        <p>Deuda</p>
                        <p className="text-[13px] font-semibold text-[#9a5a00]">
                          {isFinancialDisplayPending ? '--' : `${simplifiedRemainingAmount.toFixed(2)} $`}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="block">
                        <span className="text-[12px] font-medium text-[#79829a]">Método</span>
                        <select
                          value={simplifiedPaymentMethodDraft}
                          onChange={(event) => setSimplifiedPaymentMethodDraft(event.target.value as PaymentMethod)}
                          className="mt-1 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[14px] text-[#2a3245] outline-none focus:border-[#3053e2]"
                        >
                          {ownerPaymentMethodOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      {simplifiedPaymentMethodDraft === 'TRANSFER' && (
                        <div>
                          <label className="text-[12px] font-medium text-[#79829a]">Canal de transferencia</label>
                          <select
                            value={transferChannel}
                            onChange={(event) => setTransferChannel(event.target.value as PaymentTransferChannel)}
                            className="mt-1 h-11 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] text-[#2a3245] outline-none focus:border-[#3053e2]"
                          >
                            <option value="BANK_ACCOUNT">Cuenta bancaria</option>
                            <option value="VIRTUAL_WALLET">Billetera virtual</option>
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2.5">
                      <p className="text-[12px] font-semibold text-[#44506b]">Conceptos a cobrar</p>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                        {[
                          { id: 'FULL', label: 'Todo pendiente' },
                          { id: 'COURT_ONLY', label: 'Solo cancha' },
                          { id: 'CUSTOM_ITEMS', label: 'Personalizado' },
                        ].map((option) => {
                          const isActive = simplifiedPaymentQuickPreset === option.id;
                          return (
                            <button
                              key={`payment-playtomic-preset-${option.id}`}
                              type="button"
                              onClick={() => applySimplifiedPaymentQuickPreset(option.id as PaymentQuickPreset)}
                              className={`h-9 rounded-lg border text-[12px] font-semibold transition ${
                                isActive
                                  ? 'border-[#3155df] bg-[#eef2ff] text-[#3155df]'
                                  : 'border-[#dce2ee] bg-white text-[#5f6880] hover:bg-[#f5f7fc]'
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] text-[#6f7890]">
                        {simplifiedPaymentQuickPreset === 'FULL'
                          ? 'Deuda común completa de la reserva.'
                          : simplifiedPaymentQuickPreset === 'COURT_ONLY'
                            ? 'Solo el saldo pendiente de cancha.'
                            : 'Elegí manualmente qué conceptos cobrar en este pago.'}
                      </p>
                    </div>

                    {simplifiedPaymentQuickPreset === 'CUSTOM_ITEMS' && (
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[12px] font-semibold text-[#44506b]">Selección manual</p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const nextIds = pendingAccountItems.map((item) => String(item.id));
                                setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                setSimplifiedPaymentAmountDraft(String(computeConceptBasedMaxAmount('CUSTOM_ITEMS', nextIds).toFixed(2)));
                              }}
                              className="h-7 rounded-md border border-[#d9e0ed] bg-white px-2 text-[11px] font-semibold text-[#4d5875] hover:bg-[#f4f7fc]"
                            >
                              Seleccionar todo
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSimplifiedPaymentSelectedItemIdsDraft([]);
                                setSimplifiedPaymentAmountDraft('');
                              }}
                              className="h-7 rounded-md border border-[#d9e0ed] bg-white px-2 text-[11px] font-semibold text-[#4d5875] hover:bg-[#f4f7fc]"
                            >
                              Limpiar
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-[#6f7890]">
                          Deuda seleccionada: {simplifiedPaymentConceptDebt.toFixed(2)} $
                        </p>
                        <div className="mt-2 max-h-[180px] overflow-auto rounded-lg border border-[#dce2ee] bg-white p-2">
                          {pendingAccountItems.length === 0 ? (
                            <p className="px-1 py-2 text-[12px] text-[#7a8398]">No hay conceptos con deuda pendiente.</p>
                          ) : (
                            <div className="space-y-1">
                              {pendingAccountItems.map((item) => {
                                const checked = simplifiedPaymentSelectedItemIdsDraft.includes(String(item.id));
                                return (
                                  <label key={`payment-playtomic-concept-item-${item.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[#f5f7fc]">
                                    <span className="min-w-0 flex items-center gap-2 text-[12px] text-[#2a3245]">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(event) => {
                                          const nextChecked = event.target.checked;
                                          const nextSet = new Set(simplifiedPaymentSelectedItemIdsDraft.map((value) => String(value || '').trim()).filter(Boolean));
                                          if (nextChecked) nextSet.add(String(item.id));
                                          else nextSet.delete(String(item.id));
                                          const nextIds = Array.from(nextSet);
                                          setSimplifiedPaymentSelectedItemIdsDraft(nextIds);
                                          setSimplifiedPaymentAmountDraft(String(computeConceptBasedMaxAmount('CUSTOM_ITEMS', nextIds).toFixed(2)));
                                        }}
                                        className="h-4 w-4 accent-[#3053e2]"
                                      />
                                      <span className="truncate">{item.type === 'BOOKING' ? 'Cancha' : item.description}</span>
                                    </span>
                                    <span className="text-[11px] font-semibold text-[#62708f]">{Number(item.remainingAmount || 0).toFixed(2)} $</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <label className="block">
                      <span className="text-[12px] font-medium text-[#79829a]">Monto</span>
                      <div className="mt-1 h-11 rounded-xl border border-[#dce2ee] bg-white px-3 flex items-center justify-between">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={simplifiedPaymentAmountDraft}
                          onChange={(event) => setSimplifiedPaymentAmountDraft(event.target.value)}
                          className="w-full bg-transparent text-[16px] text-[#2a3245] outline-none"
                        />
                        <span className="text-[15px] font-semibold text-[#8a92a5]">$</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#6f7890]">
                        Máximo para este cobro: {simplifiedPaymentMaxAmount.toFixed(2)} $
                      </p>
                    </label>

                  </>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#eef1f6] px-4 py-3">
                <button
                  type="button"
                  onClick={closeSimplifiedPaymentModal}
                  className="h-10 rounded-xl border border-[#dce2ee] px-4 text-[14px] font-semibold text-[#5d667f] hover:bg-[#f7f9fc]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => void queueSimplifiedPaymentFromModal()}
                  disabled={!hasValidSimplifiedPaymentMethod || !hasValidSimplifiedPaymentAmount}
                  className="h-10 rounded-xl bg-[#3053e2] px-4 text-[14px] font-semibold text-white hover:bg-[#2748cc] disabled:opacity-50"
                >
                  {isPlaytomicPaymentModal ? 'Continuar' : 'Registrar pago'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activePaymentModal?.flow === 'playtomicPayment' &&
        activePaymentModal.step === 'preconfirm' &&
        isPlaytomicPaymentModal && (
        <div
          className="fixed inset-0 z-[2147483250] bg-[#11162a]/35 flex items-center justify-center p-4"
          onPointerDown={handleModalBackdropPointerDown}
          onPointerUp={(event) =>
            handleModalBackdropPointerUp(event, () =>
              setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' })
            )
          }
        >
          <div
            className="w-full max-w-[560px] rounded-2xl border border-[#e0e5f2] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf1f6]">
              <h3 className="text-[22px] font-bold tracking-[-0.01em] text-[#222a3d]">Confirmar cobro</h3>
              <button
                type="button"
                onClick={() => setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' })}
                className="h-8 w-8 rounded-full border border-[#e2e6ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
              >
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-xs text-[#5c6478]">
                  <p>Monto a cobrar</p>
                  <p className="text-[15px] font-bold text-[#1f2a44]">{playtomicPreviewRequestedAmount.toFixed(2)} $</p>
                </div>
                <div className="rounded-lg bg-[#eef6ff] px-3 py-2 text-xs text-[#3155df]">
                  <p>Saldo luego del cobro</p>
                  <p className="text-[15px] font-bold text-[#1f2a44]">{playtomicPreviewRemainingAfter.toFixed(2)} $</p>
                </div>
              </div>
              <div className="rounded-lg border border-[#e0e5f2] bg-white px-3 py-2">
                <p className="text-[12px] text-[#6f7890]">Método</p>
                <p className="text-[14px] font-semibold text-[#2a3245]">{simplifiedPaymentMethodLabel}</p>
              </div>
              <div className="rounded-lg border border-[#e0e5f2] bg-white">
                <div className="border-b border-[#edf1f6] px-3 py-2 text-[12px] font-semibold text-[#4b5672]">
                  Conceptos que cubre
                </div>
                {playtomicPreviewConceptRows.length === 0 ? (
                  <p className="px-3 py-3 text-[12px] text-[#7a8398]">No hay conceptos seleccionados.</p>
                ) : (
                  <div className="max-h-44 overflow-auto divide-y divide-[#eef2f8]">
                    {playtomicPreviewConceptRows.map((row) => (
                      <div key={`playtomic-preview-row-${row.id}`} className="flex items-center justify-between px-3 py-2 text-[12px] text-[#44506b]">
                        <span className="truncate pr-2">{row.label}</span>
                        <strong className="text-[#2a3245]">{row.amount.toFixed(2)} $</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' })}
                  className="h-10 rounded-xl border border-[#dbe2ef] bg-white px-4 text-sm font-semibold text-[#4e5870] hover:bg-[#f7f9fc]"
                >
                  Volver
                </button>
                <button
                  type="button"
                  onClick={() => void queueSimplifiedPaymentFromModal({ skipPlaytomicPreconfirm: true })}
                  className="h-10 rounded-xl bg-[#3053e2] px-5 text-white text-sm font-bold hover:bg-[#2748cc]"
                >
                  Confirmar cobro
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activePaymentModal?.flow === 'playtomicPayment' &&
        activePaymentModal.step === 'result' &&
        playtomicResultModal && (
        <div
          className="fixed inset-0 z-[2147483250] bg-[#11162a]/35 flex items-center justify-center p-4"
          onPointerDown={handleModalBackdropPointerDown}
          onPointerUp={(event) => handleModalBackdropPointerUp(event, closeSimplifiedPaymentModal)}
        >
          <div
            className="w-full max-w-[560px] rounded-2xl border border-[#e0e5f2] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#edf1f6]">
              <h3
                className={`text-[22px] font-bold tracking-[-0.01em] ${
                  playtomicResultModal.variant === 'success'
                    ? 'text-[#22724a]'
                    : playtomicResultModal.variant === 'partial'
                      ? 'text-[#9a5a00]'
                      : 'text-[#b42346]'
                }`}
              >
                {playtomicResultModal.title}
              </h3>
              <button
                type="button"
                onClick={closeSimplifiedPaymentModal}
                className="h-8 w-8 rounded-full border border-[#e2e6ef] grid place-items-center text-[#7a8398] hover:bg-[#f7f9fc]"
              >
                <X size={15} />
              </button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <p className="text-[14px] text-[#4b556d]">{playtomicResultModal.detail}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-xs text-[#5c6478] flex justify-between">
                  <span>Solicitado</span>
                  <strong>{playtomicResultModal.requestedAmount.toFixed(2)} $</strong>
                </div>
                <div className="rounded-lg bg-[#eef6ff] px-3 py-2 text-xs text-[#3155df] flex justify-between">
                  <span>Aplicado</span>
                  <strong>{playtomicResultModal.appliedAmount.toFixed(2)} $</strong>
                </div>
                <div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-xs text-[#5c6478] flex justify-between">
                  <span>Método</span>
                  <strong>{playtomicResultModal.methodLabel}</strong>
                </div>
                <div className="rounded-lg bg-[#f7f8fc] px-3 py-2 text-xs text-[#5c6478] flex justify-between">
                  <span>Saldo actual</span>
                  <strong>{playtomicResultModal.remainingAfter.toFixed(2)} $</strong>
                </div>
              </div>
              {playtomicResultModal.appliedItems.length > 0 && (
                <div className="rounded-lg border border-[#e0e5f2] bg-white">
                  <div className="border-b border-[#edf1f6] px-3 py-2 text-[12px] font-semibold text-[#4b5672]">
                    Conceptos aplicados
                  </div>
                  <div className="max-h-44 overflow-auto divide-y divide-[#eef2f8]">
                    {playtomicResultModal.appliedItems.map((row, index) => (
                      <div key={`playtomic-result-row-${index}`} className="flex items-center justify-between px-3 py-2 text-[12px] text-[#44506b]">
                        <span className="truncate pr-2">{row.label}</span>
                        <strong className="text-[#2a3245]">{row.amount.toFixed(2)} $</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeSimplifiedPaymentModal}
                  className="h-10 rounded-xl border border-[#dbe2ef] bg-white px-4 text-sm font-semibold text-[#4e5870] hover:bg-[#f7f9fc]"
                >
                  Entendido
                </button>
                {playtomicResultModal.variant !== 'success' && (
                  <button
                    type="button"
                    onClick={() => {
                      setActivePaymentModal({ flow: 'playtomicPayment', step: 'form' });
                    }}
                    className="h-10 rounded-xl bg-[#3053e2] px-5 text-white text-sm font-bold hover:bg-[#2748cc]"
                  >
                    Reintentar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {sidebarOpen && (
        <button
          type="button"
          aria-label="Cerrar panel"
          className="fixed inset-x-0 bottom-0 top-16 z-[105] bg-[#101326]/20 transition-[left] duration-200 ease-out will-change-[left] lg:left-[var(--admin-playground-sidebar-left,168px)] lg:rounded-tl-[12px]"
          onClick={closeActionSidebar}
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 top-16 z-[115] w-full max-w-[620px] border-l border-[#e6e8ee] bg-white transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="relative h-full w-full flex flex-col">
          <header className="border-b border-[#eef0f5] px-6 py-5 flex items-start justify-between">
            <div>
              <h2 className="text-[24px] leading-none font-semibold text-[#1f2638] tracking-[-0.015em]">
                {sidebarView === 'client_create' && 'Nuevo cliente'}
                {sidebarView === 'client_edit' && 'Editar cliente'}
                {sidebarView === 'client_profile' && 'Perfil del cliente'}
                {sidebarView === 'client_delete' && 'Eliminar cliente'}
                {sidebarView === 'debt_detail' && 'Detalle de cuenta'}
              </h2>
              <p className="mt-3 text-[13px] leading-snug text-[#7d879d]">
                {isClientFormView && 'Gestion de datos basicos del cliente.'}
                {sidebarView === 'client_profile' && (selectedClient ? getClientName(selectedClient) : 'Sin cliente seleccionado')}
                {sidebarView === 'client_delete' && 'Esta accion es permanente.'}
                {isDebtView && `${selectedClient ? getClientName(selectedClient) : 'Cliente'}${selectedDebtEntry ? ` · Cuenta #${String(selectedDebtEntry.id)}` : ''}`}
              </p>
            </div>
            <button
              type="button"
              onClick={closeActionSidebar}
              className="h-9 w-9 rounded-full border border-[#e4e7ee] text-[#798194] grid place-items-center hover:bg-[#f7f8fb] shrink-0"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            {isClientFormView && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={clientForm.name}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, name: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  placeholder="Nombre y apellido"
                />

                <div className="grid grid-cols-[110px_1fr] gap-2">
                  <select
                    value={clientForm.phoneCountryIso2}
                    onChange={(event) => setClientForm((prev) => ({ ...prev, phoneCountryIso2: normalizePhoneCountryIso2(event.target.value) }))}
                    className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-2 text-[12px] font-semibold outline-none focus:border-[#3053e2]"
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
                    onChange={(event) =>
                      setClientForm((prev) => ({ ...prev, phone: event.target.value.replace(/[^\d]/g, '') }))
                    }
                    className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                    placeholder="Telefono"
                  />
                </div>

                <input
                  type="text"
                  value={clientForm.dni}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, dni: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  placeholder="DNI"
                />

                <input
                  type="email"
                  value={clientForm.email}
                  onChange={(event) => setClientForm((prev) => ({ ...prev, email: event.target.value }))}
                  className="h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                  placeholder="Email"
                />

                <label className="inline-flex items-center gap-2 pt-1 text-[12px] font-semibold text-[#4e5870]">
                  <input
                    type="checkbox"
                    checked={Boolean(clientForm.isProfessor)}
                    onChange={(event) => setClientForm((prev) => ({ ...prev, isProfessor: event.target.checked }))}
                  />
                  Es profesor
                </label>
              </div>
            )}

            {sidebarView === 'client_profile' && (
              <div className="space-y-4">
                {!selectedClient ? (
                  <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Selecciona un cliente.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Cliente</p>
                        <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{getClientName(selectedClient)}</p>
                      </div>
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">DNI</p>
                        <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{String(selectedClient.dni || '-')}</p>
                      </div>
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Telefono</p>
                        <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{String(selectedClient.phone || '-')}</p>
                      </div>
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Email</p>
                        <p className="mt-1 break-all text-[13px] font-semibold text-[#1f2638]">{String(selectedClient.email || '-')}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                      <p className="text-[10px] uppercase tracking-wide text-[#6f7890]">Estado comercial</p>
                      <p className="mt-1 text-[13px] text-[#4e5870]">
                        Total reservas: <span className="font-semibold text-[#1f2638]">{Number(selectedClient.totalBookings || 0)}</span>
                      </p>
                      {Number(selectedClient.totalDebt || 0) > EPSILON ? (
                        <p className="mt-1 text-[13px] text-red-700">
                          Deuda vigente: <span className="font-semibold">{formatMoney(Number(selectedClient.totalDebt || 0))}</span>
                        </p>
                      ) : (
                        <p className="mt-1 text-[13px] text-[#6f7890]">
                          Sin deuda vigente
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {sidebarView === 'client_delete' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#fecaca] bg-[#fff1f2] p-3 text-[13px] text-[#7f1d1d]">
                  Vas a eliminar a {selectedClient ? getClientName(selectedClient) : 'este cliente'}. Esta accion no se puede deshacer.
                </div>
                <div className="rounded-xl border border-[#dce2ee] bg-white p-3">
                  <p className="text-[12px] uppercase tracking-wide text-[#6f7890]">Cliente seleccionado</p>
                  <p className="mt-1 text-[13px] font-semibold text-[#1f2638]">{selectedClient ? getClientName(selectedClient) : '-'}</p>
                </div>
              </div>
            )}

            {isDebtView && (
              <div className="space-y-4">
                {debtLoading ? (
                  <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Cargando detalle de cuenta...</div>
                ) : !selectedDebtEntry ? (
                  <div className="rounded-xl border border-[#dce2ee] p-8 text-center text-[13px] text-[#6f7890]">Selecciona una cuenta para ver su detalle.</div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Saldo total</p>
                        <p className="mt-1 text-lg font-semibold text-[#1f2638]">{formatMoney(selectedDebtTotalPending)}</p>
                      </div>
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Pendiente cancha</p>
                        <p className="mt-1 text-lg font-semibold text-[#1f2638]">{formatMoney(selectedDebtBreakdown ? Number(selectedDebtBreakdown.courtPending || 0) : selectedDebtTotalPending)}</p>
                      </div>
                      <div className="rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Pendiente consumos</p>
                        <p className="mt-1 text-lg font-semibold text-[#1f2638]">{formatMoney(selectedDebtBreakdown ? Number(selectedDebtBreakdown.consumptionPending || 0) : 0)}</p>
                      </div>
                    </div>

                    {isDebtDetailView && (
                      <>
                        <div className="rounded-xl border border-[#dce2ee] bg-white p-3">
                          <h3 className="text-[13px] font-semibold text-[#1f2638]">Detalle de deuda de cancha</h3>
                          {selectedDebtBreakdown?.bookingPendingItems?.length ? (
                            <ul className="mt-2 space-y-1">
                              {selectedDebtBreakdown.bookingPendingItems.map((item) => (
                                <li key={item.id} className="rounded-lg border border-[#dce2ee] bg-[#f8f9fd] px-2 py-1.5 text-[12px] text-[#4e5870]">
                                  {item.description} · Pendiente {formatMoney(item.remaining)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-[12px] text-[#6f7890]">Sin conceptos pendientes de cancha.</p>
                          )}
                        </div>

                        <div className="rounded-xl border border-[#dce2ee] bg-white p-3">
                          <h3 className="text-[13px] font-semibold text-[#1f2638]">Detalle de productos y consumos</h3>
                          {selectedDebtBreakdown?.consumptionPendingItems?.length ? (
                            <ul className="mt-2 space-y-1">
                              {selectedDebtBreakdown.consumptionPendingItems.map((item) => (
                                <li key={item.id} className="rounded-lg border border-[#dce2ee] bg-[#f8f9fd] px-2 py-1.5 text-[12px] text-[#4e5870]">
                                  {item.description} · Cant. {item.quantity} · Pendiente {formatMoney(item.remaining)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-2 text-[12px] text-[#6f7890]">Sin consumos pendientes.</p>
                          )}
                        </div>
                      </>
                    )}

                    {false && (
                      <div className="space-y-3 rounded-xl border border-[#dce2ee] bg-[#fbfdff] p-3">
                        <div className="rounded-xl border border-[#dce2ee] bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[12px] font-semibold text-[#4e5870]">Cobro por conceptos</p>
                              <p className="text-[10px] text-[#6f7890]">Configura por item lo que paga ahora este jugador.</p>
                            </div>
                            {Boolean(selectedDebtBreakdown?.bookingPendingItems?.length) && (
                              <label className="text-[10px] text-[#6f7890]">
                                Participantes
                                <input
                                  type="number"
                                  min={1}
                                  max={12}
                                  step={1}
                                  value={splitTotalParticipants}
                                  onChange={(event) => {
                                    const parsed = Math.trunc(Number(event.target.value || 1));
                                    const normalized = Math.max(1, Math.min(12, Number.isFinite(parsed) ? parsed : 1));
                                    setSplitTotalParticipants(normalized);
                                  }}
                                  className="mt-1 h-8 w-20 rounded-lg border border-[#dce2ee] bg-white px-2 text-[12px] font-semibold outline-none focus:border-[#3053e2]"
                                />
                              </label>
                            )}
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[200px_1fr]">
                            <select
                              value={payConceptView}
                              onChange={(event) => setPayConceptView(event.target.value as PayConceptView)}
                              className="h-8 rounded-lg border border-[#dce2ee] bg-white px-2 text-[12px] font-semibold text-[#4e5870] outline-none focus:border-[#3053e2]"
                            >
                              <option value="all">Ver: Todos los conceptos</option>
                              <option value="booking">Ver: Solo cancha</option>
                              <option value="consumption">Ver: Solo consumos</option>
                              <option value="selected">Ver: Solo seleccionados</option>
                            </select>
                            {payConceptView === 'consumption' && (
                              <input
                                type="text"
                                value={consumptionSearchTerm}
                                onChange={(event) => setConsumptionSearchTerm(event.target.value)}
                                placeholder="Buscar consumo"
                                className="h-8 w-full rounded-lg border border-[#dce2ee] bg-white px-2 text-[12px] outline-none focus:border-[#3053e2]"
                              />
                            )}
                          </div>

                          {selectedDebtBreakdown ? (
                            <div className="mt-2 space-y-2 max-h-[220px] overflow-auto pr-1">
                              {payItemsForList.length === 0 && (
                                <div className="rounded-lg border border-[#dce2ee] bg-white px-3 py-4 text-center text-[12px] text-[#6f7890]">
                                  No hay conceptos para esta vista/filtro.
                                </div>
                              )}

                              {bookingItemsForList.length > 0 && (
                                <div className="rounded-lg border border-[#dce2ee] bg-white p-2">
                                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Cancha</p>
                                  <div className="space-y-2">
                                    {bookingItemsForList.map((item) => (
                                      <div key={item.id} className="grid grid-cols-[1fr_120px] items-center gap-2 rounded-lg border border-[#dce2ee] bg-[#f8f9fd] px-2 py-1.5">
                                        <div>
                                          <p className="text-[12px] font-semibold text-[#1f2638]">{item.description}</p>
                                          <p className="text-[11px] text-[#6f7890]">Pendiente {formatMoney(item.remaining)}</p>
                                          <div className="mt-1 flex flex-wrap items-center gap-1">
                                            <button
                                              type="button"
                                              onClick={() => skipItemForNow(String(item.id))}
                                              className={`h-6 rounded-md border px-2 text-[10px] font-semibold transition ${
                                                isItemSkipped(String(item.id))
                                                  ? 'border-[#be123c] bg-[#ffe4e6] text-[#9f1239]'
                                                  : 'border-[#fbcfe8] bg-[#fff1f2] text-[#9f1239] hover:bg-[#ffe4e6]'
                                              }`}
                                            >
                                              No cobrar ahora
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                applyItemSplitAmount(
                                                  String(item.id),
                                                  Number(item.total || 0),
                                                  Number(item.remaining || 0),
                                                  1
                                                )
                                              }
                                              className={`h-6 rounded-md border px-2 text-[10px] font-semibold transition ${
                                                isBookingPresetActive(String(item.id), 1)
                                                  ? 'border-[#3053e2] bg-[#edf1ff] text-[#3053e2]'
                                                  : 'border-[#dce2ee] bg-white text-[#4e5870] hover:bg-[#f8f9fd]'
                                              }`}
                                            >
                                              Cobrar cuota (1 jugador)
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                applyItemSplitAmount(
                                                  String(item.id),
                                                  Number(item.total || 0),
                                                  Number(item.remaining || 0),
                                                  splitTotalParticipants,
                                                  splitTotalParticipants
                                                )
                                              }
                                              className={`h-6 rounded-md border px-2 text-[10px] font-semibold transition ${
                                                isBookingFullActive(item)
                                                  ? 'border-[#3053e2] bg-[#edf1ff] text-[#3053e2]'
                                                  : 'border-[#dce2ee] bg-white text-[#4e5870] hover:bg-[#f8f9fd]'
                                              }`}
                                            >
                                              Cobrar total de cancha
                                            </button>
                                          </div>
                                        </div>
                                        <input
                                          type="number"
                                          min={0}
                                          max={Math.max(0, Number(item.remaining || 0))}
                                          step="0.01"
                                          value={Number(payItemAllocations[String(item.id)] || 0).toFixed(2)}
                                          onChange={(event) => updateItemAllocation(String(item.id), Number(item.remaining || 0), event.target.value)}
                                          className="h-9 w-full rounded-lg border border-[#dce2ee] bg-white px-2 text-[12px] font-semibold text-[#1f2638] outline-none placeholder:text-[#8b93a5] focus:border-[#3053e2]"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {consumptionItemsForList.length > 0 && (
                                <div className="rounded-lg border border-[#dce2ee] bg-white p-2">
                                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6f7890]">Consumos</p>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => applyAllConsumptionAllocations('full')}
                                        className="h-6 rounded-md border border-[#dce2ee] bg-white px-2 text-[10px] font-semibold text-[#4e5870] hover:bg-[#f8f9fd]"
                                      >
                                        Seleccionar visibles
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => applyAllConsumptionAllocations('skip')}
                                        className="h-6 rounded-md border border-[#fbcfe8] bg-[#fff1f2] px-2 text-[10px] font-semibold text-[#9f1239] hover:bg-[#ffe4e6]"
                                      >
                                        Limpiar visibles
                                      </button>
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    {consumptionItemsForList.map((item) => {
                                      const checked = !isItemSkipped(String(item.id));
                                      return (
                                        <div key={item.id} className="grid grid-cols-[auto_1fr_120px] items-center gap-2 rounded-lg border border-[#dce2ee] bg-[#f8f9fd] px-2 py-1.5">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(event) => toggleConsumptionSelection(item, event.target.checked)}
                                            className="h-4 w-4 rounded border-[#cbd5e1]"
                                            aria-label={`Seleccionar ${item.description}`}
                                          />
                                          <div>
                                            <p className="text-[12px] font-semibold text-[#1f2638]">{item.description}</p>
                                            <p className="text-[11px] text-[#6f7890]">
                                              Cant. {item.quantity} · Pendiente {formatMoney(item.remaining)}
                                            </p>
                                          </div>
                                          <input
                                            type="number"
                                            min={0}
                                            max={Math.max(0, Number(item.remaining || 0))}
                                            step="0.01"
                                            value={Number(payItemAllocations[String(item.id)] || 0).toFixed(2)}
                                            onChange={(event) => updateItemAllocation(String(item.id), Number(item.remaining || 0), event.target.value)}
                                            className="h-9 w-full rounded-lg border border-[#dce2ee] bg-white px-2 text-[12px] font-semibold text-[#1f2638] outline-none placeholder:text-[#8b93a5] focus:border-[#3053e2]"
                                          />
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : null}

                          <div className="mt-3 rounded-xl border border-[#dce2ee] bg-[#f8f9fd] p-3">
                            <p className="text-[12px] font-semibold text-[#4e5870]">Resumen</p>
                            <div className="mt-2 grid grid-cols-1 gap-2 text-[12px] text-[#4e5870] sm:grid-cols-2">
                              <div className="rounded-lg border border-[#dce2ee] bg-white px-2 py-1.5">
                                Total a cobrar ahora: <span className="font-semibold text-[#1f2638]">{formatMoney(Number(payAmount || 0))}</span>
                              </div>
                              <div className="rounded-lg border border-[#dce2ee] bg-white px-2 py-1.5">
                                Saldo que queda: <span className="font-semibold text-[#1f2638]">{formatMoney(payAllocationsPreview.unallocated)}</span>
                              </div>
                              <div className="rounded-lg border border-[#dce2ee] bg-white px-2 py-1.5">
                                Cancha cobrada: <span className="font-semibold text-[#1f2638]">{formatMoney(payAllocationsPreview.booking)}</span>
                              </div>
                              <div className="rounded-lg border border-[#dce2ee] bg-white px-2 py-1.5">
                                Consumos cobrados: <span className="font-semibold text-[#1f2638]">{formatMoney(payAllocationsPreview.consumption)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="text-[12px] font-semibold text-[#4e5870]">Metodo</label>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {(['CASH', 'TRANSFER', 'CARD'] as PaymentMethod[]).map((method) => (
                              <button
                                key={method}
                                type="button"
                                onClick={() => setPayMethod(method)}
                                className={`h-9 rounded-lg px-3 text-[12px] font-semibold transition ${
                                  payMethod === method ? 'bg-[#3053e2] text-white' : 'border border-[#dce2ee] bg-white text-[#4e5870] hover:bg-[#f8f9fd]'
                                }`}
                              >
                                {method === 'CASH' ? 'Efectivo' : method === 'TRANSFER' ? 'Transferencia' : 'Tarjeta'}
                              </button>
                            ))}
                          </div>
                        </div>

                        {payMethod === 'TRANSFER' && (
                          <div>
                            <label className="text-[12px] font-semibold text-[#4e5870]">Canal de transferencia</label>
                            <select
                              value={transferChannel}
                              onChange={(event) => setTransferChannel(event.target.value as PaymentTransferChannel)}
                              className="mt-1 h-10 w-full rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] outline-none focus:border-[#3053e2]"
                            >
                              <option value="BANK_ACCOUNT">Cuenta bancaria</option>
                              <option value="VIRTUAL_WALLET">Billetera virtual</option>
                            </select>
                          </div>
                        )}

                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <footer className="border-t border-[#eef0f5] bg-white p-4">
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeActionSidebar}
                className="h-10 rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] font-semibold text-[#4e5870] hover:bg-[#f8f9fd]"
              >
                Cancelar
              </button>

            {isClientFormView && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditingClientId('');
                    setClientForm({
                      name: '',
                      phoneCountryIso2: clubPhoneCountryIso2,
                      phone: '',
                      dni: '',
                      email: '',
                      isProfessor: false,
                    });
                  }}
                  className="h-10 rounded-xl border border-[#dce2ee] bg-white px-3 text-[13px] font-semibold text-[#4e5870] hover:bg-[#f8f9fd]"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={() => void submitClient()}
                  disabled={submittingClient}
                  className="h-10 rounded-xl bg-[#3053e2] px-3 text-[13px] font-semibold text-white transition hover:bg-[#2748cc] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submittingClient ? 'Guardando...' : sidebarView === 'client_edit' ? 'Guardar cambios' : 'Crear cliente'}
                </button>
              </>
            )}

            {sidebarView === 'client_profile' && selectedClient && (
              <button
                type="button"
                onClick={() => openEditClient(selectedClient)}
                className="h-10 rounded-xl bg-[#3053e2] px-3 text-[13px] font-semibold text-white hover:bg-[#2748cc]"
              >
                Editar cliente
              </button>
            )}

            {sidebarView === 'client_delete' && (
              <button
                type="button"
                onClick={() => {
                  if (deletingClient) return;
                  void deleteSelectedClient();
                }}
                className="h-10 rounded-xl bg-[#b91c1c] px-3 text-[13px] font-semibold text-white hover:bg-[#991b1b] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={deletingClient}
              >
                {deletingClient ? 'Eliminando...' : 'Si, eliminar'}
              </button>
            )}

            {sidebarView === 'debt_detail' && selectedDebtEntry && (
              <button
                type="button"
                onClick={() => void openPaySidebar(String(selectedDebtEntry.id))}
                className="h-10 rounded-xl bg-[#3053e2] px-3 text-[13px] font-semibold text-white hover:bg-[#2748cc]"
              >
                Cobrar esta cuenta
              </button>
            )}

            </div>
          </footer>
        </div>
      </aside>
    </>
  );
}
